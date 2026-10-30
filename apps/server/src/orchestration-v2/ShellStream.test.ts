import { describe, expect, it } from "@effect/vitest";
import type {
  ApplicationStoredEvent,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  activeShellRowsForSubscriber,
  bufferShellLiveStream,
  composeShellStreamWithEnrichment,
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
      projectId: ProjectId.make(id.startsWith("b-") ? "project-b" : "project-a"),
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
      counts: [
        { projectId: "project-a", count: 1 },
        { projectId: "project-b", count: 1 },
      ],
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
    expect(result.olderSettled.counts).toEqual([]);
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
        projectId: ProjectId.make("project-a"),
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
    expect(result.olderSettled.counts).toEqual([{ projectId: "project-a", count: 4 }]);
  });
});

describe("shellStreamItemsFromInitialSnapshot", () => {});

describe("composeShellStreamWithEnrichment", () => {
  it.effect("keeps a merged shell batch charged while the client withholds its ACK", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const update = yield* Deferred.make<void>();
        const closed = yield* Deferred.make<void>();
        const initial = {
          kind: "thread.removed" as const,
          sequence: 1,
          location: "active" as const,
          threadId: ThreadId.make("thread-a"),
        };
        const pull = yield* Stream.toPull(
          composeShellStreamWithEnrichment({
            initial: Stream.empty,
            tail: bufferShellLiveStream(
              Stream.concat(
                Stream.succeed(initial),
                Stream.fromEffect(Deferred.await(update)).pipe(
                  Stream.map(() => ({ ...initial, sequence: 2 })),
                ),
              ).pipe(Stream.ensuring(Deferred.succeed(closed, undefined))),
              { maxItems: 1 },
            ),
            enrichment: Stream.empty,
          }),
        );
        expect(yield* pull).toEqual([initial]);
        // Let the merge producer run while the client still withholds its ACK.
        yield* Effect.yieldNow;
        yield* Deferred.succeed(update, undefined);
        yield* Deferred.await(closed);
        const result = yield* Stream.fromPull(Effect.succeed(pull)).pipe(
          Stream.runDrain,
          Effect.result,
        );
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") expect(result.failure._tag).toBe("LiveStreamBufferError");
      }),
    ),
  );
});

describe("skipUnchangedThreadShells", () => {
  const at = (ms: number) => DateTime.makeUnsafe(Date.parse("2026-10-01T00:00:00.000Z") + ms);
  const shell = (
    id: string,
    overrides: Partial<OrchestrationV2ThreadShell> = {},
  ): OrchestrationV2ThreadShell => ({
    id: ThreadId.make(id),
    projectId: ProjectId.make("project-a"),
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
