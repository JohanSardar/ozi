import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Ticket, TicketListResult } from "../packages/contracts/src/ticket.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const root = NodePath.resolve(import.meta.dirname, "..");
const bin = NodePath.join(root, "apps/server/src/bin.ts");

describe("i1.tickets", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  let port: number;
  let origin: string;
  let headers: Record<string, string>;
  let workerId: string;
  let jobId: string;
  let created: Ticket;
  let archived: Ticket;
  const cli = async (...args: string[]) =>
    (await exec(process.execPath, [bin, ...args, "--home", home], { cwd: home, env })).stdout;
  const ticket = async (command: string, input = {}) =>
    JSON.parse(await cli("ticket", command, "--input", JSON.stringify(input), "--json"));
  let server: NodeChildProcess.ChildProcessWithoutNullStreams | undefined;
  const start = async () => {
    server = NodeChildProcess.spawn(
      process.execPath,
      [bin, "serve", "--home", home, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
      { cwd: home, env, stdio: "pipe" },
    );
    await new Promise<void>((resolve, reject) => {
      let output = "";
      server!.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Ozi server is ready.")) resolve();
      });
      server!.once("error", reject);
      server!.once("exit", (code) => reject(new Error(`Server exited: ${code}\n${output}`)));
    });
  };
  const stop = async () => {
    if (!server || server.exitCode !== null) return;
    const exited = NodeEvents.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
    server = undefined;
  };
  const watchers: NodeChildProcess.ChildProcess[] = [];
  const watch = () => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [bin, "ticket", "subscribe", "--home", home, "--json"],
      { cwd: home, env },
    );
    watchers.push(child);
    const lines = NodeReadline.createInterface({ input: child.stdout });
    const iterator = lines[Symbol.asyncIterator]();
    return {
      next: async () => {
        const line = await iterator.next();
        if (line.done) throw new Error("Ticket subscription ended");
        return JSON.parse(line.value) as TicketListResult;
      },
      close: async () => {
        lines.close();
        const exited = NodeEvents.once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      },
    };
  };
  const content = {
    group: "Decide",
    title: "Choose a release",
    need: "Choose the release channel.",
    summary: "The result is ready.\nSelect a channel to continue.",
    choices: [{ label: "Stable", detail: "Use the supported release." }],
    markdown: "# Release\nFull **context**.",
    attachments: [
      {
        type: "file",
        id: "release-notes",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
      },
    ],
    htmlPages: [
      {
        title: "Report",
        attachment: {
          type: "file",
          id: "release-page",
          name: "report.html",
          mimeType: "text/html",
          sizeBytes: 32,
        },
      },
    ],
    threadId: "chat-i1",
  };
  beforeAll(async () => {
    home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ozi-i1-"));
    env = { ...process.env, HOME: home, OZI_HOME: home, OZI_TELEMETRY_ENABLED: "false" };
    const reserve = NodeNet.createServer();
    reserve.listen(0, "127.0.0.1");
    await NodeEvents.once(reserve, "listening");
    const address = reserve.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    origin = `http://127.0.0.1:${address.port}`;
    port = address.port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    await start();
    const { token } = JSON.parse(await cli("auth", "session", "issue", "--json"));
    headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const issued = await fetch(`${origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers,
    }).then((r) => r.json());
    const ws = new WebSocket(
      `${origin.replace("http:", "ws:")}/ws?orchestrationProtocol=2&wsTicket=${issued.ticket}`,
    );
    await NodeEvents.once(ws, "open");
    const rpc = (tag: string, payload: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = crypto.randomUUID();
        const receive = (event: MessageEvent) => {
          const response = JSON.parse(String(event.data));
          if (response.requestId !== id) return;
          if (response._tag === "Exit") {
            ws.removeEventListener("message", receive);
            if (response.exit._tag === "Success") resolve(response.exit.value);
            else reject(new Error(JSON.stringify(response.exit)));
          }
        };
        ws.addEventListener("message", receive);
        ws.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
      });
    try {
      await rpc("projects.mutate", {
        type: "project.create",
        commandId: crypto.randomUUID(),
        projectId: "project-i1",
        title: "Tickets",
        workspaceRoot: home,
      });
      for (const threadId of ["chat-i1", "reply-i1"]) {
        await rpc("orchestration.dispatchCommand", {
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: crypto.randomUUID(),
          threadId,
          projectId: "project-i1",
          title: threadId,
          modelSelection: { instanceId: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          workingDirectory: null,
        });
        await rpc("orchestration.dispatchCommand", {
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: crypto.randomUUID(),
          threadId,
          messageId: `message-${threadId}`,
          text: "Acknowledged",
          attachments: [],
          dispatchMode: { type: "defer_start" },
        });
      }
      const projection = (await rpc("orchestration.getThreadProjection", {
        threadId: "chat-i1",
      })) as { runs: Array<{ id: string; rootNodeId: string }> };
      const run = projection.runs[0]!;
      await rpc("orchestration.dispatchCommand", {
        type: "delegated_task.request",
        createdBy: "agent",
        creationSource: "mcp",
        commandId: crypto.randomUUID(),
        parentThreadId: "chat-i1",
        parentRunId: run.id,
        parentNodeId: run.rootNodeId,
        task: "Check the result",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        workspaceStrategy: { type: "worktree", baseRef: "missing" },
      });
      const parent = (await rpc("orchestration.getThreadProjection", { threadId: "chat-i1" })) as {
        subagents: Array<{ id: string; childThreadId: string }>;
      };
      workerId = parent.subagents[0]!.childThreadId;
      jobId = parent.subagents[0]!.id;
    } finally {
      ws.close();
    }
  });
  it("i1.live: structured content and committed snapshots reach every client", async () => {
    const first = watch();
    const second = watch();
    expect(await first.next()).toEqual({ tickets: [] });
    expect(await second.next()).toEqual({ tickets: [] });
    created = await ticket("create", content);
    expect(created).toMatchObject({
      group: content.group,
      title: content.title,
      choices: content.choices,
      attachments: content.attachments,
      htmlPages: content.htmlPages,
      status: "open",
      cleared: null,
      origin: {
        threadId: "chat-i1",
        chatId: "chat-i1",
        jobId: null,
        workerId: null,
        sessionId: null,
        messageId: "message-chat-i1",
      },
    });
    expect(created.createdAt).toBe(created.updatedAt);
    expect((await first.next()).tickets).toEqual([created]);
    expect((await second.next()).tickets).toEqual([created]);
    const transcript = await fetch(`${origin}${created.origin.transcriptPath}`, {
      headers: { ...headers, "x-ozi-orchestration-protocol": "2" },
    });
    expect(transcript.status).toBe(200);
    const updated = await ticket("update", {
      id: created.id,
      changes: { group: "Review", title: "Release ready" },
    });
    expect(updated.origin).toEqual(created.origin);
    expect((await first.next()).tickets).toEqual([updated]);
    expect((await second.next()).tickets).toEqual([updated]);
    await first.close();
    await second.close();
  });
  it("i1.validation: reject invalid choices and unrelated caller IDs", async () => {
    await expect(
      ticket("create", { ...content, choices: Array(5).fill(content.choices[0]) }),
    ).rejects.toThrow();
    await expect(ticket("create", { ...content, threadId: "missing" })).rejects.toThrow();
    await expect(ticket("create", { ...content, sessionId: "unrelated" })).rejects.toThrow();
    await expect(ticket("create", { ...content, messageId: "message-reply-i1" })).rejects.toThrow();
    await expect(
      ticket("close", {
        id: created.id,
        by: {
          type: "answered",
          threadId: "reply-i1",
          messageId: "message-reply-i1",
          choiceIndex: 1,
        },
      }),
    ).rejects.toThrow();
  });
  it("i1.archive: preserve clearance and search immutable archived content", async () => {
    const subscription = watch();
    expect((await subscription.next()).tickets).toHaveLength(1);
    const by = { type: "replied", threadId: "reply-i1", messageId: "message-reply-i1" };
    archived = await ticket("close", { id: created.id, by });
    expect(archived).toMatchObject({ status: "archived", cleared: { by } });
    expect(await subscription.next()).toEqual({ tickets: [] });
    await subscription.close();
    expect(await ticket("close", { id: created.id, by: { type: "acknowledged" } })).toEqual(
      archived,
    );
    await expect(
      ticket("update", { id: created.id, changes: { title: "Changed" } }),
    ).rejects.toThrow();
    expect(await ticket("list")).toEqual({ tickets: [] });
    expect(
      (await ticket("list", { status: "archived", search: "FULL", chatId: "chat-i1" })).tickets,
    ).toEqual([archived]);
    expect(await ticket("list", { status: "all", chatId: "reply-i1" })).toEqual({ tickets: [] });
  });
  it("i1.origins: workers keep chat and job links and every clearance type", async () => {
    const worker: Ticket = await ticket("create", { ...content, group: "Do", threadId: workerId });
    expect(worker.origin).toMatchObject({
      threadId: workerId,
      workerId: workerId,
      jobId: jobId,
      chatId: "chat-i1",
    });
    for (const by of [
      { type: "answered", threadId: "chat-i1", messageId: "message-chat-i1", choiceIndex: 0 },
      { type: "agent", threadId: "chat-i1", messageId: "message-chat-i1" },
      { type: "acknowledged" },
    ]) {
      const item = await ticket("create", { ...content, group: "Read" });
      expect(await ticket("close", { id: item.id, by })).toMatchObject({
        status: "archived",
        cleared: { by },
      });
    }
    await ticket("close", { id: worker.id, by: { type: "acknowledged" } });
  });
  it("i1.persistence: restart and reconnect retain tickets and clearances", async () => {
    await stop();
    await start();
    expect(await ticket("get", { id: created.id })).toEqual(archived);
    const reconnect = watch();
    expect(await reconnect.next()).toEqual({ tickets: [] });
    await reconnect.close();
  });
  afterAll(async () => {
    for (const child of watchers)
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    await stop();
    await NodeFSP.rm(home, { recursive: true, force: true });
  });
});
