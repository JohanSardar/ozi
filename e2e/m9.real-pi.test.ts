import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";

const start = async () => {
  const fake = await startAnthropic((input) => ({
    text: JSON.stringify(input.messages).includes("OZI COMPLETION CHECK")
      ? '{"verdict":"done","useful":true}'
      : "m9-reply",
  }));
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
  return { h, fake, agent: NodePath.join(h.home, "caches/ozi-main-pi") };
};

it("m9.pi-rpc exposes allowlisted commands on main's live Pi session", async () => {
  const { h, fake, agent } = await start();
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    const unavailable = await h.execOutput("main", "get_state", "--json");
    expect(unavailable.code).not.toBe(0);
    expect(JSON.parse(unavailable.stdout)).toMatchObject({
      error: { code: "OziMainPiError", message: expect.stringContaining("send a message first") },
    });
    await NodeFSP.mkdir(NodePath.join(agent, "prompts"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(agent, "prompts/m9-template.md"), "m9-expanded $1");
    await NodeFSP.writeFile(
      NodePath.join(agent, "settings.json"),
      JSON.stringify({ compaction: { keepRecentTokens: 1, reserveTokens: 1024 } }),
    );
    await h.ozi("say", "m9-first");
    await h.wait("ozi-main", "completed", 60);
    expect(await h.ozi("main", "get_commands")).toMatchObject({
      commands: expect.arrayContaining([
        {
          name: "m9-template",
          source: "prompt",
          description: expect.any(String),
          sourceInfo: expect.any(Object),
        },
      ]),
    });
    expect(await h.ozi("main", "get_session_stats")).toMatchObject({
      tokens: { input: expect.any(Number), output: expect.any(Number), total: expect.any(Number) },
    });
    const stats = await h.ozi<{ tokens: { total: number } }>("main", "get_session_stats");
    expect(stats.tokens.total).toBeGreaterThan(0);
    expect(await h.ozi("main", "get_last_assistant_text")).toEqual({ text: "m9-reply" });
    expect((await h.execOutput("main", "get_last_assistant_text")).stdout.trim()).toBe("m9-reply");
    expect(await h.ozi("main", "get_available_models")).toMatchObject({
      models: expect.any(Array),
    });
    expect(await h.ozi("main", "get_available_thinking_levels")).toMatchObject({
      levels: expect.any(Array),
    });
    expect(
      await h.ozi("main", "set_session_name", "--payload", '{"name":"m9-session"}'),
    ).toBeNull();
    expect(await h.ozi("main", "get_state")).toMatchObject({ sessionName: "m9-session" });
    const outputPath = NodePath.join(h.root, "m9-session.html");
    expect(await h.ozi("main", "export_html", "--payload", JSON.stringify({ outputPath }))).toEqual(
      { path: outputPath },
    );
    const html = await NodeFSP.readFile(outputPath, "utf8");
    const session = /<script id="session-data" type="application\/json">([^<]+)<\/script>/.exec(
      html,
    )?.[1];
    expect(session).toBeDefined();
    expect(Buffer.from(session!, "base64").toString("utf8")).toContain("m9-reply");
    expect(await h.ozi("main", "bash", "--payload", '{"command":"echo m9-bash"}')).toMatchObject({
      output: "m9-bash\n",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    });
    expect(
      (await h.execOutput("main", "bash", "--payload", '{"command":"echo m9-text"}')).stdout.trim(),
    ).toBe("m9-text");
    await h.ozi(
      "main",
      "bash",
      "--payload",
      '{"command":"echo m9-excluded","excludeFromContext":true}',
    );
    expect(await h.ozi("main", "abort_bash")).toBeNull();
    await h.ozi("say", "m9-context");
    await h.wait("ozi-main", "completed", 60);
    const context = JSON.stringify(
      fake.requests.findLast((request) => JSON.stringify(request.messages).includes("m9-context")),
    );
    expect(context).toContain("m9-bash");
    expect(context).not.toContain("m9-excluded");
    expect(
      await h.ozi("main", "compact", "--payload", '{"customInstructions":"Keep m9 markers"}'),
    ).toMatchObject({ summary: expect.any(String) });
    const beforeDenied = await h.ozi("main", "get_state");
    const denied = await h.execOutput("main", "new_session");
    expect(denied.code).not.toBe(0);
    expect(denied.stderr.trim()).toBe("Invalid or disallowed Pi command: new_session");
    expect(await h.ozi("main", "get_state")).toEqual(beforeDenied);
    const invalid = await h.execOutput("main", "bash", "--payload", "{}", "--json");
    expect(invalid.code).not.toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ error: { code: "OziMainPiError" } });
    const piError = await h.execOutput(
      "main",
      "set_session_name",
      "--payload",
      '{"name":""}',
      "--json",
    );
    expect(piError.code).not.toBe(0);
    expect(JSON.parse(piError.stdout)).toMatchObject({
      error: { code: "OziMainPiError", message: expect.stringContaining("name") },
    });
  } finally {
    await h.close();
    await fake.close();
  }
});

it("m9.slash-passthrough expands templates and completes handled prompts without inference", async () => {
  const { h, fake, agent } = await start();
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    await NodeFSP.mkdir(NodePath.join(agent, "extensions"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(agent, "prompts"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(agent, "prompts/m9-template.md"),
      "m9-expanded <$1> <$@>",
    );
    await NodeFSP.writeFile(
      NodePath.join(agent, "extensions/m9.ts"),
      `export default function(pi) {
  pi.registerCommand("m9-handled", { handler: async () => {} });
  pi.on("input", async (event) => event.text.startsWith("m9-consumed") ? { action: "handled" } : { action: "continue" });
}`,
    );
    for (const text of ["/m9-handled", "m9-consumed"]) {
      await h.ozi("say", text);
      const result = await h.wait("ozi-main", "completed", 60);
      expect(result.runs.at(-1)?.completionCheck).toBeUndefined();
      expect(result.messages.filter((message) => message.role === "assistant")).toHaveLength(0);
      expect(fake.requests).toHaveLength(0);
      expect(await h.ozi("checks")).toEqual([]);
    }
    await h.restart();
    expect(await h.ozi("checks")).toEqual([]);
    await h.ozi("say", "/m9-template arg");
    await h.wait("ozi-main", "text:m9-reply", 60);
    const request = JSON.stringify(fake.requests[0]?.messages);
    expect(request).toContain("m9-expanded <arg> <arg>");
    expect(request).not.toContain("/m9-template");
    expect(request).not.toContain("[Ozi message ID:");
  } finally {
    await h.close();
    await fake.close();
  }
});
