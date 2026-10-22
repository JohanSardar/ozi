import { describe, expect, it } from "@effect/vitest";
import type {
  ApplicationStoredEvent,
  OrchestrationV2ShellStreamItem,
  OrchestrationV2StoredEvent,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import type * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  archivedShellStreamItemFromThreadShell,
  buildActiveShellSnapshot,
  bufferShellLiveStream,
  coalesceShellApplicationEvents,
  coalesceStoredThreadEvents,
  loadShellSnapshotParts,
  shellStreamItemFromThreadShell,
  skipUnchangedThreadShells,
} from "./ShellStream.ts";

function project(sequence: number, id: string): ApplicationStoredEvent {
  return {
    sequence,
    aggregateKind: "project",
    aggregateId: id,
  } as ApplicationStoredEvent;
}

function thread(sequence: number, id: string): ApplicationStoredEvent {
  return {
    sequence,
    event: { threadId: id },
  } as ApplicationStoredEvent;
}

it.effect("coalesces a slow shell subscriber by identity and location in sequence order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<
        Extract<OrchestrationV2ShellStreamItem, { readonly sequence: number }>,
        Cause.Done
      >();
      const drained = yield* Deferred.make<void>();
      const shell = shellFixture({ id: ThreadId.make("same"), title: "Before" });
      const project = {
        id: ProjectId.make("same"),
        title: "Before",
        workspaceRoot: "/workspace/same",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      };
      const initial = {
        kind: "thread.updated" as const,
        sequence: 1,
        location: "active" as const,
        thread: shell,
      };
      const updates = [
        { kind: "project.updated", sequence: 2, project },
        { ...initial, sequence: 3 },
        { ...initial, sequence: 4, location: "archive" },
        { ...initial, sequence: 5, thread: { ...shell, id: ThreadId.make("other") } },
        {
          kind: "project.updated",
          sequence: 6,
          project: { ...project, id: ProjectId.make("other") },
        },
        { kind: "project.removed", sequence: 7, projectId: project.id },
        { kind: "thread.removed", sequence: 8, location: "active", threadId: shell.id },
        { kind: "project.updated", sequence: 9, project: { ...project, title: "Recreated" } },
        { ...initial, sequence: 10, thread: { ...shell, title: "Recreated" } },
        { kind: "thread.removed", sequence: 11, location: "archive", threadId: shell.id },
      ] satisfies Array<Extract<OrchestrationV2ShellStreamItem, { readonly sequence: number }>>;
      const pull = yield* Stream.toPull(
        bufferShellLiveStream(
          Stream.fromQueue(input).pipe(Stream.ensuring(Deferred.succeed(drained, undefined))),
          { maxItems: 6, maxSerializedBytes: 1_500 },
        ),
      );
      yield* Queue.offer(input, initial);
      expect(yield* pull).toEqual([initial]);
      yield* Queue.offerAll(input, updates);
      yield* Queue.end(input);
      // Finish producing the burst while the first batch is still awaiting its ACK.
      yield* Deferred.await(drained);
      expect(yield* pull).toEqual([updates[3], updates[4], updates[7], updates[8], updates[9]]);
    }),
  ),
);

describe("buildActiveShellSnapshot", () => {
  it("never duplicates archived rows into the regular shell", () => {
    const active = shellFixture({ archivedAt: null });
    const archived = shellFixture({
      id: ThreadId.make("thread-archived"),
      archivedAt: "2026-07-30T00:00:00.000Z" as never,
    });

    expect(
      buildActiveShellSnapshot({
        projects: [],
        threads: {
          schemaVersion: 1,
          snapshotSequence: 4,
          threads: [active],
          archivedThreads: [archived],
        },
        snapshotSequence: 7,
      }),
    ).toEqual({
      schemaVersion: 1,
      snapshotSequence: 7,
      projects: [],
      threads: [active],
      archivedThreads: [],
    });
  });
});

describe("coalesceShellApplicationEvents", () => {
  it("keeps the newest event per aggregate and preserves sequence order", () => {
    expect(
      coalesceShellApplicationEvents([
        thread(2, "thread-a"),
        project(3, "project-a"),
        thread(4, "thread-b"),
        thread(5, "thread-a"),
        project(6, "project-a"),
      ]).map((event) => event.sequence),
    ).toEqual([4, 5, 6]);
  });
});

function storedThreadEvent(
  sequence: number,
  threadId: string,
  event: Record<string, unknown> = {},
): OrchestrationV2StoredEvent {
  return { sequence, event: { threadId, ...event } } as OrchestrationV2StoredEvent;
}

describe("loadShellSnapshotParts", () => {
  it.effect("decodes the threads after the read transaction releases the connection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const steps: Array<string> = [];
      const step = <A>(name: string, value: A) =>
        Effect.serviceOption(sql.transactionService).pipe(
          Effect.map((transaction) => {
            steps.push(`${name}:${Option.isSome(transaction) ? "in" : "out of"} transaction`);
            return value;
          }),
        );
      const thread = shellFixture({});

      const snapshot = yield* loadShellSnapshotParts({
        sql,
        readThreads: step(
          "read threads",
          step("decode threads", {
            schemaVersion: 1,
            snapshotSequence: 3,
            threads: [thread],
            archivedThreads: [],
          }),
        ),
        listProjects: step("list projects", []),
        latestSequence: step("latest sequence", 7),
      });

      expect(steps).toEqual([
        "read threads:in transaction",
        "list projects:in transaction",
        "latest sequence:in transaction",
        "decode threads:out of transaction",
      ]);
      expect(snapshot.snapshotSequence).toBe(7);
      expect(snapshot.threads.threads).toEqual([thread]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

function shellFixture(overrides: Partial<OrchestrationV2ThreadShell>): OrchestrationV2ThreadShell {
  return { id: "thread-a", archivedAt: null, ...overrides } as OrchestrationV2ThreadShell;
}

describe("coalesceStoredThreadEvents", () => {
  it("keeps the newest stored event per thread and preserves sequence order", () => {
    expect(
      coalesceStoredThreadEvents([
        storedThreadEvent(2, "thread-a"),
        storedThreadEvent(3, "thread-b"),
        storedThreadEvent(5, "thread-a"),
      ]).map((stored) => stored.sequence),
    ).toEqual([3, 5]);
  });
});

describe("shellStreamItemFromThreadShell", () => {
  it("emits an active thread update when the shell is not archived", () => {
    const shell = shellFixture({ archivedAt: null });
    expect(
      shellStreamItemFromThreadShell({ stored: storedThreadEvent(4, "thread-a"), shell }),
    ).toEqual({
      kind: "thread.updated",
      sequence: 4,
      location: "active",
      thread: shell,
    });
  });

  it("removes archived threads from the active-only shell", () => {
    const shell = shellFixture({ archivedAt: "2026-07-30T00:00:00.000Z" as never });
    expect(
      shellStreamItemFromThreadShell({ stored: storedThreadEvent(4, "thread-a"), shell }),
    ).toEqual({
      kind: "thread.removed",
      sequence: 4,
      location: "active",
      threadId: "thread-a",
    });
  });

  it("emits an active-shell removal when an archived thread is deleted", () => {
    expect(
      shellStreamItemFromThreadShell({
        stored: storedThreadEvent(6, "thread-a", {
          type: "thread.deleted",
          payload: { archivedAt: "2026-07-30T00:00:00.000Z" },
        }),
        shell: null,
      }),
    ).toEqual({
      kind: "thread.removed",
      sequence: 6,
      location: "active",
      threadId: "thread-a",
    });
  });

  it("emits a removal from the active list for other missing shells", () => {
    expect(
      shellStreamItemFromThreadShell({
        stored: storedThreadEvent(6, "thread-a", {
          type: "thread.deleted",
          payload: { archivedAt: null },
        }),
        shell: null,
      }),
    ).toEqual({
      kind: "thread.removed",
      sequence: 6,
      location: "active",
      threadId: "thread-a",
    });
  });
});

describe("archivedShellStreamItemFromThreadShell", () => {
  it("emits an update for an archived shell", () => {
    const shell = shellFixture({ archivedAt: "2026-07-30T00:00:00.000Z" as never });
    expect(
      archivedShellStreamItemFromThreadShell({ stored: storedThreadEvent(4, "thread-a"), shell }),
    ).toEqual({ kind: "thread.updated", sequence: 4, thread: shell });
  });

  it("ignores active threads that never touched the archive", () => {
    expect(
      archivedShellStreamItemFromThreadShell({
        stored: storedThreadEvent(4, "thread-a", { type: "thread.settled" }),
        shell: shellFixture({ archivedAt: null }),
      }),
    ).toBeNull();
  });

  it("emits a removal when a thread leaves the archive", () => {
    expect(
      archivedShellStreamItemFromThreadShell({
        stored: storedThreadEvent(4, "thread-a", { type: "thread.unarchived" }),
        shell: shellFixture({ archivedAt: null }),
      }),
    ).toEqual({ kind: "thread.removed", sequence: 4, threadId: "thread-a" });
  });

  it("emits a removal when an archived thread is deleted", () => {
    expect(
      archivedShellStreamItemFromThreadShell({
        stored: storedThreadEvent(4, "thread-a", {
          type: "thread.deleted",
          payload: { archivedAt: "2026-07-30T00:00:00.000Z" },
        }),
        shell: null,
      }),
    ).toEqual({ kind: "thread.removed", sequence: 4, threadId: "thread-a" });
  });
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
    worktreePath: null,
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
    branch: null,
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

  it.effect("drops shells that only moved updatedAt, and resends them after a while", () =>
    Effect.gen(function* () {
      const sent = yield* run([
        updated(1, shell("a")),
        updated(2, shell("a", { updatedAt: at(100) })),
        updated(3, shell("a", { updatedAt: at(200), itemCount: 2, visibleItemCount: 2 })),
        updated(4, shell("a", { updatedAt: at(300), itemCount: 2, visibleItemCount: 2 })),
        updated(5, shell("b")),
        { advanceMs: 5_000 },
        updated(6, shell("a", { updatedAt: at(5_300), itemCount: 2, visibleItemCount: 2 })),
      ]);
      expect(sent).toEqual([1, 3, 5, 6]);
    }),
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
