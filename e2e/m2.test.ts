import type { OziJobCard } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { startHarness, type Harness, type Rule } from "./harness.ts";

type Card = typeof OziJobCard.Encoded;
let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h?.close();
});
const jobs = () => h.ozi<Card[]>("jobs");
const wait = (id: string, column: Card["column"]) =>
  h.ozi<Card>("wait", "job", id, column, "--timeout", "20");
const delegate = (task: string, extra: Record<string, unknown> = {}): Rule["steps"][number] => ({
  tool: {
    name: "delegate_task",
    arguments: { task, title: task, mode: "async", clientRequestId: task, ...extra },
  },
});
const sent = (threadId: string, message: string): Rule["steps"][number] => ({
  tool: {
    name: "t3_thread_send",
    arguments: { threadId, message, mode: "auto", clientRequestId: message },
  },
});
const script = (rules: Rule[]) =>
  h.script([
    ...rules,
    { match: ".*", role: "worker", steps: [{ say: "helper result received" }], repeat: true },
    { match: ".*", provider: "pi", role: "main", steps: [{ say: "received" }], repeat: true },
  ]);
const start = async (task: string, steps: Rule["steps"], extra: Rule[] = []) => {
  await script([
    { match: "m2-start", role: "main", steps: [delegate(task), { say: "started" }] },
    { match: `^${task}$`, role: "worker", steps },
    ...extra,
  ]);
  await h.ozi("say", "m2-start");
  await h.ozi("wait", "thread", "ozi-main", "text:started", "--timeout", "20");
  return (await jobs())[0]!;
};

it("m2.lead-card shows a running lead with its request and agent immediately", async () => {
  const card = await start("lead-work", [{ wait: true }]);
  expect(await jobs()).toHaveLength(1);
  expect(await wait(card.jobId, "running")).toMatchObject({
    agent: { provider: "codex", model: "gpt-6.1-sol" },
    title: "lead-work",
    report: null,
    handledEventId: null,
  });
  expect(card.requestEventId).toBeTruthy();
  const lead = await h.thread(card.jobId);
  expect(lead.thread).toMatchObject({ jobId: card.jobId, visibility: "user", role: "worker" });
  expect((await h.thread("ozi-main")).thread.jobId).toBeNull();
  expect(await h.ozi("job", card.jobId)).toHaveProperty("lead");
  const current = (await jobs())[0]!;
  await h.ozi("close", card.jobId, current.eventId);
  await wait(card.jobId, "done");
  expect((await h.thread(card.jobId)).runs.some((run) => run.status === "running")).toBe(true);
});

it("m2.helper-same-job aggregates descendants into the lead card", async () => {
  const card = await start(
    "lead-with-helper",
    [
      delegate("helper-work"),
      delegate("helper-work"),
      delegate("forbidden-job-selection", { jobId: "$result.childThreadId" }),
      { say: "helper started" },
      { wait: true },
    ],
    [{ match: "^helper-work$", role: "worker", steps: [{ wait: true }] }],
  );
  await h.ozi("wait", "thread", card.jobId, "text:helper started", "--timeout", "20");
  const threads = (await h.status()).snapshot.threads.filter(
    (thread) => thread.jobId === card.jobId,
  );
  expect(threads).toHaveLength(2);
  expect(threads.find((thread) => thread.id !== card.jobId)?.lineage.parentThreadId).toBe(
    card.jobId,
  );
  expect(await jobs()).toHaveLength(1);
  expect(
    (await h.records()).some(
      (record) =>
        record.event === "tool" && record.name === "delegate_task" && record.result?.isError,
    ),
  ).toBe(true);
});

it("m2.second-outcome creates a separate card for an unrelated request", async () => {
  const first = await start("first-outcome", [{ wait: true }]);
  await script([
    {
      match: "second-request",
      role: "main",
      steps: [
        delegate("second-outcome"),
        delegate("attached-work", { jobId: first.jobId }),
        { say: "second started" },
      ],
    },
    { match: "second-outcome", role: "worker", steps: [{ wait: true }] },
    { match: "attached-work", role: "worker", steps: [{ wait: true }] },
  ]);
  await h.ozi("say", "second-request");
  await h.ozi("wait", "thread", "ozi-main", "text:second started", "--timeout", "20");
  const cards = await jobs();
  expect(cards).toHaveLength(2);
  expect(new Set(cards.map((card) => card.jobId)).size).toBe(2);
  expect(cards.some((card) => card.jobId === first.jobId)).toBe(true);
  expect(
    (await h.status()).snapshot.threads.filter((thread) => thread.jobId === first.jobId),
  ).toHaveLength(2);
  const second = cards.find((card) => card.jobId !== first.jobId)!;
  await expect(h.ozi("close", second.jobId, first.eventId)).rejects.toThrow("WrongJob");
  await expect(h.ozi("close", "unknown-job", first.eventId)).rejects.toThrow("UnknownJob");
});

it("m2.followup-lead sends related follow-up work to the existing lead", async () => {
  const card = await start("original-outcome", [{ say: "original result" }]);
  await h.wait(card.jobId, "completed");
  await script([
    {
      match: "related-request",
      role: "main",
      steps: [sent(card.jobId, "related-work"), { say: "follow-up sent" }],
    },
    { match: "related-work", role: "worker", steps: [{ say: "related result" }] },
  ]);
  await h.ozi("say", "related-request");
  await h.ozi("wait", "thread", card.jobId, "text:related result", "--timeout", "20");
  expect(await jobs()).toHaveLength(1);
  expect((await h.thread(card.jobId)).runs).toHaveLength(2);
});

it("m2.question-card routes a helper question and answer to its owner", async () => {
  const card = await start(
    "question-lead",
    [delegate("question-helper"), { say: "helper started" }, { wait: true }],
    [
      {
        match: "^question-helper$",
        role: "worker",
        steps: [{ ask: "Which color?" }, { say: "helper resumed: $result" }],
      },
    ],
  );
  const pending = await wait(card.jobId, "needs_you");
  const request = pending.requests.find((request) => request.kind === "question")!;
  expect(request).toMatchObject({ prompt: "Which color?", options: ["Yes"] });
  expect(request.threadId).not.toBe(card.jobId);
  await h.ozi("close", card.jobId, pending.eventId);
  expect((await wait(card.jobId, "done")).requests).toEqual(pending.requests);
  await h.ozi("answer", request.id, "Blue");
  const helper = await h.ozi(
    "wait",
    "thread",
    request.threadId,
    "text:helper resumed",
    "--timeout",
    "20",
  );
  expect(JSON.stringify(helper)).toContain("Blue");
  expect((await wait(card.jobId, "running")).requests).toEqual([]);
});

it("m2.approval-card delivers deny and allow to the worker", async () => {
  const card = await start("approval-worker", [
    { approval: "first command" },
    { say: "first decision: $result" },
    { approval: "second command" },
    { say: "second decision: $result" },
  ]);
  const first = (await wait(card.jobId, "needs_you")).requests[0]!;
  expect(first).toMatchObject({
    kind: "approval",
    threadId: card.jobId,
    options: ["allow", "deny"],
  });
  await h.ozi("answer", first.id, "deny");
  await h.ozi("wait", "thread", card.jobId, "text:first decision", "--timeout", "20");
  const second = (await wait(card.jobId, "needs_you")).requests[0]!;
  expect(second.id).not.toBe(first.id);
  await h.ozi("answer", second.id, "allow");
  const lead = await h.ozi("wait", "thread", card.jobId, "text:second decision", "--timeout", "20");
  expect(JSON.stringify(lead)).toContain("decline");
  expect(JSON.stringify(lead)).toContain("accept");
});

it("m2.secret-card keeps the entered secret out of card and transcript data", async () => {
  const card = await start("secret-worker", [
    {
      tool: {
        name: "request_secret",
        arguments: { label: "Test credential", reason: "Connect the test service" },
      },
    },
    { say: "secret saved" },
  ]);
  const request = (await wait(card.jobId, "needs_you")).requests.find(
    (request) => request.kind === "secret",
  )!;
  expect(request).toMatchObject({ threadId: card.jobId, options: [] });
  const secret = "synthetic-credential-for-m2";
  await h.ozi("answer", request.id, secret);
  await h.ozi("wait", "thread", card.jobId, "text:secret saved", "--timeout", "20");
  expect(JSON.stringify(await jobs())).not.toContain(secret);
  expect(JSON.stringify(await h.thread(card.jobId))).not.toContain(secret);
  expect((await wait(card.jobId, "running")).requests).toEqual([]);
});

it("m2.awaits-check keeps a completed lead running and checking", async () => {
  const card = await start("finished-worker", [{ say: "finished result" }]);
  await h.wait(card.jobId, "completed");
  expect(await wait(card.jobId, "running")).toMatchObject({
    checking: true,
    status: "Checking",
    report: null,
  });
  await expect(h.ozi("wait", "job", card.jobId, "ready", "--timeout", "0.1")).rejects.toThrow();
});

it("m2.main-without-worker preserves unavailable and failed launches as blocked leads", async () => {
  await script([
    {
      match: "unavailable-request",
      role: "main",
      steps: [
        delegate("unavailable-worker", {
          target: { providerInstanceId: "unavailable", model: "missing" },
        }),
        { say: "blocker recorded" },
      ],
    },
  ]);
  await h.ozi("say", "unavailable-request");
  await h.ozi("wait", "thread", "ozi-main", "text:blocker recorded", "--timeout", "20");
  const card = (await jobs())[0]!;
  expect(await wait(card.jobId, "needs_you")).toMatchObject({
    requests: [expect.objectContaining({ kind: "blocked" })],
  });
  expect((await h.thread(card.jobId)).runs).toEqual([]);
  await script([
    {
      match: "failed-request",
      role: "main",
      steps: [delegate("failed-worker"), { say: "failure started" }],
    },
    { match: "failed-worker", role: "worker", steps: [{ fail: "Scripted launch failure" }] },
  ]);
  await h.ozi("say", "failed-request");
  await h.ozi("wait", "thread", "ozi-main", "text:failure started", "--timeout", "20");
  const failed = (await jobs()).find((job) => job.jobId !== card.jobId)!;
  await wait(failed.jobId, "needs_you");
});

it("m2.restart preserves cards and exact-event close receipts across restart", async () => {
  const card = await start("durable-worker", [{ say: "durable result" }]);
  await h.wait(card.jobId, "completed");
  const current = (await jobs())[0]!;
  await script([
    {
      match: "invalid-evidence",
      role: "main",
      steps: [
        {
          tool: {
            name: "handle_job",
            arguments: {
              commandId: "m2-close-once",
              jobId: card.jobId,
              eventId: current.eventId,
              evidence: { type: "accepted", userMessageId: "unchecked-user-message" },
            },
          },
        },
        { say: "invalid evidence rejected" },
      ],
    },
  ]);
  await h.ozi("say", "invalid-evidence");
  await h.ozi("wait", "thread", "ozi-main", "text:invalid evidence rejected", "--timeout", "20");
  expect(
    (await h.records()).findLast((record) => record.name === "handle_job")?.result?.isError,
  ).toBe(true);
  expect((await jobs())[0]!.handledEventId).toBeNull();
  const receipt = await h.ozi(
    "close",
    card.jobId,
    current.eventId,
    "--command-id",
    "m2-close-once",
  );
  const closed = await wait(card.jobId, "done");
  expect(
    await h.ozi("close", card.jobId, current.eventId, "--command-id", "m2-close-once"),
  ).toEqual(receipt);
  await h.restart();
  expect(await jobs()).toEqual([closed]);
  expect(
    await h.ozi("close", card.jobId, current.eventId, "--command-id", "m2-close-once"),
  ).toEqual(receipt);
  await script([
    {
      match: "reopen-request",
      role: "main",
      steps: [sent(card.jobId, "new-work"), { say: "reopened" }],
    },
    { match: "new-work", role: "worker", steps: [{ say: "new result" }] },
  ]);
  await h.ozi("say", "reopen-request");
  await h.ozi("wait", "thread", card.jobId, "text:new result", "--timeout", "20");
  await wait(card.jobId, "running");
  await expect(h.ozi("close", card.jobId, current.eventId)).rejects.toThrow("StaleEvent");
  expect(await jobs()).toHaveLength(1);
});
