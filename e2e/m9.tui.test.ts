import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness } from "./harness.ts";
import { openTui } from "./tty.ts";

let h: Harness;
let tty: ReturnType<typeof openTui> | undefined;
beforeEach(async () => {
  h = await startHarness();
  tty = undefined;
});
afterEach(async () => {
  tty?.close();
  await h?.close();
});

const ready = async (extra: Record<string, string> = {}) => {
  tty = openTui(h, extra);
  await tty.waitFor(`:${h.port}`);
  return tty;
};

it("m9.tui-slash passes unknown slash commands to main and keeps local ones", async () => {
  await h.script([{ match: "^/greet Bob", role: "main", steps: [{ say: "greeted" }] }]);
  const terminal = await ready();
  let from = terminal.mark();
  terminal.keys("/hotkeys\r");
  await terminal.waitFor("Ctrl+T show or hide thinking", from);
  terminal.keys("/greet Bob\r");
  await h.wait("ozi-main", "text:greeted", 20);
  const prompts = (await h.records()).filter((record) => record.role === "main" && record.prompt);
  expect(prompts.some((record) => record.prompt!.startsWith("/greet Bob"))).toBe(true);
  expect(prompts.some((record) => record.prompt!.includes("/hotkeys"))).toBe(false);
  from = terminal.mark();
  terminal.keys("\x04");
  expect(await terminal.exited).toBe(0);
  expect(from).toBeGreaterThan(0);
});

it("m9.tui-thinking shows thinking, hides it with Ctrl+T and expands tool output with Ctrl+O", async () => {
  await h.script([
    {
      match: "think-and-run",
      role: "main",
      steps: [
        { think: "planning-the-answer" },
        { exec: "for n in $(seq 1 15); do echo output-line-$n; done" },
        { say: "done thinking" },
      ],
    },
  ]);
  const terminal = await ready();
  terminal.keys("think-and-run\r");
  await terminal.waitFor("done thinking");
  await terminal.waitFor("planning-the-answer");
  await terminal.waitFor("5 more lines, ctrl+o to expand");
  expect(terminal.output).not.toContain("output-line-15");
  let from = terminal.mark();
  terminal.keys("\x14");
  await terminal.waitFor("Thinking...", from);
  from = terminal.mark();
  terminal.keys("\x0f");
  await terminal.waitFor("output-line-15", from);
});

it("m9.tui-editor edits the message in the external editor with Ctrl+G", async () => {
  const script = NodePath.join(h.root, "editor.sh");
  await NodeFSP.writeFile(script, "#!/bin/sh\nprintf 'from-external-editor' > \"$1\"\n");
  await NodeFSP.chmod(script, 0o755);
  await h.script([
    { match: "from-external-editor", role: "main", steps: [{ say: "editor text received" }] },
  ]);
  const terminal = await ready({ VISUAL: script });
  terminal.keys("draft");
  terminal.keys("\x07");
  await terminal.waitFor("from-external-editor");
  terminal.keys("\r");
  await h.wait("ozi-main", "text:editor text received", 20);
});
