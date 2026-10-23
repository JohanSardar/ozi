import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";

it("m9.sessions creates isolated fresh sessions and reloads idle Pi processes", async () => {
  const h = await startHarness();
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    const main = await h.ozi<Awaited<ReturnType<typeof h.thread>>>(
      "thread",
      "ozi-main",
      "--model",
      "claude-bridge/claude-sonnet-5-5",
      "--thinking",
      "low",
    );
    const fresh = await h.ozi<{ threadId: string }>("session", "new", "--title", "Fresh chat");
    const empty = await h.thread(fresh.threadId);
    expect(empty.thread.role).toBe("main-fork");
    expect(empty.thread.modelSelection).toEqual(main.thread.modelSelection);
    expect(empty.thread.effectiveLoadout).toEqual(main.thread.effectiveLoadout);
    expect(empty.thread.lineage.parentThreadId).toBe("ozi-main");
    expect(empty.messages).toEqual([]);
    expect(empty.providerThreads).toEqual([]);
    await h.script([
      { match: "main-seed", steps: [{ say: "main-seeded" }] },
      { match: "fresh-turn", steps: [{ say: "fresh-reply" }] },
      { match: "reloaded-turn", steps: [{ say: "reloaded-reply" }] },
      { match: "hold-session", steps: [{ say: "session-held" }, { wait: true }] },
    ]);
    await h.ozi("say", "main-seed");
    await h.wait("ozi-main", "completed");
    const seeded = await h.thread("ozi-main");
    await h.ozi("thread", fresh.threadId, "--message", "fresh-turn");
    const replied = await h.wait(fresh.threadId, "completed");
    expect(replied.messages.some((message) => message.text === "fresh-reply")).toBe(true);
    expect((await h.thread("ozi-main")).messages).toEqual(seeded.messages);
    const nativeId = replied.providerThreads[0]!.nativeThreadRef!.nativeId;
    expect(nativeId).not.toBe(seeded.providerThreads[0]!.nativeThreadRef!.nativeId);
    const records = await h.records();
    const pid = records.find((record) => record.prompt === "fresh-turn")!.pid;
    const launch = records.find((record) => record.pid === pid && record.event === "launch")!;
    expect(launch.argv).not.toContain("--fork");
    expect(launch.argv).not.toContain("--session");
    expect(
      records.some((record) => record.pid === pid && record.frame?.type === "switch_session"),
    ).toBe(false);
    const listed = await h.ozi<
      {
        id: string;
        title: string;
        forkedFrom: string | null;
        messageCount: number;
        updatedAt: string;
      }[]
    >("session", "list");
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ozi-main", forkedFrom: null }),
        expect.objectContaining({
          id: fresh.threadId,
          title: "Fresh chat",
          forkedFrom: "ozi-main",
          messageCount: replied.messages.length,
          updatedAt: expect.any(String),
        }),
      ]),
    );
    const text = await h.execOutput("session", "list");
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("Fresh chat");
    expect(text.stdout).toContain("ozi-main");
    expect(await h.ozi("session", "reload", fresh.threadId)).toEqual({ threadId: fresh.threadId });
    await h.ozi("thread", fresh.threadId, "--message", "reloaded-turn");
    await h.wait(fresh.threadId, "completed");
    const after = await h.records();
    expect(after.find((record) => record.prompt === "reloaded-turn")!.pid).not.toBe(pid);
    expect((await h.thread(fresh.threadId)).providerThreads[0]!.nativeThreadRef!.nativeId).toBe(
      nativeId,
    );
    const state = await h.ozi<{ sessionFile: string; sessionId: string }>(
      "main",
      "get_state",
      "--thread",
      fresh.threadId,
    );
    const mainState = await h.ozi<{ sessionFile: string; sessionId: string }>("main", "get_state");
    expect(state.sessionFile).toBe(nativeId);
    expect(state.sessionFile).not.toBe(mainState.sessionFile);
    expect(state.sessionId).not.toBe(mainState.sessionId);
    const stats = await h.ozi<{ tokens: { input: number } }>(
      "main",
      "get_session_stats",
      "--thread",
      fresh.threadId,
    );
    const mainStats = await h.ozi<{ tokens: { input: number } }>("main", "get_session_stats");
    expect(stats.tokens.input).toBeGreaterThan(mainStats.tokens.input);
    await h.ozi(
      "main",
      "set_session_name",
      "--thread",
      fresh.threadId,
      "--payload",
      JSON.stringify({ name: "Named chat" }),
    );
    expect(await h.ozi("session", "list")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fresh.threadId, title: "Named chat" }),
      ]),
    );
    const workerId = NodeCrypto.randomUUID();
    await h.ozi(
      "request",
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      "--payload",
      JSON.stringify({
        type: "thread.create",
        commandId: NodeCrypto.randomUUID(),
        threadId: workerId,
        projectId: main.thread.projectId,
        title: "Worker",
        modelSelection: main.thread.modelSelection,
        runtimeMode: main.thread.runtimeMode,
        interactionMode: main.thread.interactionMode,
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "cli",
      }),
    );
    const wrongRole = await h.execOutput("main", "get_state", "--thread", workerId);
    expect(wrongRole).toMatchObject({ code: 1, stdout: "" });
    expect(wrongRole.stderr.trim().split("\n")).toHaveLength(1);
    expect(wrongRole.stderr).toContain("main-fork");
    expect((await h.ozi<{ id: string }[]>("session", "list")).map((row) => row.id)).not.toContain(
      workerId,
    );
    await h.ozi("thread", fresh.threadId, "--message", "hold-session");
    await h.wait(fresh.threadId, "text:session-held");
    const busy = await h.execOutput("session", "reload", fresh.threadId, "--json");
    expect(busy.code).toBe(1);
    expect(JSON.parse(busy.stdout).error.message).toContain("idle");
    await h.ozi("stop", "--thread", fresh.threadId);
    await h.wait(fresh.threadId, "interrupted");
    expect(await h.ozi("session", "reload")).toEqual({ threadId: "ozi-main" });
    await h.restart();
    expect((await h.ozi<{ id: string }[]>("session", "list")).map((row) => row.id)).toContain(
      fresh.threadId,
    );
    const invalid = NodePath.join(h.root, "invalid.jsonl");
    await NodeFSP.writeFile(invalid, '{"type":"message"}\n');
    const rejected = await h.execOutput("session", "import", invalid);
    expect(rejected).toMatchObject({ code: 1, stdout: "" });
    expect(rejected.stderr.trim().split("\n")).toHaveLength(1);
    expect(rejected.stderr).toContain("Pi session");
    const content = '{"type":"session","version":3,"id":"import-content"}\n';
    const imported = await h.ozi<{ ok: boolean; result: { threadId: string } }[]>(
      "request",
      "ozi.session.import",
      "--payload",
      JSON.stringify({ content, title: "RPC import" }),
    );
    expect(imported[0]?.ok).toBe(true);
    expect((await h.thread(imported[0]!.result.threadId)).thread.title).toBe("RPC import");
  } finally {
    await h.close();
  }
});
