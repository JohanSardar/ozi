import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

it("m9.session-import exports main's Pi session to a remote client and resumes it as a new session", async () => {
  const fake = await startAnthropic((input) =>
    JSON.stringify(input.messages).includes("import-next-turn")
      ? { text: "import-resumed" }
      : { text: "import-seeded" },
  );
  const h = await startHarness({
    bundled: true,
    pi: {
      binaryPath: NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url)),
      env: {
        PATH: [
          NodeURL.fileURLToPath(new URL("./node_modules/.bin", import.meta.url)),
          NodeURL.fileURLToPath(new URL("./fakes", import.meta.url)),
          NodePath.dirname(process.execPath),
          "/usr/bin",
          "/bin",
        ].join(":"),
        ANTHROPIC_BASE_URL: fake.url,
        ANTHROPIC_API_KEY: "ozi-test-only",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
  }).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    await h.ozi("say", "session-import-conversation-marker");
    const main = await h.wait("ozi-main", "completed", 90);
    const source = main.providerThreads[0]!.nativeThreadRef!.nativeId!;
    expect(source).toContain(NodePath.join(h.home, "caches/ozi-main-pi/sessions"));
    const copy = NodePath.join(h.root, "exported.jsonl");
    const original = await NodeFSP.readFile(source, "utf8");
    const remote = NodePath.join(h.root, "remote-client");
    const pairing = await h.ozi<{ url: string }>("pair");
    await h.ozi("connect", pairing.url, "--home", remote);
    const exported = await h.ozi<{ path: string }>(
      "session",
      "export",
      "--format",
      "jsonl",
      "--output",
      copy,
      "--home",
      remote,
    );
    expect(exported.path).toBe(copy);
    expect(await NodeFSP.readFile(copy, "utf8")).toBe(original);
    const html = await h.ozi<{ path: string }>(
      "session",
      "export",
      "ozi-main",
      "--output",
      NodePath.join(h.root, "main.html"),
      "--home",
      remote,
    );
    expect(await NodeFSP.readFile(html.path, "utf8")).toMatch(/^<!DOCTYPE html>/);
    const imported = await h.ozi<{ threadId: string }>(
      "session",
      "import",
      copy,
      "--title",
      "Imported chat",
      "--home",
      remote,
    );
    const thread = await h.thread(imported.threadId);
    expect(thread.thread.role).toBe("main-fork");
    expect(thread.thread.title).toBe("Imported chat");
    const native = thread.providerThreads[0]!.nativeThreadRef!.nativeId!;
    expect(native).toContain(NodePath.join(h.home, "caches/ozi-main-pi/sessions"));
    expect(native).not.toBe(source);
    expect(await NodeFSP.readFile(native, "utf8")).toBe(original);
    await NodeFSP.rm(copy);
    await h.restart();
    const before = fake.requests.length;
    await h.ozi("thread", imported.threadId, "--message", "import-next-turn");
    const resumed = await h.wait(imported.threadId, "completed", 90);
    expect(resumed.messages.some((message) => message.text === "import-resumed")).toBe(true);
    const request = fake.requests
      .slice(before)
      .find((request) => JSON.stringify(request.messages).includes("import-next-turn"));
    expect(JSON.stringify(request?.messages)).toContain("session-import-conversation-marker");
    expect(JSON.stringify(request?.messages)).toContain("import-seeded");
    expect(await NodeFSP.readFile(source, "utf8")).toBe(original);
    expect((await h.thread("ozi-main")).messages).toEqual(main.messages);
  } finally {
    await h.close();
    await fake.close();
  }
});
