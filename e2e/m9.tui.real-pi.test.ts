import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";
import { openTui } from "./tty.ts";

it("m9.tui-pi-commands runs Pi's commands, shell and model switching from the terminal app", async () => {
  const pi = NodeURL.fileURLToPath(new URL("./node_modules/.bin/pi", import.meta.url));
  const claude = NodeURL.fileURLToPath(new URL("./node_modules/.bin", import.meta.url));
  const fake = await startAnthropic(() => ({ text: "real-pi-ok" }));
  const h = await startHarness({
    bundled: true,
    pi: {
      binaryPath: pi,
      env: {
        PATH: [
          claude,
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
  const terminal = openTui(h);
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    const prompts = NodePath.join(h.home, "caches/ozi-main-pi/prompts");
    await NodeFSP.mkdir(prompts, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(h.home, "caches/ozi-main-pi/settings.json"),
      JSON.stringify({ compaction: { keepRecentTokens: 1, reserveTokens: 1024 } }),
    );
    await NodeFSP.writeFile(
      NodePath.join(prompts, "m9-template.md"),
      "---\ndescription: m9 template\n---\nExpand me",
    );
    await terminal.waitFor(`:${h.port}`);
    terminal.keys("hello\r");
    await terminal.waitFor("real-pi-ok");
    await h.wait("ozi-main", "completed", 60);
    let from = terminal.mark();
    terminal.keys("!echo m9-shell-output\r");
    await terminal.waitFor("m9-shell-output", from);
    from = terminal.mark();
    terminal.keys("/name m9 session\r");
    await terminal.waitFor('Named main\'s session "m9 session".', from);
    const exported = NodePath.join(h.root, "main.html");
    from = terminal.mark();
    terminal.keys(`/export ${exported}\r`);
    await terminal.waitFor("Exported main's session", from);
    expect((await NodeFSP.stat(exported)).size).toBeGreaterThan(0);
    from = terminal.mark();
    terminal.keys("/compact\r");
    await terminal.waitFor("Compacted main's context.", from);
    from = terminal.mark();
    terminal.keys("/model claude-sonnet-5-5\r");
    await terminal.waitFor("claude-sonnet-5-5", from);
    expect((await h.thread("ozi-main")).thread.modelSelection.model).toBe(
      "claude-bridge/claude-sonnet-5-5",
    );
    from = terminal.mark();
    terminal.keys("\x1b[Z");
    await terminal.waitFor("xhigh", from);
    terminal.keys("again\r");
    await h.wait("ozi-main", "completed", 60);
    from = terminal.mark();
    terminal.keys("/m9-te");
    await terminal.waitFor("m9-template", from);
  } finally {
    terminal.close();
    await h.close();
    await fake.close();
  }
});
