import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import { startHarness } from "./harness.ts";
import { startAnthropic } from "./fakes/anthropic.ts";
import { openTui } from "./tty.ts";

const realPi = async (settings?: Record<string, unknown>) => {
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
  if (settings)
    await NodeFSP.writeFile(
      NodePath.join(h.env.PI_CODING_AGENT_DIR!, "settings.json"),
      JSON.stringify(settings),
    );
  const terminal = openTui(h);
  return {
    h,
    terminal,
    close: async () => {
      terminal.close();
      await h.close();
      await fake.close();
    },
  };
};

it("m9.tui-pi-commands runs Pi's commands, shell and model switching from the terminal app", async () => {
  const { h, terminal, close } = await realPi();
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
    await close();
  }
});

it("m9.tui-extension-ui shows Pi extension UI and answers its dialogs in the terminal app", async () => {
  const { h, terminal, close } = await realPi();
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    const extensions = NodePath.join(h.home, "caches/ozi-main-pi/extensions");
    await NodeFSP.mkdir(extensions, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(extensions, "ui-tui.js"),
      `
export default function (pi) {
  pi.registerCommand("ui-tui", {
    description: "Terminal extension UI",
    handler: async (_args, ctx) => {
      ctx.ui.notify("tui-note");
      ctx.ui.setStatus("demo", "tui-status");
      ctx.ui.setWidget("demo", ["tui-widget-line"]);
      ctx.ui.setEditorText("tui-draft");
      const choice = await ctx.ui.select("Pick one", ["Red", "Blue"]);
      ctx.ui.notify("picked:" + choice);
      const text = await ctx.ui.editor("Edit me", "prefill");
      ctx.ui.notify("edited:" + text);
      const allowed = await ctx.ui.confirm("Sure?", "Continue?");
      ctx.ui.notify("confirmed:" + allowed);
    },
  });
}
`,
    );
    await terminal.waitFor(`:${h.port}`);
    terminal.keys("hello\r");
    await terminal.waitFor("real-pi-ok");
    await h.wait("ozi-main", "completed", 60);
    terminal.keys("/ui-tui\r");
    await terminal.waitFor("tui-note");
    await terminal.waitFor("tui-status");
    await terminal.waitFor("tui-widget-line");
    await terminal.waitFor("Pick one");
    let from = terminal.mark();
    terminal.keys("\x1b[B\r");
    await terminal.waitFor("picked:Blue", from);
    await terminal.waitFor("Edit me", from);
    from = terminal.mark();
    terminal.keys(" more\r");
    await terminal.waitFor("edited:prefill more", from);
    await terminal.waitFor("Sure?", from);
    from = terminal.mark();
    terminal.keys("\r");
    await terminal.waitFor("confirmed:true", from);
    expect(terminal.output).toContain("tui-draft");
  } finally {
    await close();
  }
});

it("m9.tui-settings changes main's and the terminal's settings and scopes Ctrl+P models", async () => {
  const { h, terminal, close } = await realPi({
    enabledModels: ["claude-bridge/claude-sonnet-5-5", "claude-bridge/claude-opus-5-5"],
  });
  const local = NodePath.join(h.env.PI_CODING_AGENT_DIR!, "settings.json");
  const read = async (file: string) => JSON.parse(await NodeFSP.readFile(file, "utf8"));
  try {
    await h.ozi("wait", "provider", "pi", "ready", "--timeout", "30");
    await terminal.waitFor(`:${h.port}`);
    terminal.keys("hello\r");
    await terminal.waitFor("real-pi-ok");
    await h.wait("ozi-main", "completed", 60);
    let from = terminal.mark();
    terminal.keys("/settings\r");
    await terminal.waitFor("Auto-compact", from);
    terminal.keys("\r");
    await terminal.waitFor("Auto-compact off.", from);
    expect(
      (await read(NodePath.join(h.home, "caches/ozi-main-pi/settings.json"))).compaction,
    ).toMatchObject({ enabled: false });
    terminal.keys("\x1b[B\x1b[B\x1b[B\r");
    await terminal.waitFor(`Saved to ${local}.`, from);
    expect(await read(local)).toMatchObject({ hideThinkingBlock: true });
    terminal.keys("\x03");
    from = terminal.mark();
    terminal.keys("\x10");
    await terminal.waitFor("claude-sonnet-5-5", from);
    expect((await h.thread("ozi-main")).thread.modelSelection.model).toBe(
      "claude-bridge/claude-sonnet-5-5",
    );
    from = terminal.mark();
    terminal.keys("\x10");
    await terminal.waitFor("claude-opus-5-5", from);
    expect((await h.thread("ozi-main")).thread.modelSelection.model).toBe(
      "claude-bridge/claude-opus-5-5",
    );
    from = terminal.mark();
    terminal.keys("/scoped-models\r");
    await terminal.waitFor("Enter/Space to change", from);
    terminal.keys("\r");
    await terminal.waitFor(`Saved to ${local}.`, from);
    expect((await read(local)).enabledModels).toEqual(["claude-bridge/claude-sonnet-5-5"]);
  } finally {
    await close();
  }
});
