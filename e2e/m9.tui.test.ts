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

it("m9.tui-appearance applies Pi's theme and keybindings from the local Pi agent directory", async () => {
  const agent = h.env.PI_CODING_AGENT_DIR!;
  await NodeFSP.mkdir(NodePath.join(agent, "themes"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(agent, "settings.json"),
    JSON.stringify({ theme: "ozi-red" }),
  );
  await NodeFSP.writeFile(
    NodePath.join(agent, "themes/ozi-red.json"),
    JSON.stringify({ name: "ozi-red", colors: { text: "#ff0000" } }),
  );
  await NodeFSP.writeFile(
    NodePath.join(agent, "keybindings.json"),
    JSON.stringify({ "app.thinking.toggle": "ctrl+y" }),
  );
  await h.script([
    {
      match: "themed",
      role: "main",
      steps: [{ think: "themed-thinking" }, { say: "themed reply" }],
    },
  ]);
  const terminal = await ready({ COLORTERM: "truecolor" });
  terminal.keys("themed\r");
  await terminal.waitFor("themed reply");
  expect(terminal.raw).toContain("38;2;255;0;0");
  const from = terminal.mark();
  terminal.keys("\x19");
  await terminal.waitFor("Thinking...", from);
});

it("m9.tui-footer-dequeue shows model, thinking and usage and restores queued messages with Alt+Up", async () => {
  await h.script([
    { match: "first-turn", role: "main", steps: [{ say: "first done" }] },
    { match: "hold-main", role: "main", steps: [{ say: "holding main" }, { wait: true }] },
    { match: "queued-follow-up", role: "main", steps: [{ fail: "queued message ran" }] },
  ]);
  const terminal = await ready();
  await terminal.waitFor("claude-opus-5-5 · high");
  terminal.keys("first-turn\r");
  await terminal.waitFor("first done");
  await h.wait("ozi-main", "completed");
  await terminal.waitFor("↑");
  terminal.keys("hold-main\r");
  await h.wait("ozi-main", "running");
  await terminal.waitFor("holding main");
  terminal.keys("queued-follow-up\x1b\r");
  await terminal.waitFor("Queued: queued-follow-up");
  const from = terminal.mark();
  terminal.keys("\x1b[1;3A");
  await terminal.waitFor("queued-follow-up", from);
  terminal.keys("\x1b");
  await h.wait("ozi-main", "interrupted");
  const runs = (await h.thread("ozi-main")).runs;
  expect(runs.some((run) => run.status === "queued")).toBe(false);
});

it("m9.tui-media shows image attachments inline, copies main's reply, prints session stats and attaches @-mentioned files", async () => {
  const image = NodePath.join(h.root, "pixel.png");
  await NodeFSP.writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  await h.script([
    { match: "look at this", role: "main", steps: [{ say: "copy-me reply" }] },
    { match: "read this", role: "main", steps: [{ say: "mention-ok" }] },
  ]);
  const terminal = await ready();
  terminal.keys(`/attach ${image}\r`);
  await terminal.waitFor("1 attached");
  terminal.keys("look at this\r");
  await terminal.waitFor("copy-me reply");
  await terminal.waitFor("[Image: pixel.png [image/png] 1x1]");
  terminal.keys("/copy\r");
  await terminal.waitFor("Copied main's last reply.");
  expect(terminal.raw).toContain(`\x1b]52;c;${Buffer.from("copy-me reply").toString("base64")}`);
  const from = terminal.mark();
  terminal.keys("/session\r");
  await terminal.waitFor("messages: 1 from you, 1 from Ozi", from);
  await NodeFSP.writeFile(NodePath.join(h.dataRoot, "mention.txt"), "mentioned-content");
  terminal.keys("@mention.txt read this\r");
  const mentioned = await h.wait("ozi-main", "text:mention-ok", 20);
  expect(
    mentioned.messages
      .findLast((message) => message.role === "user")
      ?.attachments.map((attachment) => attachment.name),
  ).toEqual(["mention.txt"]);
});

it("m9.tui-sessions clones, forks from an earlier message, resumes and shows the tree", async () => {
  await h.script([
    { match: "^session-one$", steps: [{ say: "reply-one" }] },
    { match: "^session-two$", steps: [{ say: "reply-two" }] },
    { match: "^in-clone$", steps: [{ say: "clone-reply" }] },
    { match: "^session-two-edited$", steps: [{ say: "fork-reply" }] },
    { match: "^in-new$", steps: [{ say: "new-reply" }] },
  ]);
  const terminal = await ready();
  terminal.keys("session-one\r");
  await h.wait("ozi-main", "text:reply-one", 20);
  terminal.keys("session-two\r");
  await h.wait("ozi-main", "text:reply-two", 20);
  await h.wait("ozi-main", "idle", 20);
  let from = terminal.mark();
  terminal.keys("/clone\r");
  await terminal.waitFor("main clone · ", from);
  await terminal.waitFor("reply-two", from);
  terminal.keys("/name main clone\r");
  await terminal.waitFor('Named the session "main clone".', from);
  terminal.keys("in-clone\r");
  await terminal.waitFor("clone-reply", from);
  const threads = async () => (await h.status()).snapshot.threads;
  const clone = (await threads()).find((thread) => thread.title === "main clone")!;
  expect(clone.role).toBe("main-fork");
  expect(JSON.stringify((await h.thread("ozi-main")).messages)).not.toContain("in-clone");
  from = terminal.mark();
  terminal.keys("/resume\r");
  await terminal.waitFor("• main clone", from);
  terminal.keys("\x1b[B\r");
  await terminal.waitFor("main · ", from);
  await terminal.waitFor("reply-two", from);
  from = terminal.mark();
  terminal.keys("/fork\r");
  await terminal.waitFor("→ session-two", from);
  terminal.keys("\r");
  await terminal.waitFor("main fork · ", from);
  terminal.keys("-edited\r");
  await terminal.waitFor("fork-reply", from);
  const main = await h.thread("ozi-main");
  const fork = (await threads()).find((thread) => thread.title === "main fork")!;
  expect(fork.forkedFrom).toEqual({ type: "run", threadId: "ozi-main", runId: main.runs[0]!.id });
  from = terminal.mark();
  terminal.keys("/tree\r");
  await terminal.waitFor("  • main fork", from);
  await terminal.waitFor("  main clone", from);
  terminal.keys("\x03");
  from = terminal.mark();
  terminal.keys("/new\r");
  await terminal.waitFor("New session · ", from);
  terminal.keys("in-new\r");
  await terminal.waitFor("new-reply", from);
  const fresh = (await threads()).find((thread) => thread.title === "New session")!;
  expect(fresh).toMatchObject({ role: "main-fork", forkedFrom: null });
  expect(JSON.stringify((await h.thread(fresh.id)).messages)).not.toContain("session-one");
  from = terminal.mark();
  terminal.keys("/reload\r");
  await terminal.waitFor("Pi reloads on the session's next turn.", from);
  from = terminal.mark();
  terminal.keys("/fork\r");
  await terminal.waitFor("→ in-new", from);
  terminal.keys("\r");
  await terminal.waitFor("New session fork · ", from);
  terminal.keys("\r");
  const again = (await threads()).find((thread) => thread.title === "New session fork")!;
  expect(again.forkedFrom).toBeNull();
  await h.wait(again.id, "text:new-reply", 20);
  terminal.close();
  tty = openTui(h, {}, ["-c"]);
  await tty.waitFor("New session fork · ");
  tty.close();
  tty = openTui(h, {}, ["--session", clone.id.slice(0, 13)]);
  await tty.waitFor("main clone · ");
  tty.close();
  tty = openTui(h, {}, ["-r"]);
  await tty.waitFor("→ • main");
  tty.keys("main clone");
  await tty.waitFor("Search: main clone");
  tty.keys("\x12");
  await tty.waitFor("Rename session");
  tty.keys("\x15renamed clone");
  await tty.waitFor("> renamed clone");
  tty.keys("\r");
  await tty.waitFor('Renamed to "renamed clone".');
  expect((await threads()).find((thread) => thread.id === clone.id)?.title).toBe("renamed clone");
  from = tty.mark();
  tty.keys("/resume\r");
  await tty.waitFor("Type to search", from);
  tty.keys("renamed");
  await tty.waitFor("Search: renamed", from);
  tty.keys("\x04");
  await tty.waitFor('Delete "renamed clone"', from);
  tty.keys("\x1b[B\r");
  await tty.waitFor('Deleted "renamed clone".', from);
  const listed = await h.ozi<Array<{ id: string }>>("session", "list");
  expect(listed.some((session) => session.id === clone.id)).toBe(false);
});
