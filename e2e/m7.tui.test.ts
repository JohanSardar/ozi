import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { OziJobCard } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness, type Rule } from "./harness.ts";
import { openTui } from "./tty.ts";

type Card = typeof OziJobCard.Encoded;
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

const down = "\x1b[B";
const jobs = () => h.ozi<Card[]>("jobs");
const wait = (id: string, column: Card["column"]) =>
  h.ozi<Card>("wait", "job", id, column, "--timeout", "20");
const delegate = (task: string): Rule["steps"][number] => ({
  tool: {
    name: "delegate_task",
    arguments: { task, title: task, mode: "async", clientRequestId: task },
  },
});
const job = async (task: string, steps: Rule["steps"], extra: Rule[] = []) => {
  await h.script([
    { match: `start ${task}`, role: "main", steps: [delegate(task), { say: `started ${task}` }] },
    { match: `^${task}$`, role: "worker", steps },
    ...extra,
    { match: ".*", provider: "pi", role: "main", steps: [{ say: "received" }], repeat: true },
  ]);
  const terminal = tty ?? (tty = openTui(h));
  await terminal.waitFor(`:${h.port}`);
  terminal.keys(`start ${task}\r`);
  await h.wait("ozi-main", `text:started ${task}`, 20);
  return (await jobs()).find((card) => card.title === task)!;
};
const openCard = async (title: string, text: string) => {
  const from = tty!.mark();
  tty!.keys("/jobs\r");
  await tty!.waitFor(title, from);
  const card = tty!.mark();
  tty!.keys("\r");
  await tty!.waitFor(text, card);
};

it("m7.tui-chat chats with main, queues, steers, stops, attaches and exits", async () => {
  const file = NodePath.join(h.root, "tui-note.txt");
  await NodeFSP.writeFile(file, "tui-attachment-content");
  await h.script([
    { match: "tui-hello", role: "main", steps: [{ say: "Reply with **bold** words" }] },
    { match: "tui-hold", role: "main", steps: [{ say: "holding now" }, { wait: true }] },
    { match: "tui-steer", role: "main", steps: [{ say: "steered now" }, { wait: true }] },
    { match: "tui-queued", role: "main", steps: [{ fail: "queue ran despite stop" }] },
    { match: "tui-note", role: "main", steps: [{ say: "file seen" }] },
  ]);
  tty = openTui(h);
  await tty.waitFor(`:${h.port}`);
  tty.keys("tui-hello\r");
  await tty.waitFor("Reply with bold words");
  expect(tty.output).not.toContain("**bold**");
  tty.keys("tui-hold\r");
  await h.wait("ozi-main", "running");
  await tty.waitFor("holding now");
  tty.keys("tui-queued\x1b\r");
  await tty.waitFor("Queued: tui-queued");
  tty.keys("tui-steer\r");
  await h.wait("ozi-main", "text:steered now", 20);
  await tty.waitFor("steered now");
  tty.keys("\x1b");
  await h.wait("ozi-main", "interrupted");
  expect((await h.thread("ozi-main")).runs.some((run) => run.status === "queued")).toBe(true);
  let from = tty.mark();
  tty.keys(`/attach ${file}\r`);
  await tty.waitFor("1 attached", from);
  tty.keys("tui-note\r");
  await h.wait("ozi-main", "text:file seen", 20);
  await tty.waitFor("file seen");
  expect(
    (await h.records()).some((record) => record.prompt?.includes("tui-attachment-content")),
  ).toBe(true);
  expect((await h.records()).some((record) => record.prompt === "tui-queued")).toBe(false);
  from = tty.mark();
  tty.keys("\x03");
  await tty.waitFor("Press Ctrl+C again to exit.", from);
  tty.keys("\x03");
  expect(await tty.exited).toBe(0);
});

it("m7.tui-question answers a worker question from the terminal", async () => {
  const card = await job("tui-question-worker", [
    { ask: "Which color?" },
    { say: "worker got $result" },
  ]);
  await wait(card.jobId, "needs_you");
  await tty!.waitFor("Needs you: tui-question-worker");
  await tty!.waitFor("needs you 1");
  await openCard("tui-question-worker", "Which color?");
  tty!.keys("\r");
  expect(JSON.stringify(await h.wait(card.jobId, "text:worker got", 20))).toContain("Yes");
  expect((await wait(card.jobId, "ready")).requests).toEqual([]);
  await tty!.waitFor("ready 1");
});

it("m7.tui-close closes a ready card and reports a stale close", async () => {
  const card = await job("tui-close-worker", [{ say: "close result" }]);
  await wait(card.jobId, "ready");
  await openCard("tui-close-worker", "close result");
  tty!.keys("\r");
  expect((await wait(card.jobId, "done")).handledEventId).not.toBeNull();
  const stale = await job(
    "tui-stale-worker",
    [{ say: "first result" }],
    [{ match: "stale follow-up", role: "worker", steps: [{ say: "second result" }] }],
  );
  const ready = await wait(stale.jobId, "ready");
  await openCard("tui-stale-worker", "first result");
  await h.ozi("thread", stale.jobId, "--message", "stale follow-up");
  await h.wait(stale.jobId, "text:second result", 20);
  const newer = await wait(stale.jobId, "ready");
  expect(newer.eventId).not.toBe(ready.eventId);
  const from = tty!.mark();
  tty!.keys("\r");
  await tty!.waitFor("StaleEvent", from);
  expect((await jobs()).find((candidate) => candidate.jobId === stale.jobId)).toMatchObject({
    column: "ready",
    eventId: newer.eventId,
  });
});

it("m7.tui-secret takes a masked secret that never reaches the screen", async () => {
  const card = await job("tui-secret-worker", [
    {
      tool: {
        name: "request_secret",
        arguments: { label: "Test credential", reason: "Connect the test service" },
      },
    },
    { say: "secret saved" },
  ]);
  await wait(card.jobId, "needs_you");
  await openCard("tui-secret-worker", "Enter secret");
  tty!.keys("\r");
  const secret = "synthetic-terminal-credential";
  tty!.keys(`${secret}\r`);
  await h.wait(card.jobId, "text:secret saved", 20);
  expect(tty!.output).not.toContain(secret);
  expect(JSON.stringify(await jobs())).not.toContain(secret);
});

it("m7.tui-lead opens a lead conversation and messages the lead", async () => {
  const card = await job(
    "tui-lead-worker",
    [{ say: "lead first reply" }],
    [{ match: "lead follow-up", role: "worker", steps: [{ say: "lead got follow-up" }] }],
  );
  await wait(card.jobId, "ready");
  await openCard("tui-lead-worker", "lead first reply");
  let from = tty!.mark();
  tty!.keys(`${down}\r`);
  await tty!.waitFor("job: tui-lead-worker", from);
  await tty!.waitFor("lead first reply", from);
  tty!.keys("lead follow-up\r");
  await h.wait(card.jobId, "text:lead got follow-up", 20);
  await tty!.waitFor("lead got follow-up", from);
  from = tty!.mark();
  tty!.keys("\x1b");
  await tty!.waitFor("main ·", from);
});
