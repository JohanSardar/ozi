import { describe, expect, it } from "@effect/vitest";
import type {
  ApplicationStoredEvent,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  activeShellRowsForSubscriber,
  omitIdleSubagentShells,
  omitOlderSettledShells,
  shouldPublishShellApplicationEvent,
  skipUnchangedThreadShells,
} from "./ShellStream.ts";

describe("subagent shell events", () => {
  const stored = (threadId: string, type: string) =>
    ({ event: { threadId, type } }) as ApplicationStoredEvent;

  it("keeps regular threads and subagent state changes while omitting subagent transcript updates", () => {
    const subagents = new Set(["child"]);
    expect(
      shouldPublishShellApplicationEvent(stored("parent", "turn-item.updated"), subagents),
    ).toBe(true);
    expect(
      shouldPublishShellApplicationEvent(stored("child", "turn-item.updated"), subagents),
    ).toBe(false);
    expect(shouldPublishShellApplicationEvent(stored("child", "node.updated"), subagents)).toBe(
      false,
    );
    expect(
      shouldPublishShellApplicationEvent(stored("child", "runtime-request.updated"), subagents),
    ).toBe(true);
    expect(shouldPublishShellApplicationEvent(stored("child", "run.updated"), subagents)).toBe(
      true,
    );
  });

  it("tracks subagents created after the subscription starts", () => {
    const subagents = new Set<string>();
    const created = {
      event: {
        threadId: "new-child",
        type: "thread.created",
        payload: { lineage: { relationshipToParent: "subagent" } },
      },
    } as ApplicationStoredEvent;
    expect(shouldPublishShellApplicationEvent(created, subagents)).toBe(true);
    expect(
      shouldPublishShellApplicationEvent(stored("new-child", "message.updated"), subagents),
    ).toBe(false);
    expect(
      shouldPublishShellApplicationEvent(stored("new-child", "thread.deleted"), subagents),
    ).toBe(true);
    expect(subagents.has("new-child")).toBe(true);
  });
});

function shellFixture(overrides: Partial<OrchestrationV2ThreadShell>): OrchestrationV2ThreadShell {
  return { id: "thread-a", archivedAt: null, ...overrides } as OrchestrationV2ThreadShell;
}

describe("omitIdleSubagentShells", () => {
  const row = (
    id: string,
    parent: string | null,
    overrides: Partial<OrchestrationV2ThreadShell> = {},
  ) =>
    shellFixture({
      id: ThreadId.make(id),
      lineage: {
        parentThreadId: parent === null ? null : ThreadId.make(parent),
        relationshipToParent: parent === null ? null : "subagent",
        rootThreadId: ThreadId.make("root"),
      },
      status: "completed",
      activityRunStatus: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      ...overrides,
    });

  it("drops idle leaf children but keeps live ones and the middle of nested chains", () => {
    const threads = [
      row("root", null),
      row("idle", "root"),
      row("running", "root", { activityRunStatus: "running" }),
      row("queued", "root", { status: "queued" }),
      row("asking", "root", {
        pendingRuntimeRequest: {
          id: "request" as never,
          kind: "user_input",
          createdAt: DateTime.makeUnsafe(0),
        },
      }),
      row("background", "root", {
        pendingBackgroundTasks: [{ kind: "subagent" } as never],
      }),
      // Idle, but a woken grandchild walks through it to reach the root's badge.
      row("middle", "root"),
      row("grandchild", "middle"),
    ];
    expect(omitIdleSubagentShells(threads).map((thread) => thread.id)).toEqual([
      "root",
      "running",
      "queued",
      "asking",
      "background",
      "middle",
    ]);
  });

  it("still filters the transcript events of omitted children for a subscriber that opts in", () => {
    const threads = [row("root", null), row("idle", "root")];
    const omitted = activeShellRowsForSubscriber(threads, true);
    expect(omitted.threads.map((thread) => thread.id)).toEqual(["root"]);
    expect(
      shouldPublishShellApplicationEvent(
        { event: { threadId: "idle", type: "turn-item.updated" } } as ApplicationStoredEvent,
        omitted.subagentThreadIds,
      ),
    ).toBe(false);
  });
});

describe("omitOlderSettledShells", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = DateTime.makeUnsafe(100 * DAY);
  const row = (
    id: string,
    settledDaysAgo: number | null,
    overrides: Partial<OrchestrationV2ThreadShell> = {},
  ) =>
    shellFixture({
      id: ThreadId.make(id),
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: ThreadId.make(id),
      },
      status: "completed",
      activityRunStatus: null,
      pendingRuntimeRequest: null,
      pendingBackgroundTasks: [],
      settledOverride: settledDaysAgo === null ? null : "settled",
      settledAt:
        settledDaysAgo === null ? null : DateTime.makeUnsafe(100 * DAY - settledDaysAgo * DAY),
      ...overrides,
    });
  const newest = Array.from({ length: 25 }, (_, index) => row(`new-${index}`, index / 10));
  const omit = (threads: ReadonlyArray<OrchestrationV2ThreadShell>) =>
    omitOlderSettledShells({ threads, snapshotSequence: 7, now });

  it("keeps the 25 newest settled threads and counts the rest per project", () => {
    const result = omit([...newest, row("old", 30), row("b-old", 40), row("unsettled", null)]);
    expect(result.threads.map((thread) => thread.id)).toEqual([
      ...newest.map((thread) => thread.id),
      "unsettled",
    ]);
    expect(result.olderSettled).toEqual({
      before: DateTime.formatIso(DateTime.makeUnsafe(100 * DAY - 2.4 * DAY)),
      asOfSequence: 7,
      counts: [{ count: 1 }, { count: 1 }],
    });
  });

  it("keeps threads tied with the 25th newest", () => {
    const result = omit([...newest, row("tie", 2.4), row("older", 2.5)]);
    expect(result.threads.map((thread) => thread.id).slice(25)).toEqual(["tie"]);
  });

  it("omits nothing with fewer than 25 settled threads, however old", () => {
    const old = Array.from({ length: 5 }, (_, index) => row(`old-${index}`, 300 + index));
    const result = omit(old);
    expect(result.threads).toEqual(old);
    expect(result.olderSettled.count).toEqual(0);
  });

  it("keeps older rows that are snoozed, live, or above a kept subagent, and still counts them", () => {
    const threads = [
      ...newest,
      row("snoozed", 30, { snoozedUntil: DateTime.makeUnsafe(101 * DAY) }),
      row("woke", 30, { snoozedUntil: DateTime.makeUnsafe(99 * DAY) }),
      row("running", 30, { activityRunStatus: "running" }),
      row("parent", 30),
      shellFixture({
        id: ThreadId.make("child"),
        lineage: {
          parentThreadId: ThreadId.make("parent"),
          relationshipToParent: "subagent",
          rootThreadId: ThreadId.make("parent"),
        },
        settledOverride: null,
        settledAt: null,
      }),
    ];
    const result = omit(threads);
    expect(result.threads.map((thread) => thread.id).slice(25)).toEqual([
      "snoozed",
      "running",
      "parent",
      "child",
    ]);
    expect(result.olderSettled.count).toEqual(4);
  });
});

describe("shellStreamItemsFromInitialSnapshot", () => {});

describe("skipUnchangedThreadShells", () => {
  const at = (ms: number) => DateTime.makeUnsafe(Date.parse("2026-10-01T00:00:00.000Z") + ms);
  const shell = (
    id: string,
    overrides: Partial<OrchestrationV2ThreadShell> = {},
  ): OrchestrationV2ThreadShell => ({
    id: ThreadId.make(id),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    workingDirectory: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: ThreadId.make(id), parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 1,
    visibleItemCount: 1,
    status: "running",
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestUserMessageAt: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    ...overrides,
  });
  type Step =
    | { readonly advanceMs: number }
    | Exclude<OrchestrationV2ShellStreamItem, { readonly kind: "snapshot" | "synchronized" }>;
  const updated = (sequence: number, thread: OrchestrationV2ThreadShell): Step => ({
    kind: "thread.updated",
    sequence,
    location: "active",
    thread,
  });
  const run = (steps: ReadonlyArray<Step>) =>
    Stream.fromIterable(steps).pipe(
      Stream.mapEffect((step) =>
        "advanceMs" in step
          ? TestClock.adjust(Duration.millis(step.advanceMs)).pipe(Effect.as(null))
          : Effect.succeed(step),
      ),
      Stream.filter((item) => item !== null),
      skipUnchangedThreadShells,
      Stream.runCollect,
      Effect.map((items) => Array.from(items, (item) => ("sequence" in item ? item.sequence : -1))),
    );

  it.effect("sends the next update after a removal", () =>
    Effect.gen(function* () {
      const sent = yield* run([
        updated(1, shell("a")),
        { kind: "thread.removed", sequence: 2, location: "active", threadId: ThreadId.make("a") },
        updated(3, shell("a")),
      ]);
      expect(sent).toEqual([1, 2, 3]);
    }),
  );
});
