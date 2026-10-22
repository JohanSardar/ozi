import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import type { OziCheck, OziJobCard } from "@t3tools/contracts";
import { startHarness, type Harness, type Rule, type Step } from "./harness.ts";

let h: Harness;
let sequence: number;
beforeEach(async () => {
  h = await startHarness();
  sequence = 0;
});
afterEach(async () => {
  await h?.close();
});
const checks = (threadId?: string) => h.ozi<OziCheck[]>("checks", ...(threadId ? [threadId] : []));
const cards = () => h.ozi<OziJobCard[]>("jobs");
const job = async (id: string) => (await cards()).find((card) => card.jobId === id)!;
const waitJob = (id: string, state: string) => h.ozi("wait", "job", id, state, "--timeout", "40");
const waitCheck = (id: string, state: string) =>
  h.ozi("wait", "check", id, state, "--timeout", "40");
const verdict = (match: string, value: object, steps: Step[] = []): Rule => ({
  match,
  role: "checker",
  repeat: true,
  steps: [...steps, { say: JSON.stringify(value) }],
});
const done = { verdict: "done", useful: true };
const again = (missing = "Finish the remaining obligation.") => ({
  verdict: "continue",
  missing,
  evidence: [],
  useful: true,
});
const start = async (
  options: {
    steps?: Step[];
    rules?: Rule[];
    provider?: "codex" | "pi" | "claudeAgent";
    forkWait?: boolean;
  } = {},
) => {
  const n = ++sequence;
  const provider = options.provider ?? "codex";
  await h.script(
    [
      ...(options.rules ?? []),
      {
        match: `^start-${n}$`,
        role: "main",
        steps: [
          {
            tool: {
              name: "delegate_task",
              arguments: {
                task: `work-${n}`,
                title: `Outcome ${n}`,
                mode: "async",
                clientRequestId: `outcome-${n}`,
                target:
                  provider === "codex"
                    ? undefined
                    : {
                        providerInstanceId: provider,
                        model:
                          provider === "pi" ? "claude-bridge/claude-opus-5-5" : "claude-opus-5-5",
                      },
              },
            },
          },
          { say: `started-${n}` },
        ],
      },
      { match: `^work-${n}$`, role: "worker", steps: options.steps ?? [{ say: "finished" }] },
      { match: ".*", role: "main", repeat: true, steps: [{ say: "coordinated" }] },
    ],
    options.forkWait ? { forkWait: ["codex"] } : undefined,
  );
  await h.ozi("say", `start-${n}`);
  const main = await h.wait("ozi-main", `text:started-${n}`);
  const child = main.subagents.findLast(
    (task) => task.origin === "app_owned" && task.prompt === `work-${n}`,
  )?.childThreadId;
  expect(child).toBeTruthy();
  return child!;
};
const claim = async (threadId: string) => {
  await h.wait(threadId, "completed");
  const rows = await checks(threadId);
  expect(rows.length).toBeGreaterThan(0);
  return rows.at(-1)!;
};
const displayed = (card: OziJobCard) => card.eventId;

it("m3.worker-done checks worker outcomes and explicit completion without prose", async () => {
  const id = await start();
  await waitJob(id, "ready");
  expect((await job(id)).report?.text).toBe("finished");
  const rows = await checks(id);
  expect(rows.at(-1)?.state).toBe("checked");
  expect(rows.at(-1)?.rounds[0]?.verdict).toEqual(done);
  expect(rows.at(-1)?.rounds[0]?.tokens).toBeGreaterThan(0);
  const empty = await start({ steps: [] });
  await waitJob(empty, "ready");
  expect((await checks(empty)).at(-1)?.reportItemId).toBeNull();
  for (const provider of ["pi", "claudeAgent"] as const) {
    const other = await start({ provider });
    await waitJob(other, "ready");
    expect((await checks(other)).at(-1)?.rounds.at(-1)?.tokens).toBeGreaterThan(0);
  }
});

it("m3.continue resumes the original worker before releasing its report", async () => {
  const id = await start({
    steps: [{ say: "unfinished" }],
    rules: [
      verdict("Claim: unfinished$", again("Complete the final action.")),
      { match: "Complete the final action", role: "worker", steps: [{ say: "finished" }] },
    ],
  });
  await waitJob(id, "ready");
  expect((await checks(id)).map((check) => check.state)).toEqual(["continued", "checked"]);
  expect((await h.thread(id)).runs).toHaveLength(2);
});

it("m3.blocked counts three rounds without verified progress", async () => {
  const id = await start({
    steps: [{ say: "unchanged" }],
    rules: [
      verdict("Claim: unchanged$", again()),
      {
        match: "Finish the remaining obligation",
        role: "worker",
        repeat: true,
        steps: [{ say: "unchanged" }],
      },
    ],
  });
  await waitJob(id, "needs_you");
  const rows = await checks(id);
  expect(rows.map((check) => check.unsuccessfulRounds)).toEqual([1, 2, 3]);
  expect(rows.at(-1)?.state).toBe("blocked");
  expect((await job(id)).status).toMatch(/blocked/i);
});

it("m3.progress-resets resets only for new verified evidence", async () => {
  const id = await start({
    steps: [{ wait: true }],
    rules: [
      { match: "begin proof", role: "worker", steps: [{ say: "first" }] },
      verdict("Claim: first$", again("Second pass.")),
      verdict("Claim: second$", { ...again("Third pass."), evidence: ["$result.evidence"] }, [
        { tool: { name: "completion_evidence", arguments: { path: "proof.txt" } } },
      ]),
      verdict("Claim: third$", { ...again("Final pass."), evidence: ["$result.evidence"] }, [
        { tool: { name: "completion_evidence", arguments: { path: "proof.txt" } } },
      ]),
      { match: "Second pass", role: "worker", steps: [{ say: "second" }] },
      { match: "Third pass", role: "worker", steps: [{ say: "third" }] },
      { match: "Final pass", role: "worker", steps: [{ say: "finished" }] },
    ],
  });
  await h.wait(id, "running");
  const cwd = (await h.thread(id)).providerSessions.at(-1)!.cwd;
  await NodeFSP.writeFile(NodePath.join(cwd, "proof.txt"), "verified fact");
  await h.ozi("steer", "begin proof", "--thread", id);
  await waitJob(id, "ready");
  expect((await checks(id)).map((check) => check.unsuccessfulRounds)).toEqual([1, 0, 1, 0]);
  expect((await checks(id))[1]?.evidence).toHaveLength(1);
});

it("m3.main-checked checks text-only main claims and makes main delegate gaps", async () => {
  await h.script([
    { match: "^main request$", role: "main", steps: [{ say: "main unfinished" }] },
    verdict("Claim: main unfinished$", again("Delegate the remaining action.")),
    {
      match: "Delegate the remaining action",
      role: "main",
      steps: [
        {
          tool: {
            name: "delegate_task",
            arguments: { task: "main gap", mode: "async", clientRequestId: "main-gap" },
          },
        },
        { say: "delegated" },
      ],
    },
    { match: "^main gap$", role: "worker", steps: [{ say: "gap finished" }] },
    { match: ".*", role: "main", repeat: true, steps: [{ say: "main coordinated" }] },
  ]);
  await h.ozi("say", "main request");
  await h.wait("ozi-main", "text:main coordinated");
  const main = await h.thread("ozi-main");
  expect(main.subagents).toHaveLength(1);
  expect((await checks("ozi-main"))[0]?.state).toBe("continued");
});

it("m3.no-recursion keeps checkers internal and limits them to evidence tools", async () => {
  const id = await start({
    rules: [
      verdict("Claim: finished$", done, [
        { tool: { name: "delegate_task", arguments: { task: "forbidden" } } },
      ]),
    ],
  });
  await waitJob(id, "ready");
  const rows = await checks();
  for (const row of rows)
    for (const round of row.rounds) {
      const projection = await h.thread(round.checkerThreadId);
      expect(projection.thread).toMatchObject({ role: "checker", visibility: "internal" });
      expect(projection.runs.every((run) => run.completionCheck === undefined)).toBe(true);
      expect(await checks(round.checkerThreadId)).toEqual([]);
      expect(projection.thread.effectiveLoadout?.toolNames).toEqual([
        "t3_thread_read",
        "completion_evidence",
      ]);
    }
  expect(
    (await h.records()).find((record) => record.name === "delegate_task" && record.result?.isError)
      ?.result?.isError,
  ).toBe(true);
  expect((await h.status()).snapshot.threads.some((thread) => thread.role === "checker")).toBe(
    false,
  );
});

it("m3.fork-intact leaves all three native source sessions unchanged and usable", async () => {
  for (const provider of ["codex", "pi", "claudeAgent"] as const) {
    const id = await start({
      provider,
      rules: [
        {
          match: "Claim: finished$",
          role: "checker",
          repeat: true,
          steps: [{ say: "checker paused" }, { wait: true }],
        },
      ],
    });
    const check = await claim(id);
    const child = check.rounds.at(-1)?.checkerThreadId ?? `${check.id}:round:1`;
    await h.wait(child, "text:checker paused");
    const before = await h.thread(id);
    const source = before.providerThreads.find(
      (thread) => thread.id === before.runs.at(-1)?.providerThreadId,
    )!;
    const nativeId = source.nativeThreadRef!.nativeId;
    const settled = (await h.records()).findLast(
      (record) => record.event === "native_settled" && record.nativeId === nativeId,
    )!;
    expect(settled).toBeTruthy();
    const digest = NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(settled.file!))
      .digest("hex");
    expect(digest).toBe(settled.sha256);
    const fork = await h.thread(child);
    expect(
      fork.contextTransfers.some((transfer) => transfer.resolution?.strategy === "native_fork"),
    ).toBe(true);
    expect(fork.providerThreads.at(-1)?.nativeThreadRef?.nativeId).not.toBe(nativeId);
    await h.script([
      { match: "source next turn", role: "worker", steps: [{ say: "source usable" }] },
      { match: ".*", role: "main", repeat: true, steps: [{ say: "coordinated" }] },
    ]);
    await h.ozi("thread", id, "--message", "source next turn");
    await h.wait(id, "text:source usable");
    const after = await h.thread(id);
    expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages);
    expect(
      after.providerThreads.find((thread) => thread.id === after.runs.at(-1)?.providerThreadId)
        ?.nativeThreadRef?.nativeId,
    ).toBe(nativeId);
    expect((await checks(id))[0]?.state).toBe("superseded");
    const launch = (await h.records()).filter(
      (record) => record.provider === "pi" && record.argv?.includes("--fork"),
    );
    if (provider === "pi") expect(launch.length).toBeGreaterThan(0);
  }
});

it("m3.bad-verdict counts malformed verdicts and provider errors without passing", async () => {
  for (const steps of [
    [{ say: "not JSON" }],
    [{ fail: "checker unavailable" }],
  ] satisfies Step[][]) {
    const id = await start({
      rules: [{ match: "Claim: finished$", role: "checker", repeat: true, steps }],
    });
    await waitJob(id, "needs_you");
    const row = (await checks(id)).at(-1)!;
    expect(row.state).toBe("blocked");
    expect(row.rounds).toHaveLength(3);
    expect(row.rounds.every((round) => round.verdict === null && round.error !== null)).toBe(true);
  }
});

it("m3.steer-supersedes discards late verdicts and preserves the newer request", async () => {
  const id = await start({
    steps: [{ say: "old report" }],
    rules: [
      {
        match: "Claim: old report$",
        role: "checker",
        steps: [{ say: "checker paused" }, { wait: true }],
      },
      { match: "new request", role: "worker", steps: [{ say: "new report" }] },
      verdict("release verdict", done),
    ],
  });
  const row = await claim(id);
  const child = row.rounds.at(-1)?.checkerThreadId ?? `${row.id}:round:1`;
  await h.wait(child, "text:checker paused");
  await h.ozi("steer", "new request", "--thread", id);
  await waitJob(id, "ready");
  const current = await job(id);
  await h.ozi("steer", "release verdict", "--thread", child);
  await h.wait(child, "completed");
  await waitCheck(row.id, "superseded");
  expect((await job(id)).eventId).toBe(current.eventId);
  expect((await job(id)).report?.text).toBe("new report");
  expect(
    (await h.thread("ozi-main")).messages.some((message) => message.text.includes("old report")),
  ).toBe(false);
});

it("m3.stop-unchecked excludes stopped work from checking", async () => {
  const id = await start({ steps: [{ say: "partial" }, { wait: true }] });
  await h.wait(id, "text:partial");
  await h.ozi("stop", "--thread", id);
  await h.wait(id, "interrupted");
  expect(await checks(id)).toEqual([]);
  expect((await job(id)).column).not.toBe("done");
});

it("m3.needs-user surfaces checker blockers immediately", async () => {
  const id = await start({
    rules: [
      verdict("Claim: finished$", {
        verdict: "needs_user",
        reason: "Choose the destination account.",
        useful: true,
      }),
    ],
  });
  await waitJob(id, "needs_you");
  expect((await checks(id)).at(-1)?.state).toBe("needs_user");
  expect(JSON.stringify(await job(id))).toContain("Choose the destination account.");
  await h.script([
    { match: "Use the test account", role: "worker", steps: [{ say: "account selected" }] },
    { match: ".*", role: "main", repeat: true, steps: [{ say: "coordinated" }] },
  ]);
  const request = (await job(id)).requests[0]!;
  await h.ozi("answer", request.id, "Use the test account");
  await waitJob(id, "ready");
  expect((await job(id)).handledEventId).toBeNull();
});

it("m3.close-exact rejects stale reports and reopens on a newer result", async () => {
  const id = await start();
  await waitJob(id, "ready");
  const eventId = displayed(await job(id));
  await h.ozi("close", id, eventId);
  expect((await job(id)).column).toBe("done");
  await h.script([
    { match: "new outcome", role: "worker", steps: [{ say: "new result" }] },
    { match: ".*", role: "main", repeat: true, steps: [{ say: "coordinated" }] },
  ]);
  await h.ozi("thread", id, "--message", "new outcome");
  await waitJob(id, "ready");
  expect(await h.execOutput("close", id, eventId, "--json")).toEqual({
    code: 1,
    stdout: '{"error":{"code":"StaleEvent","message":"The job has a newer event."}}\n',
    stderr: "",
  });
  expect(await h.execOutput("close", id, eventId)).toEqual({
    code: 1,
    stdout: "",
    stderr: "The job has a newer event.\n",
  });
  expect((await job(id)).report?.text).toBe("new result");
  const card = await job(id);
  const checked = (await checks(id)).at(-1)!;
  await h.script([
    {
      match: "verified disposition",
      role: "main",
      steps: [
        { tool: { name: "job_cards" } },
        {
          tool: {
            name: "handle_job",
            arguments: {
              commandId: "verified-disposition",
              jobId: id,
              eventId: card.eventId,
              evidence: { type: "verified", checkEventId: checked.eventId },
            },
          },
        },
        { say: "verified disposition recorded" },
      ],
    },
  ]);
  await h.ozi("say", "verified disposition");
  await waitJob(id, "done");
  const handled = (await h.records()).findLast((record) => record.name === "handle_job");
  expect(handled?.result?.isError).not.toBe(true);
});

it("m3.accept-closes records exact user acceptance and keeps answers distinct", async () => {
  const id = await start({ steps: [{ ask: "Choose the destination." }, { say: "finished" }] });
  await waitJob(id, "needs_you");
  await h.ozi("answer", (await job(id)).requests[0]!.id, "approved");
  await waitJob(id, "ready");
  expect((await job(id)).handledEventId).toBeNull();
  await h.script([
    { match: "I accept this result", role: "worker", steps: [{ wait: true }] },
    { match: ".*", role: "main", repeat: true, steps: [{ say: "coordinated" }] },
  ]);
  await h.ozi("thread", id, "--message", "I accept this result.");
  await waitJob(id, "done");
  expect((await job(id)).handledEventId).not.toBeNull();
});

it("m3.close-vs-stop closes without interrupting and stops without accepting", async () => {
  const id = await start({ steps: [{ say: "working" }, { wait: true }] });
  await h.wait(id, "text:working");
  await h.ozi("close", id, displayed(await job(id)));
  expect((await h.thread(id)).runs.at(-1)?.status).toBe("running");
  expect((await job(id)).column).toBe("done");
  const other = await start({ steps: [{ say: "working too" }, { wait: true }] });
  await h.wait(other, "text:working too");
  await h.ozi("stop", "--thread", other);
  await h.wait(other, "interrupted");
  expect((await job(other)).column).not.toBe("done");
  expect(await job(other)).toMatchObject({
    column: "needs_you",
    status: "Stopped",
    checking: false,
  });
  expect(await checks(other)).toEqual([]);
  await h.ozi("close", other, displayed(await job(other)));
  expect((await job(other)).column).toBe("done");
  await h.script([
    { match: "^resume-stopped$", role: "worker", steps: [{ say: "resumed" }, { wait: true }] },
  ]);
  await h.ozi("thread", other, "--message", "resume-stopped");
  await h.wait(other, "text:resumed");
  expect(await job(other)).toMatchObject({ column: "running", status: "Working", checking: false });
});

it("m3.recovery recovers a durable claim before fork and deduplicates delivery after crashes", async () => {
  const id = await start({ forkWait: true });
  const row = await claim(id);
  await h.wait(row.rounds.at(-1)?.checkerThreadId ?? `${row.id}:round:1`, "starting");
  expect((await checks(id))[0]?.sourceCaptured).toBe(false);
  await h.crash();
  await h.script([
    { match: ".*", role: "main", repeat: true, steps: [{ say: "recovered report" }] },
  ]);
  await waitJob(id, "ready");
  await h.wait("ozi-main", "text:recovered report");
  const before = await h.thread("ozi-main");
  const deliveries = before.runs.filter((run) => run.ordinal > 1).map((run) => run.userMessageId);
  expect(deliveries).toHaveLength(1);
  const prompts = (await h.records()).filter(
    (record) => record.event === "prompt" && record.role === "main",
  );
  expect(prompts).toHaveLength(2);
  expect(prompts[1]?.prompt).toContain("finished");
  await h.crash();
  expect((await job(id)).report?.text).toBe("finished");
  expect(
    (await h.thread("ozi-main")).runs
      .filter((run) => run.ordinal > 1)
      .map((run) => run.userMessageId),
  ).toEqual(deliveries);
  expect((await checks(id)).at(-1)?.state).toBe("checked");
  expect(
    (await h.records()).filter((record) => record.event === "prompt" && record.role === "main"),
  ).toHaveLength(2);
});
