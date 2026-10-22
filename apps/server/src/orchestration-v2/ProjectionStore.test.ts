import { assert, it, vi } from "@effect/vitest";
import {
  EventId,
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ThreadShellSnapshot,
  NodeId,
  PlanId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RuntimeRequestId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  buildBoundedThreadProjection,
  decodeThreadHistoryCursor,
  selectHistoryPageFromCursor,
} from "./threadHistoryPaging.ts";

const layerTest = Layer.mergeAll(
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  SqlitePersistence.layerMemory,
);
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;
const driver = ProviderDriverKind.make("codex");
const providerInstanceId = modelSelection.instanceId;
const encodeUnknownJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const traceSqlStatements = () => {
  const statements: Array<string> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        const query = span.attributes.get("db.query.text");
        if (typeof query === "string") statements.push(query);
      };
      return span;
    },
  });
  return { statements, tracer };
};

const addRolledBackRecoveryCandidate = Effect.fn("addRolledBackRecoveryCandidate")(function* (
  suffix: string,
) {
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const threadId = ThreadId.make(`thread:${suffix}:rolled-back`);
  const runId = RunId.make(`run:${suffix}:rolled-back`);
  const rootNodeId = NodeId.make(`node:${suffix}:rolled-back`);
  const run = {
    id: runId,
    threadId,
    ordinal: 1,
    providerInstanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message:${suffix}:rolled-back`),
    rootNodeId,
    activeAttemptId: null,
    status: "running" as const,
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    contextHandoffId: null,
  };

  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:thread-created`),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make(`project:${suffix}`),
      title: "Rolled-back recovery candidate",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:run-created`),
    type: "run.created",
    threadId,
    runId,
    nodeId: rootNodeId,
    driver,
    providerInstanceId,
    occurredAt: now,
    payload: run,
  });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:item-running`),
    type: "turn-item.updated",
    threadId,
    runId,
    nodeId: rootNodeId,
    driver,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`item:${suffix}:rolled-back`),
      threadId,
      runId,
      nodeId: rootNodeId,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "running",
      title: "abandoned command",
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      type: "command_execution",
      input: "sleep 60",
    },
  });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:run-rolled-back`),
    type: "run.updated",
    threadId,
    runId,
    nodeId: rootNodeId,
    driver,
    occurredAt: now,
    payload: { ...run, status: "rolled_back", completedAt: now },
  });

  return threadId;
});

it.effect.each([
  ["memory", ProjectionStore.layerMemory],
  ["SQL", layerTest],
] as const)("%s shells flag only an active turn blocked solely on T3 thread waits", ([, layer]) =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* addRolledBackRecoveryCandidate("thread-wait");
    const initial = yield* store.getThreadProjection(threadId);
    const at = initial.updatedAt;
    const previousCommand = initial.turnItems.find((item) => item.type === "command_execution")!;
    const itemBase = {
      ...previousCommand,
      providerThreadId: previousCommand.providerThreadId ?? null,
      providerTurnId: previousCommand.providerTurnId ?? null,
      nativeItemRef: previousCommand.nativeItemRef ?? null,
      parentItemId: previousCommand.parentItemId ?? null,
    };
    yield* store.apply({
      id: EventId.make("event:thread-wait:previous-completed"),
      type: "run.updated",
      threadId,
      occurredAt: at,
      payload: { ...initial.runs[0]!, status: "completed", completedAt: at },
    });
    const run = {
      ...initial.runs[0]!,
      id: RunId.make("run:thread-wait:active"),
      ordinal: 2,
      status: "running" as const,
      completedAt: null,
    };
    yield* store.apply({
      id: EventId.make("event:thread-wait:active"),
      type: "run.created",
      threadId,
      occurredAt: at,
      payload: run,
    });
    let sequence = 0;
    const updateItem = (payload: OrchestrationV2TurnItem) =>
      store.apply({
        id: EventId.make(`event:thread-wait:item:${sequence++}`),
        type: "turn-item.updated",
        threadId,
        runId: payload.runId ?? undefined,
        driver,
        occurredAt: at,
        payload,
      });
    const assertBlocked = Effect.fnUntraced(function* (expected: boolean) {
      const listed = (yield* store.getShellSnapshot()).threads.find((row) => row.id === threadId);
      for (const shell of [yield* store.getThreadShell(threadId), listed]) {
        assert.equal(shell?.activeRunId, run.id);
        assert.equal(shell?.status, "running");
        assert.equal(shell?.blockedOnThreadWait ?? false, expected);
      }
    });
    const wait = {
      ...itemBase,
      id: TurnItemId.make("item:thread-wait:active"),
      runId: run.id,
      type: "dynamic_tool" as const,
      toolName: "mcp__t3_code__t3_thread_wait",
      input: { threadId: "child-thread" },
      status: "running" as const,
    };

    yield* updateItem({
      ...wait,
      id: TurnItemId.make("item:thread-wait:stale"),
      runId: initial.runs[0]!.id,
    });
    yield* assertBlocked(false);
    const foreign = {
      ...wait,
      id: TurnItemId.make("item:thread-wait:foreign"),
      toolName: "weather.t3_thread_wait",
    };
    yield* updateItem(foreign);
    yield* assertBlocked(false);
    yield* updateItem({ ...foreign, status: "completed", completedAt: at });
    yield* updateItem({ ...wait, status: "pending", startedAt: null });
    yield* assertBlocked(false);
    yield* updateItem(wait);
    yield* assertBlocked(true);

    yield* updateItem({
      ...wait,
      id: TurnItemId.make("item:thread-wait:plan"),
      type: "todo_list",
      planId: PlanId.make("plan:thread-wait"),
      steps: [{ id: "review", text: "Review the child result", status: "running" }],
    });
    yield* assertBlocked(true);
    yield* updateItem({
      ...wait,
      id: TurnItemId.make("item:thread-wait:proposed-plan"),
      type: "proposed_plan",
      planId: PlanId.make("plan:thread-wait:proposed"),
      markdown: "Review the child result",
      streaming: true,
    });
    yield* updateItem({
      ...wait,
      id: TurnItemId.make("item:thread-wait:named-message"),
      nativeItemRef: { driver, nativeId: "named-message", strength: "weak" },
      type: "assistant_message",
      messageId: MessageId.make("message:thread-wait:named"),
      text: "Waiting for the child result",
      streaming: true,
    });
    yield* updateItem({
      ...wait,
      id: TurnItemId.make("item:thread-wait:named-thought"),
      nativeItemRef: { driver, nativeId: "named-thought", strength: "weak" },
      type: "reasoning",
      text: "I need the child result",
      streaming: true,
    });
    yield* assertBlocked(true);

    const command = {
      ...itemBase,
      id: TurnItemId.make("item:thread-wait:concurrent"),
      runId: run.id,
    };
    yield* updateItem(command);
    yield* assertBlocked(false);
    yield* updateItem({ ...wait, status: "waiting" });
    yield* assertBlocked(false);
    yield* updateItem({ ...command, status: "completed", completedAt: at });
    yield* assertBlocked(true);
    const fileChange = {
      ...command,
      id: TurnItemId.make("item:thread-wait:concurrent-edit"),
      type: "file_change" as const,
      fileName: "example.ts",
    };
    yield* updateItem(fileChange);
    yield* assertBlocked(false);
    yield* updateItem({ ...fileChange, status: "completed", completedAt: at });
    yield* assertBlocked(true);
    const compaction = {
      ...command,
      id: TurnItemId.make("item:thread-wait:compaction"),
      type: "compaction" as const,
      driver,
    };
    yield* updateItem(compaction);
    yield* assertBlocked(false);
    yield* updateItem({ ...compaction, status: "completed", completedAt: at });
    yield* assertBlocked(true);
    yield* updateItem({ ...wait, status: "completed", completedAt: at });
    yield* assertBlocked(false);

    const delegation = {
      ...wait,
      id: TurnItemId.make("item:thread-wait:delegation"),
      toolName: "t3-code-thread_codex-adapter_delegate_task",
      input: { task: "Review", mode: "async" },
    };
    yield* updateItem(delegation);
    yield* assertBlocked(false);
    yield* updateItem({ ...delegation, status: "completed", completedAt: at });
    const blockingDelegation = {
      ...delegation,
      id: TurnItemId.make("item:thread-wait:blocking-delegation"),
      input: { task: "Review", mode: "wait" },
    };
    yield* updateItem({
      ...command,
      id: TurnItemId.make("item:thread-wait:child"),
      type: "subagent",
      subagentId: NodeId.make("node:thread-wait:child"),
      origin: "app_owned",
      driver,
      providerInstanceId,
      childThreadId: ThreadId.make("child-thread"),
      prompt: "Review",
      result: null,
    });
    yield* updateItem(blockingDelegation);
    yield* assertBlocked(true);
    yield* updateItem({ ...blockingDelegation, status: "completed", completedAt: at });
    yield* assertBlocked(false);
  }).pipe(Effect.provide(layer)),
);

it.effect.each([
  ["memory", ProjectionStore.layerMemory],
  ["SQL", layerTest],
] as const)(
  "%s shells use the latest subagent owner for duplicate provider-thread ids",
  ([, layer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = yield* addRolledBackRecoveryCandidate("duplicate-provider-thread-owner");
      const initial = yield* store.getThreadProjection(threadId);
      const at = initial.updatedAt;
      const otherThreadId = yield* addRolledBackRecoveryCandidate(
        "duplicate-provider-thread-owner:other",
      );
      const other = yield* store.getThreadProjection(otherThreadId);
      const otherRun = other.runs[0]!;
      const otherInstanceId = ProviderInstanceId.make("codex-other");
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:other-completed"),
        type: "run.updated",
        threadId: otherThreadId,
        occurredAt: at,
        payload: { ...otherRun, status: "completed", completedAt: at },
      });
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:other-switched"),
        type: "thread.provider-switched",
        threadId: otherThreadId,
        occurredAt: at,
        payload: {
          ...other.thread,
          providerInstanceId: otherInstanceId,
          modelSelection: { ...modelSelection, instanceId: otherInstanceId },
        },
      });
      const providerThreadId = ProviderThreadId.make("provider-thread:duplicate-owner");
      const nativeTaskId = "native-task:duplicate-provider-thread-owner";
      // The latest upsert moves the row off the later-created thread.
      for (const [appThreadId, owner] of [
        [otherThreadId, otherInstanceId],
        [threadId, providerInstanceId],
      ] as const) {
        yield* store.apply({
          id: EventId.make(`event:duplicate-provider-thread-owner:${owner}`),
          type: "provider-thread.updated",
          threadId: appThreadId,
          occurredAt: at,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: owner,
            providerSessionId: null,
            appThreadId,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: at,
            updatedAt: at,
            pendingBackgroundTasks:
              owner === otherInstanceId
                ? [{ taskId: nativeTaskId, kind: "subagent", description: "Review" }]
                : [],
          },
        });
      }
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:completed"),
        type: "run.updated",
        threadId,
        occurredAt: at,
        payload: { ...initial.runs[0]!, status: "completed", completedAt: at },
      });
      const item = {
        ...initial.turnItems[0]!,
        id: TurnItemId.make("item:duplicate-provider-thread-owner"),
        providerThreadId,
        nativeItemRef: { driver, nativeId: nativeTaskId, strength: "strong" as const },
        type: "subagent" as const,
        status: "running" as const,
        subagentId: NodeId.make("node:duplicate-provider-thread-owner"),
        origin: "provider_native" as const,
        driver,
        providerInstanceId,
        childThreadId: null,
        title: "Review",
        prompt: "Review",
        result: null,
      };
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:item"),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload: item,
      });
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:other-item"),
        type: "turn-item.updated",
        threadId: otherThreadId,
        occurredAt: at,
        payload: {
          ...item,
          id: TurnItemId.make("item:duplicate-provider-thread-owner:other"),
          threadId: otherThreadId,
          runId: otherRun.id,
          nodeId: otherRun.rootNodeId,
          subagentId: NodeId.make("node:duplicate-provider-thread-owner:other"),
        },
      });
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:switched"),
        type: "thread.provider-switched",
        threadId,
        occurredAt: at,
        payload: {
          ...initial.thread,
          providerInstanceId: otherInstanceId,
          modelSelection: { ...modelSelection, instanceId: otherInstanceId },
        },
      });
      // The other thread's item reads its owner from a provider thread stored on another thread.
      assert.deepEqual((yield* store.getThreadProjection(otherThreadId)).providerThreads, []);
      const assertOwners = Effect.fnUntraced(function* (
        targetThreadId: ThreadId,
        expected: ReadonlyArray<unknown>,
      ) {
        const listed = (yield* store.getShellSnapshot()).threads.find(
          (thread) => thread.id === targetThreadId,
        );
        for (const shell of [yield* store.getThreadShell(targetThreadId), listed]) {
          assert.equal(shell?.providerInstanceId, otherInstanceId);
          assert.equal(shell?.activeRunId, null);
          assert.deepEqual(
            shell?.pendingBackgroundTasks?.filter((task) => task.kind === "subagent"),
            expected,
          );
        }
      });
      const owned = [
        { taskId: nativeTaskId, description: item.title, kind: "subagent", providerInstanceId },
      ];
      yield* assertOwners(threadId, owned);
      yield* assertOwners(otherThreadId, owned);
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:stopped"),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload: { ...item, status: "cancelled", completedAt: at },
      });
      yield* assertOwners(threadId, []);
      const ownerSnapshot = (yield* store.getThreadProjection(threadId)).providerThreads[0]!;
      // Rollback writes its provider snapshot before the rolled-back run events.
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:rollback-provider-thread"),
        type: "provider-thread.updated",
        threadId: otherThreadId,
        occurredAt: at,
        payload: ownerSnapshot,
      });
      yield* store.apply({
        id: EventId.make("event:duplicate-provider-thread-owner:other-rolled-back"),
        type: "run.updated",
        threadId: otherThreadId,
        occurredAt: at,
        payload: { ...otherRun, status: "rolled_back", completedAt: at },
      });
      const rolledBack = yield* store.getThreadProjection(otherThreadId);
      assert.deepEqual(rolledBack.providerThreads, []);
      assert.equal(
        (yield* store.getThreadProjection(threadId)).thread.activeProviderThreadId,
        providerThreadId,
      );
      assert.deepEqual(
        ProjectionStore.threadShellFromProjection(rolledBack).pendingBackgroundTasks,
        [],
      );
    }).pipe(Effect.provide(layer)),
);

const addOrphanedRecoveryCandidate = Effect.fn("addOrphanedRecoveryCandidate")(function* (
  suffix: string,
) {
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const threadId = ThreadId.make(`thread:${suffix}:orphaned`);
  const runId = RunId.make(`run:${suffix}:missing`);
  const rootNodeId = NodeId.make(`node:${suffix}:orphaned`);

  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:thread-created`),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make(`project:${suffix}`),
      title: "Orphaned recovery candidate",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:item-running`),
    type: "turn-item.updated",
    threadId,
    runId,
    nodeId: rootNodeId,
    driver,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`item:${suffix}:orphaned`),
      threadId,
      runId,
      nodeId: rootNodeId,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "running",
      title: "orphaned command",
      startedAt: now,
      completedAt: null,
      updatedAt: now,
      type: "command_execution",
      input: "sleep 60",
    },
  });

  return threadId;
});

it("includes imported runless history when selecting fork context through a run", () => {
  const firstRunId = RunId.make("run:projection-imported-fork:1");
  const secondRunId = RunId.make("run:projection-imported-fork:2");
  const runOrdinalById = new Map([
    [firstRunId, 1],
    [secondRunId, 2],
  ]);

  assert.isTrue(
    ProjectionStore.isTurnItemAtOrBeforeRun({
      historyOrigin: "v1_import",
      itemRunId: null,
      runOrdinalById,
      sourceRunOrdinal: 1,
    }),
  );
  assert.isFalse(
    ProjectionStore.isTurnItemAtOrBeforeRun({
      historyOrigin: undefined,
      itemRunId: null,
      runOrdinalById,
      sourceRunOrdinal: 1,
    }),
  );
  assert.isTrue(
    ProjectionStore.isTurnItemAtOrBeforeRun({
      historyOrigin: "v1_import",
      itemRunId: firstRunId,
      runOrdinalById,
      sourceRunOrdinal: 1,
    }),
  );
  assert.isFalse(
    ProjectionStore.isTurnItemAtOrBeforeRun({
      historyOrigin: "v1_import",
      itemRunId: secondRunId,
      runOrdinalById,
      sourceRunOrdinal: 1,
    }),
  );
});

const restartCancelledWorkSurvivesStaleRunUpdate = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = yield* addRolledBackRecoveryCandidate("restart-cancelled-work-stale-update");
  const run = (yield* store.getThreadProjection(threadId)).runs[0]!;
  const now = yield* DateTime.now;
  const work = [{ kind: "subagent" as const, label: "Background subagent test" }];
  yield* store.apply({
    id: EventId.make("event:restart-cancelled-work-stale-update:recorded"),
    type: "run.background-work-cancelled",
    threadId,
    runId: run.id,
    providerInstanceId,
    occurredAt: now,
    payload: { runId: run.id, restartCancelledBackgroundWork: work },
  });
  yield* store.apply({
    id: EventId.make("event:restart-cancelled-work-stale-update:completed"),
    type: "run.updated",
    threadId,
    runId: run.id,
    providerInstanceId,
    occurredAt: now,
    payload: { ...run, status: "completed", completedAt: now },
  });
  const updated = (yield* store.getThreadProjection(threadId)).runs[0];
  assert.equal(updated?.status, "completed");
  assert.deepEqual(updated?.restartCancelledBackgroundWork, work);
});

const threadWorktreePathsIncludeArchivedOnRequest = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const create = (id: string, input: { worktreePath: string | null; archived?: boolean }) => {
    const threadId = ThreadId.make(id);
    const thread = {
      createdBy: "user" as const,
      creationSource: "web" as const,
      id: threadId,
      projectId: ProjectId.make("project:worktree-paths"),
      title: id,
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      branch: input.worktreePath === null ? null : id,
      worktreePath: input.worktreePath,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: input.archived === true ? now : null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    };
    return store
      .apply({
        id: EventId.make(`event:${id}:created`),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: thread,
      })
      .pipe(Effect.as(thread));
  };
  yield* create("thread:active", { worktreePath: "/worktrees/active" });
  yield* create("thread:archived", { worktreePath: "/worktrees/archived", archived: true });
  yield* create("thread:local", { worktreePath: null });
  const deleted = yield* create("thread:deleted", { worktreePath: "/worktrees/deleted" });
  yield* store.apply({
    id: EventId.make("event:thread:deleted:deleted"),
    type: "thread.deleted",
    threadId: deleted.id,
    occurredAt: now,
    payload: { ...deleted, deletedAt: now },
  });

  assert.deepEqual(yield* store.getThreadWorktreePaths(), [
    { threadId: ThreadId.make("thread:active"), worktreePath: "/worktrees/active" },
  ]);
  assert.deepEqual(yield* store.getThreadWorktreePaths({ includeArchived: true }), [
    { threadId: ThreadId.make("thread:active"), worktreePath: "/worktrees/active" },
    { threadId: ThreadId.make("thread:archived"), worktreePath: "/worktrees/archived" },
  ]);
});

const commandReadsSkipSettledLeafNodes = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const threadId = yield* addRolledBackRecoveryCandidate("settled-leaf-nodes");
  const settledRun = (yield* store.getThreadProjection(threadId)).runs[0]!;
  const activeRun = {
    ...settledRun,
    id: RunId.make("run:settled-leaf-nodes:active"),
    ordinal: 2,
    userMessageId: MessageId.make("message:settled-leaf-nodes:active"),
    rootNodeId: NodeId.make("node:settled-leaf-nodes:active-root"),
    status: "running" as const,
    completedAt: null,
  };
  yield* store.apply({
    id: EventId.make("event:settled-leaf-nodes:active-run"),
    type: "run.created",
    threadId,
    runId: activeRun.id,
    nodeId: activeRun.rootNodeId,
    driver,
    providerInstanceId,
    occurredAt: now,
    payload: activeRun,
  });
  const nodes = [
    ["settled-root", settledRun, "root_turn", "completed"],
    ["settled-tool", settledRun, "tool_call", "completed"],
    ["settled-message", settledRun, "assistant_message", "failed"],
    ["settled-reasoning", settledRun, "reasoning", "cancelled"],
    ["settled-subagent", settledRun, "subagent", "completed"],
    ["settled-run-live-tool", settledRun, "tool_call", "running"],
    ["active-run-done-tool", activeRun, "tool_call", "completed"],
  ] as const;
  for (const [name, run, kind, status] of nodes) {
    const id = NodeId.make(`node:settled-leaf-nodes:${name}`);
    yield* store.apply({
      id: EventId.make(`event:settled-leaf-nodes:${name}`),
      type: "node.updated",
      threadId,
      runId: run.id,
      nodeId: id,
      driver,
      occurredAt: now,
      payload: {
        id,
        threadId,
        runId: run.id,
        rootNodeId: kind === "root_turn" ? id : run.rootNodeId!,
        parentNodeId: kind === "root_turn" ? null : run.rootNodeId,
        kind,
        status,
        countsForRun: kind === "root_turn",
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        startedAt: now,
        completedAt: status === "running" ? null : now,
      },
    });
  }
  const nodeNames = (records: { readonly nodes: ReadonlyArray<{ readonly id: string }> }) =>
    records.nodes
      .map((node) => node.id.replace("node:settled-leaf-nodes:", ""))
      .filter((name) => nodes.some(([candidate]) => candidate === name))
      .toSorted();

  assert.deepEqual(
    nodeNames(yield* store.getThreadRecords(threadId, ["nodes"], { omitSettledLeafNodes: true })),
    ["active-run-done-tool", "settled-root", "settled-run-live-tool", "settled-subagent"],
  );
  assert.deepEqual(
    nodeNames(yield* store.getThreadRecords(threadId, ["nodes"])),
    nodes.map(([name]) => name).toSorted(),
  );
});

it.effect("memory command reads skip finished leaf nodes of finished runs", () =>
  commandReadsSkipSettledLeafNodes.pipe(Effect.provide(ProjectionStore.layerMemory)),
);

it.effect(
  "memory worktree path lookup defaults to active threads and can include archived threads",
  () =>
    threadWorktreePathsIncludeArchivedOnRequest.pipe(Effect.provide(ProjectionStore.layerMemory)),
);

it.effect("memory projection keeps restart-cancelled work through a stale run.updated", () =>
  restartCancelledWorkSurvivesStaleRunUpdate.pipe(Effect.provide(ProjectionStore.layerMemory)),
);

const backgroundThreadUpdatesKeepTimestamp = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const createdAt = DateTime.makeUnsafe("2026-10-06T14:00:00.000Z");
  const threadId = ThreadId.make("thread:background-updates");
  const thread = {
    createdBy: "user" as const,
    creationSource: "web" as const,
    id: threadId,
    projectId: ProjectId.make("project:background-updates"),
    title: "Background updates",
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  yield* store.apply({
    id: EventId.make("event:background-updates:created"),
    type: "thread.created",
    threadId,
    occurredAt: createdAt,
    payload: thread,
  });
  const readActivity = Effect.gen(function* () {
    const projection = yield* store.getThreadProjection(threadId);
    const thread = yield* store.getThread(threadId);
    const shell = yield* store.getThreadShell(threadId);
    const listed = (yield* store.getShellSnapshot()).threads.find((entry) => entry.id === threadId);
    assert.deepEqual(projection.thread.updatedAt, createdAt);
    assert.deepEqual(thread.updatedAt, createdAt);
    assert.deepEqual(shell?.updatedAt, createdAt);
    assert.deepEqual(listed?.updatedAt, createdAt);
    return projection;
  });
  const link = {
    host: "github.com",
    repository: "owner/repository",
    number: 42,
    url: "https://github.com/owner/repository/pull/42",
    source: "manual" as const,
    linkedAt: DateTime.formatIso(createdAt),
    snapshot: null,
    stack: null,
  };
  yield* store.apply({
    id: EventId.make("event:background-updates:pull-request-synced"),
    type: "thread.pull-request-synced",
    threadId,
    occurredAt: DateTime.add(createdAt, { minutes: 45 }),
    payload: { ...thread, pullRequests: [link] },
  });
  const synced = yield* readActivity;
  assert.deepEqual(synced.updatedAt, createdAt);
  assert.equal(synced.thread.pullRequests?.[0]?.number, 42);

  const snapshot = {
    state: "open" as const,
    title: "Ship it",
    headBranch: "feature",
    baseBranch: "main",
    isDraft: false,
    updatedAt: DateTime.formatIso(DateTime.add(createdAt, { minutes: 46 })),
    syncedAt: DateTime.formatIso(DateTime.add(createdAt, { minutes: 47 })),
    closedAt: null,
    mergedAt: null,
  };
  yield* store.apply({
    id: EventId.make("event:background-updates:pull-request-link-updated"),
    type: "thread.pull-request-link-updated",
    threadId,
    occurredAt: DateTime.add(createdAt, { minutes: 48 }),
    payload: { ...link, snapshot },
  });
  const refreshed = yield* readActivity;
  assert.deepEqual(refreshed.updatedAt, createdAt);
  assert.deepEqual(refreshed.thread.pullRequests?.[0]?.snapshot, snapshot);

  yield* store.apply({
    id: EventId.make("event:background-updates:active-reordered"),
    type: "thread.active-reordered",
    threadId,
    occurredAt: DateTime.add(createdAt, { minutes: 50 }),
    payload: { ...refreshed.thread, activeOrderKey: "a" },
  });
  const reordered = yield* readActivity;
  assert.deepEqual(reordered.updatedAt, createdAt);
  assert.equal(reordered.thread.activeOrderKey, "a");

  // An already-unpinned thread keeps its activity time even when replay's envelope advances.
  yield* store.apply({
    id: EventId.make("event:background-updates:already-unpinned"),
    type: "thread.unpinned",
    threadId,
    occurredAt: DateTime.add(createdAt, { minutes: 55 }),
    payload: { ...reordered.thread, pinnedAt: null, pinOrderKey: null },
  });
  yield* readActivity;
});

it.effect("memory projection keeps background thread updates out of updatedAt", () =>
  backgroundThreadUpdatesKeepTimestamp.pipe(Effect.provide(ProjectionStore.layerMemory)),
);

it.effect("SQL projection keeps background thread updates out of updatedAt", () =>
  backgroundThreadUpdatesKeepTimestamp.pipe(Effect.provide(layerTest)),
);

it.effect("memory recovery selection ignores unfinished items from rolled-back runs", () =>
  Effect.gen(function* () {
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* addRolledBackRecoveryCandidate("memory-recovery-candidates");

    assert.notInclude(yield* projectionStore.getRecoveryThreadIds("runtime"), threadId);
  }).pipe(Effect.provide(ProjectionStore.layerMemory)),
);

it.effect("memory recovery selection includes unfinished items from missing runs", () =>
  Effect.gen(function* () {
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* addOrphanedRecoveryCandidate("memory-recovery-candidates");

    assert.include(yield* projectionStore.getRecoveryThreadIds("runtime"), threadId);
  }).pipe(Effect.provide(ProjectionStore.layerMemory)),
);

const runlessNativeSubagentNeedsRecovery = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = yield* addRolledBackRecoveryCandidate("runless-native-recovery");
  const now = yield* DateTime.now;
  const id = NodeId.make("node:runless-native-recovery");
  assert.notInclude(yield* store.getRecoveryThreadIds("runtime"), threadId);
  for (const status of ["pending", "running", "waiting", "completed"] as const) {
    yield* store.apply({
      id: EventId.make(`event:runless-native-recovery:${status}`),
      type: "subagent.updated",
      threadId,
      nodeId: id,
      driver,
      providerInstanceId,
      occurredAt: now,
      payload: {
        id,
        threadId,
        runId: null,
        parentNodeId: NodeId.make("node:runless-native-parent"),
        origin: "provider_native",
        createdBy: "agent",
        driver,
        providerInstanceId,
        providerThreadId: null,
        childThreadId: null,
        nativeTaskRef: { driver, nativeId: "runless-native", strength: "strong" },
        prompt: "Do the work",
        title: "Workflow member",
        model: null,
        status,
        result: null,
        startedAt: now,
        completedAt: status === "completed" ? now : null,
        updatedAt: now,
      },
    });
    assert.equal(
      (yield* store.getRecoveryThreadIds("runtime")).includes(threadId),
      status !== "completed",
    );
  }
});

it.effect("memory recovery selects unfinished runless native subagents", () =>
  runlessNativeSubagentNeedsRecovery.pipe(Effect.provide(ProjectionStore.layerMemory)),
);

const assertProjectScopedShells = Effect.fn("assertProjectScopedShells")(function* (
  suffix: string,
) {
  const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const projectId = ProjectId.make(`project:${suffix}:a`);
  const otherProjectId = ProjectId.make(`project:${suffix}:b`);
  const activeThreadId = ThreadId.make(`thread:${suffix}:a-active`);
  const archivedThreadId = ThreadId.make(`thread:${suffix}:a-archived`);
  const forkThreadId = ThreadId.make(`thread:${suffix}:a-fork`);
  const sourceThreadId = ThreadId.make(`thread:${suffix}:b-source`);
  const otherThreadId = ThreadId.make(`thread:${suffix}:b-other`);
  const sourceRunId = RunId.make(`run:${suffix}:b-source`);
  const sourceNodeId = NodeId.make(`node:${suffix}:b-source`);
  const createThread = (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly archived?: boolean;
    readonly forkedFromRunOf?: ThreadId;
  }) =>
    projectionStore.apply({
      id: EventId.make(`event:${input.threadId}:created`),
      type: "thread.created",
      threadId: input.threadId,
      occurredAt: now,
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: input.threadId,
        projectId: input.projectId,
        title: input.threadId,
        providerInstanceId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage:
          input.forkedFromRunOf === undefined
            ? { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId }
            : {
                parentThreadId: input.forkedFromRunOf,
                relationshipToParent: "fork",
                rootThreadId: input.forkedFromRunOf,
              },
        forkedFrom:
          input.forkedFromRunOf === undefined
            ? null
            : { type: "run", threadId: input.forkedFromRunOf, runId: sourceRunId },
        createdAt: now,
        updatedAt: now,
        archivedAt: input.archived === true ? now : null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    });

  yield* createThread({ threadId: sourceThreadId, projectId: otherProjectId, archived: true });
  yield* createThread({ threadId: otherThreadId, projectId: otherProjectId });
  yield* createThread({ threadId: activeThreadId, projectId });
  yield* createThread({ threadId: archivedThreadId, projectId, archived: true });
  yield* createThread({ threadId: forkThreadId, projectId, forkedFromRunOf: sourceThreadId });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:source-run`),
    type: "run.created",
    threadId: sourceThreadId,
    runId: sourceRunId,
    nodeId: sourceNodeId,
    driver,
    occurredAt: now,
    payload: {
      id: sourceRunId,
      threadId: sourceThreadId,
      ordinal: 1,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make(`message:${suffix}:source-user`),
      rootNodeId: sourceNodeId,
      activeAttemptId: null,
      status: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      contextHandoffId: null,
    },
  });
  yield* projectionStore.apply({
    id: EventId.make(`event:${suffix}:source-item`),
    type: "turn-item.updated",
    threadId: sourceThreadId,
    runId: sourceRunId,
    occurredAt: now,
    payload: {
      id: TurnItemId.make(`turn-item:${suffix}:source`),
      threadId: sourceThreadId,
      runId: sourceRunId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed",
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      type: "assistant_message",
      messageId: MessageId.make(`message:${suffix}:source-assistant`),
      text: "Source answer",
      streaming: false,
    },
  });

  const unscoped = yield* projectionStore.getShellSnapshot();
  const inProject = (thread: { readonly projectId: ProjectId }) => thread.projectId === projectId;
  const active = yield* projectionStore.getShellSnapshot({ projectId, location: "active" });
  assert.deepEqual(active.threads, unscoped.threads.filter(inProject));
  assert.deepEqual(active.archivedThreads, []);
  assert.sameMembers(
    active.threads.map((thread) => thread.id),
    [activeThreadId, forkThreadId],
  );
  const fork = active.threads.find((thread) => thread.id === forkThreadId);
  assert.isAbove(fork?.visibleItemCount ?? 0, 0);

  const all = yield* projectionStore.getShellSnapshot({ projectId });
  assert.deepEqual(all.threads, active.threads);
  assert.deepEqual(all.archivedThreads, unscoped.archivedThreads.filter(inProject));
  assert.sameMembers(
    all.archivedThreads.map((thread) => thread.id),
    [archivedThreadId],
  );
  return { projectId, activeThreadId, forkThreadId, otherThreadId };
});

it.effect("memory shell snapshots scope to one project", () =>
  assertProjectScopedShells("memory-project-shell").pipe(
    Effect.asVoid,
    Effect.provide(ProjectionStore.layerMemory),
  ),
);

it.layer(layerTest)("ProjectionStoreV2", (it) => {
  it.effect("returns a typed read error for malformed stored plan JSON", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const threadId = yield* addRolledBackRecoveryCandidate("corrupt-plan");
      const planId = PlanId.make("plan:corrupt");
      yield* sql`INSERT INTO orchestration_v2_projection_plans
        (plan_id, thread_id, node_id, kind, status, payload_json)
        VALUES (${planId}, ${threadId}, 'node:corrupt-plan', 'proposed_plan', 'active', '{broken')`;

      const failure = yield* store
        .getPlan(threadId, planId)
        .pipe(
          Effect.flip,
          Effect.ensuring(
            Effect.orDie(
              sql`DELETE FROM orchestration_v2_projection_plans WHERE plan_id = ${planId}`,
            ),
          ),
        );
      assert.strictEqual(failure._tag, "ProjectionStoreReadError");
    }),
  );

  it.effect(
    "SQL recovery selects unfinished runless native subagents",
    () => runlessNativeSubagentNeedsRecovery,
  );
  it.effect(
    "worktree path lookup defaults to active threads and can include archived threads",
    () => threadWorktreePathsIncludeArchivedOnRequest,
  );

  it.effect(
    "keeps restart-cancelled work through a stale run.updated",
    () => restartCancelledWorkSurvivesStaleRunUpdate,
  );
  it.effect("records restart-cancelled work without regressing a run that completed since", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = yield* addRolledBackRecoveryCandidate("restart-cancelled-work");
      const run = (yield* store.getThreadProjection(threadId)).runs[0]!;
      const now = yield* DateTime.now;
      yield* store.apply({
        id: EventId.make("event:restart-cancelled-work:completed"),
        type: "run.updated",
        threadId,
        runId: run.id,
        providerInstanceId,
        occurredAt: now,
        payload: { ...run, status: "completed", completedAt: now },
      });
      const work = [{ kind: "subagent" as const, label: "Background subagent test" }];
      yield* store.apply({
        id: EventId.make("event:restart-cancelled-work:recorded"),
        type: "run.background-work-cancelled",
        threadId,
        runId: run.id,
        providerInstanceId,
        occurredAt: now,
        payload: { runId: run.id, restartCancelledBackgroundWork: work },
      });
      const recorded = (yield* store.getThreadProjection(threadId)).runs[0];
      assert.equal(recorded?.status, "completed");
      assert.deepEqual(recorded?.restartCancelledBackgroundWork, work);
      const [recovery] = (yield* store.getThreadRecords(threadId, ["runs"], {
        runIds: [run.id],
      })).runs;
      assert.equal(recovery?.status, "completed");
      assert.deepEqual(recovery?.restartCancelledBackgroundWork, work);
    }),
  );
  it.effect(
    "command reads skip finished leaf nodes of finished runs",
    () => commandReadsSkipSettledLeafNodes,
  );
  it.effect("limits turn-start history to the requested runs, including an empty selection", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = yield* addRolledBackRecoveryCandidate("selected-turn-start-history");
      const runId = (yield* store.getThreadProjection(threadId)).runs[0]!.id;
      const history = yield* store.getTurnStartHistory(threadId);
      assert.isNotEmpty(history);
      assert.deepEqual(yield* store.getTurnStartHistory(threadId, [runId]), history);
      assert.deepEqual(yield* store.getTurnStartHistory(threadId, []), []);
      assert.deepEqual(yield* store.getTurnStartHistory(threadId, [RunId.make("run:other")]), []);
    }),
  );
  it.effect("answers empty record filters without reading the filtered tables", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = yield* addRolledBackRecoveryCandidate("empty-record-filters");
      const runId = (yield* store.getThreadProjection(threadId)).runs[0]!.id;
      const queries: Array<string> = [];
      const recordQueries: Statement.Transformer = (statement) => {
        queries.push(statement.compile()[0]);
        return Effect.succeed(statement);
      };
      const read = (filter: ProjectionStore.ProjectionRecordFilter) =>
        store
          .getThreadRecords(threadId, ["runs", "messages", "turnItems"], filter)
          .pipe(Effect.provideService(Statement.CurrentTransformer, recordQueries));

      const emptyFilters = [
        [{ turnItemTypes: [] }, "turnItems", "turn_items"],
        [{ turnItemStatuses: [] }, "turnItems", "turn_items"],
        [{ turnItemRunIds: [] }, "turnItems", "turn_items"],
        [{ runIds: [] }, "runs", "runs"],
        [{ messageIds: [] }, "messages", "messages"],
        [{ messageRoles: [] }, "messages", "messages"],
        [{ messageRunIds: [] }, "messages", "messages"],
      ] as const;
      for (const [filter, field, table] of emptyFilters) {
        queries.length = 0;
        assert.isEmpty((yield* read(filter))[field]);
        assert.isFalse(
          queries.some((query) =>
            new RegExp(`FROM orchestration_v2_projection_${table}\\b`).test(query),
          ),
          `${JSON.stringify(filter)} read ${table}`,
        );
      }

      const selected = yield* read({ turnItemTypes: ["command_execution"], runIds: [runId] });
      assert.deepEqual(
        selected.turnItems.map((item) => item.type),
        ["command_execution"],
      );
      assert.deepEqual(
        selected.runs.map((run) => run.id),
        [runId],
      );
      assert.isEmpty((yield* read({ turnItemTypes: ["user_message"] })).turnItems);
    }),
  );
  it.effect("preserves stored provider usage when a terminal update omits it", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:provider-usage-reload");
      const providerThreadId = ProviderThreadId.make("provider-thread:provider-usage-reload");
      const providerTurnId = ProviderTurnId.make("provider-turn:provider-usage-reload");
      const nodeId = NodeId.make("node:provider-usage-reload");
      const initialUsage = {
        usedTokens: 12_000,
        maxTokens: 200_000,
        inputTokens: 11_000,
        outputTokens: 1_000,
        updatedAt: "2026-08-29T12:00:00.000Z",
      } as const;
      const replacementUsage = {
        usedTokens: 18_000,
        maxTokens: 200_000,
        inputTokens: 16_000,
        outputTokens: 2_000,
        updatedAt: "2026-08-29T12:00:01.000Z",
      } as const;

      yield* projectionStore.apply({
        id: EventId.make("event:provider-usage-reload:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:provider-usage-reload"),
          title: "Provider usage reload",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });

      const providerTurn = {
        id: providerTurnId,
        providerThreadId,
        nodeId,
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal: 1,
        status: "running" as const,
        startedAt: now,
        completedAt: null,
      };
      yield* projectionStore.apply({
        id: EventId.make("event:provider-usage-reload:running"),
        type: "provider-turn.updated",
        threadId,
        nodeId,
        driver,
        occurredAt: now,
        payload: { ...providerTurn, tokenUsage: initialUsage },
      });
      yield* projectionStore.apply({
        id: EventId.make("event:provider-usage-reload:completed"),
        type: "provider-turn.updated",
        threadId,
        nodeId,
        driver,
        occurredAt: now,
        payload: { ...providerTurn, status: "completed", completedAt: now },
      });

      const reloaded = yield* projectionStore.getThreadProjection(threadId);
      assert.deepEqual(reloaded.providerTurns[0]?.tokenUsage, initialUsage);
      assert.strictEqual(reloaded.providerTurns[0]?.status, "completed");

      yield* projectionStore.apply({
        id: EventId.make("event:provider-usage-reload:replacement"),
        type: "provider-turn.updated",
        threadId,
        nodeId,
        driver,
        occurredAt: now,
        payload: {
          ...providerTurn,
          status: "completed",
          completedAt: now,
          tokenUsage: replacementUsage,
        },
      });

      const replaced = yield* projectionStore.getThreadProjection(threadId);
      assert.deepEqual(replaced.providerTurns[0]?.tokenUsage, replacementUsage);
    }),
  );

  it.effect("pages complete user turns through SQL regardless of tool count or payload size", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const threadId = ThreadId.make("thread:user-turn-pages");
      yield* projectionStore.apply({
        id: EventId.make("event:user-turn-pages:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:user-turn-pages"),
          title: "Bounded SQL history",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });

      const allIds: string[] = [];
      let lastToolPayload = "";
      for (let turn = 1; turn <= 45; turn += 1) {
        const rows = Array.from({ length: 102 }, (_, offset) => {
          const ordinal = (turn - 1) * 102 + offset + 1;
          const id = `item:user-turn-pages:${ordinal}`;
          allIds.push(id);
          const base = {
            id,
            threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal,
            status: "completed",
            title: null,
            startedAt: nowIso,
            completedAt: nowIso,
            updatedAt: nowIso,
          };
          const item =
            offset < 2
              ? {
                  ...base,
                  type: "user_message",
                  createdBy: "user",
                  creationSource: "web",
                  messageId: `message:${id}`,
                  inputIntent: offset === 0 ? "turn_start" : "steer",
                  text: `Turn ${turn}`,
                  attachments: [],
                }
              : {
                  ...base,
                  type: "command_execution",
                  input: "command",
                  output: "x".repeat(2048),
                  exitCode: 0,
                };
          const payloadJson = encodeUnknownJsonString(item);
          if (offset >= 2) lastToolPayload = payloadJson;
          return {
            turn_item_id: id,
            thread_id: threadId,
            run_id: null,
            node_id: null,
            provider_thread_id: null,
            provider_turn_id: null,
            parent_item_id: null,
            ordinal,
            type: item.type,
            status: "completed",
            updated_at: nowIso,
            payload_json: payloadJson,
          };
        });
        yield* sql`INSERT INTO orchestration_v2_projection_turn_items ${sql.insert(rows)}`;
      }
      const { statements, tracer } = traceSqlStatements();
      const initial = yield* Effect.acquireUseRelease(
        Effect.sync(() => vi.spyOn(JSON, "parse")),
        (parse) =>
          projectionStore
            .getThreadSnapshotWindow(threadId, { rowLimit: 77, userTurnLimit: 10 })
            .pipe(
              Effect.withTracer(tracer),
              Effect.tap(() =>
                Effect.sync(() => {
                  assert.lengthOf(
                    parse.mock.calls.filter(([input]) => input === lastToolPayload),
                    1,
                  );
                }),
              ),
            ),
        (parse) => Effect.sync(() => parse.mockRestore()),
      );
      const windowStatement = statements.find((statement) => statement.includes("turn_anchors"));
      assert.isDefined(windowStatement);
      const windowPlan = yield* sql.unsafe<{ readonly parent: number; readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${windowStatement}`,
      );
      assert.match(
        windowPlan.map((row) => row.detail).join("\n"),
        /SEARCH item USING INDEX orchestration_v2_projection_turn_items_user_message_idx \(thread_id=\? AND ordinal<\?\)/,
      );
      const topLevel = windowPlan.filter((row) => row.parent === 0).map((row) => row.detail);
      assert.include(topLevel, "SEARCH item USING INTEGER PRIMARY KEY (rowid=?)");
      assert.notInclude(topLevel, "USE TEMP B-TREE FOR ORDER BY");
      const nodeStatement = statements.find((statement) =>
        statement.includes("WITH RECURSIVE retained"),
      );
      assert.isDefined(nodeStatement);
      const nodePlan = yield* sql.unsafe<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${nodeStatement}`,
      );
      assert.include(
        nodePlan.map((row) => row.detail),
        "SEARCH orchestration_v2_projection_nodes USING INDEX orchestration_v2_projection_nodes_live_idx (thread_id=?)",
      );
      assert.lengthOf(initial.projection.turnItems, 12 * 102);
      const bounded = buildBoundedThreadProjection({
        projection: initial.projection,
        snapshotSequence: 0,
      });
      assert.lengthOf(bounded.projection.visibleTurnItems, 10 * 102);
      assert.strictEqual(bounded.projection.visibleTurnItems[0]?.sourceItemId, allIds[35 * 102]);
      const loaded = bounded.projection.visibleTurnItems.map((row) => String(row.sourceItemId));
      let cursor = bounded.historyCursor;
      for (const turns of [20, 15]) {
        assert.isNotNull(cursor);
        const anchor = decodeThreadHistoryCursor(cursor!);
        const snapshot = yield* projectionStore.getThreadSnapshotWindow(threadId, {
          rowLimit: 77,
          userTurnLimit: 20,
          anchorItemId: TurnItemId.make(anchor.si),
          anchorThreadId: ThreadId.make(anchor.st),
        });
        const page = selectHistoryPageFromCursor({
          items: snapshot.projection.visibleTurnItems,
          cursor: cursor!,
          snapshotSequence: 0,
        });
        assert.lengthOf(page.items, turns * 102);
        loaded.unshift(...page.items.map((row) => String(row.sourceItemId)));
        cursor = page.nextCursor;
      }
      assert.isNull(cursor);
      assert.deepEqual(loaded, allIds);
    }),
  );

  it.effect("scopes actionable provider state to the requested bounded thread", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:bounded-provider-scope");
      const targetThreadId = ThreadId.make("thread:bounded-provider-scope:target");
      const unrelatedThreadId = ThreadId.make("thread:bounded-provider-scope:unrelated");
      const makeThread = (threadId: ThreadId) => ({
        createdBy: "user" as const,
        creationSource: "web" as const,
        id: threadId,
        projectId,
        title: String(threadId),
        providerInstanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      });
      for (const threadId of [targetThreadId, unrelatedThreadId]) {
        yield* projectionStore.apply({
          id: EventId.make(`event:bounded-provider-scope:thread:${threadId}`),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: makeThread(threadId),
        });
        const sessionId = ProviderSessionId.make(`provider-session:${threadId}`);
        const providerThreadId = ProviderThreadId.make(`provider-thread:${threadId}`);
        yield* projectionStore.apply({
          id: EventId.make(`event:bounded-provider-scope:session:${threadId}`),
          type: "provider-session.attached",
          threadId,
          driver,
          occurredAt: now,
          payload: {
            id: sessionId,
            driver,
            providerInstanceId,
            status: "running",
            cwd: "/workspace",
            model: modelSelection.model,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
        });
        yield* projectionStore.apply({
          id: EventId.make(`event:bounded-provider-scope:provider-thread:${threadId}`),
          type: "provider-thread.updated",
          threadId,
          driver,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId,
            providerSessionId: sessionId,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      const snapshot = yield* projectionStore.getThreadSnapshotWindow(targetThreadId, {
        rowLimit: 10,
      });

      assert.deepEqual(
        snapshot.projection.providerSessions.map((session) => session.id),
        [ProviderSessionId.make(`provider-session:${targetThreadId}`)],
      );
      assert.deepEqual(
        snapshot.projection.providerThreads.map((thread) => thread.id),
        [ProviderThreadId.make(`provider-thread:${targetThreadId}`)],
      );
    }),
  );

  it.effect("projects root provider owners into the shell in first-use order", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:provider-history");
      const threadId = ThreadId.make("thread:provider-history");
      const claudeInstanceId = ProviderInstanceId.make("claude");
      const claudeDriver = ProviderDriverKind.make("claudeAgent");
      yield* projectionStore.apply({
        id: EventId.make("event:provider-history:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId,
          title: "Provider history",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
      const providerThreads = [
        { suffix: "codex", instanceId: providerInstanceId, ownerNodeId: null, seconds: 0 },
        {
          suffix: "claude-subagent",
          instanceId: claudeInstanceId,
          ownerNodeId: NodeId.make("node:provider-history"),
          seconds: 1,
        },
        { suffix: "claude", instanceId: claudeInstanceId, ownerNodeId: null, seconds: 2 },
        { suffix: "codex-again", instanceId: providerInstanceId, ownerNodeId: null, seconds: 3 },
      ] as const;
      for (const providerThread of providerThreads) {
        const createdAt = DateTime.add(now, { seconds: providerThread.seconds });
        yield* projectionStore.apply({
          id: EventId.make(`event:provider-history:${providerThread.suffix}`),
          type: "provider-thread.updated",
          threadId,
          driver: providerThread.instanceId === claudeInstanceId ? claudeDriver : driver,
          occurredAt: createdAt,
          payload: {
            id: ProviderThreadId.make(`provider-thread:provider-history:${providerThread.suffix}`),
            driver: providerThread.instanceId === claudeInstanceId ? claudeDriver : driver,
            providerInstanceId: providerThread.instanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: providerThread.ownerNodeId,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt,
            updatedAt: createdAt,
          },
        });
      }

      const shell = (yield* projectionStore.getShellSnapshot()).threads.find(
        (thread) => thread.id === threadId,
      );
      assert.deepEqual(shell?.providerInstanceHistory, [providerInstanceId, claudeInstanceId]);
    }),
  );

  it.effect("shows the native goal of the active provider thread on the shell", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:provider-goal");
      yield* projectionStore.apply({
        id: EventId.make("event:provider-goal:thread"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId: ProjectId.make("project:provider-goal"),
          title: "Provider goal",
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
      const applyProviderThread = (
        suffix: string,
        goal: OrchestrationV2ProviderThread["goal"],
        seconds: number,
      ) =>
        projectionStore.apply({
          id: EventId.make(`event:provider-goal:${suffix}:${seconds}`),
          type: "provider-thread.updated",
          threadId,
          driver,
          occurredAt: DateTime.add(now, { seconds }),
          payload: {
            id: ProviderThreadId.make(`provider-thread:provider-goal:${suffix}`),
            driver,
            providerInstanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: null,
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            goal,
            createdAt: now,
            updatedAt: DateTime.add(now, { seconds }),
          },
        });
      const shellGoal = Effect.map(
        projectionStore.getShellSnapshot(),
        (snapshot) => snapshot.threads.find((thread) => thread.id === threadId)?.goal,
      );
      const goal = { objective: "Ship it", status: "active" as const, tokensUsed: 10 };

      yield* applyProviderThread("first", goal, 0);
      assert.deepEqual(yield* shellGoal, goal);
      yield* applyProviderThread("second", null, 1);
      assert.isNull(yield* shellGoal);
    }),
  );

  it.effect("reads the shell snapshot first and decodes it in a separate step", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const createThread = (threadId: ThreadId) =>
        projectionStore.apply({
          id: EventId.make(`event:${threadId}:created`),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: {
            createdBy: "user",
            creationSource: "web",
            id: threadId,
            projectId: ProjectId.make("project:shell-read"),
            title: "Shell read",
            providerInstanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        });
      const readThreadId = ThreadId.make("thread:shell-read:before");
      const laterThreadId = ThreadId.make("thread:shell-read:after");
      const shellIds = (snapshot: OrchestrationV2ThreadShellSnapshot) =>
        snapshot.threads
          .map((thread) => thread.id)
          .filter((id) => id === readThreadId || id === laterThreadId);

      yield* createThread(readThreadId);
      const decode = yield* sql.withTransaction(projectionStore.readShellSnapshot());
      yield* createThread(laterThreadId);

      assert.deepEqual(shellIds(yield* decode), [readThreadId]);
      assert.sameMembers(shellIds(yield* projectionStore.getShellSnapshot()), [
        readThreadId,
        laterThreadId,
      ]);

      const [stored] = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads
        WHERE thread_id = ${laterThreadId}
      `;
      const setPayload = (payload: string) =>
        sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${payload}
          WHERE thread_id = ${laterThreadId}`;
      yield* setPayload("{}");
      const failure = yield* sql
        .withTransaction(projectionStore.readShellSnapshot())
        .pipe(
          Effect.flatMap(Effect.flip),
          Effect.ensuring(Effect.orDie(setPayload(stored!.payload_json))),
        );
      assert.strictEqual(failure._tag, "ProjectionStoreReadError");
    }),
  );

  it.effect("reads only the requested project's threads into a scoped shell snapshot", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const { projectId, activeThreadId, forkThreadId, otherThreadId } =
        yield* assertProjectScopedShells("sql-project-shell");

      const [stored] = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads
        WHERE thread_id = ${otherThreadId}
      `;
      const setPayload = (payload: string) =>
        sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${payload}
          WHERE thread_id = ${otherThreadId}`;
      yield* setPayload("{}");
      const [unscoped, scoped] = yield* Effect.all([
        projectionStore.getShellSnapshot().pipe(Effect.flip),
        projectionStore.getShellSnapshot({ projectId, location: "active" }),
      ]).pipe(Effect.ensuring(Effect.orDie(setPayload(stored!.payload_json))));
      assert.strictEqual(unscoped._tag, "ProjectionStoreReadError");
      assert.sameMembers(
        scoped.threads.map((thread) => thread.id),
        [activeThreadId, forkThreadId],
      );
    }),
  );

  it.effect("does not treat visited or marked-unread state as thread activity", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const createdAt = yield* DateTime.now;
      const visitedOccurredAt = DateTime.add(createdAt, { seconds: 1 });
      const markedUnreadOccurredAt = DateTime.add(createdAt, { seconds: 2 });
      const threadId = ThreadId.make("thread:projection-read-state");
      const projectId = ProjectId.make("project:projection-read-state");
      const thread = {
        createdBy: "user" as const,
        creationSource: "web" as const,
        id: threadId,
        projectId,
        title: "Projection read state",
        providerInstanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: {
          parentThreadId: null,
          relationshipToParent: null,
          rootThreadId: threadId,
        },
        forkedFrom: null,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };

      yield* projectionStore.apply({
        id: EventId.make("event:projection-read-state:created"),
        type: "thread.created",
        threadId,
        occurredAt: createdAt,
        payload: thread,
      });
      yield* projectionStore.apply({
        id: EventId.make("event:projection-read-state:visited"),
        type: "thread.visited",
        threadId,
        occurredAt: visitedOccurredAt,
        payload: { ...thread, lastVisitedAt: createdAt },
      });

      const visited = yield* projectionStore.getThreadProjection(threadId);
      assert.deepEqual(visited.thread.lastVisitedAt, createdAt);
      assert.deepEqual(visited.thread.updatedAt, createdAt);

      yield* projectionStore.apply({
        id: EventId.make("event:projection-read-state:marked-unread"),
        type: "thread.marked-unread",
        threadId,
        occurredAt: markedUnreadOccurredAt,
        payload: thread,
      });

      const markedUnread = yield* projectionStore.getThreadProjection(threadId);
      assert.isNull(markedUnread.thread.lastVisitedAt);
      assert.deepEqual(markedUnread.thread.updatedAt, createdAt);
    }),
  );

  it.effect("projects only the latest failed root turn's limit into SQL and memory shells", () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = yield* addRolledBackRecoveryCandidate("limit-shell");
      const otherThreadId = yield* addRolledBackRecoveryCandidate("other-limit-shell");
      const original = (yield* store.getThreadProjection(threadId)).runs[0]!;
      const now = yield* DateTime.now;
      const limitItem = {
        id: TurnItemId.make("limit-shell:error"),
        threadId,
        runId: original.id,
        nodeId: original.rootNodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 2,
        status: "failed" as const,
        title: "Usage limit reached",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "error" as const,
        failure: {
          class: "usage_limit" as const,
          message: "Plan limit reached.",
          resetAt: "2099-01-01T00:00:00.000Z",
          code: "usageLimitExceeded",
          retryable: null,
        },
      };
      const applyRun = (status: typeof original.status, rootNodeId = original.rootNodeId) =>
        store.apply({
          id: EventId.make(`event:limit-shell:run:${status}:${rootNodeId}`),
          type: "run.updated",
          threadId,
          occurredAt: now,
          payload: { ...original, rootNodeId, status },
        });
      const assertSummary = Effect.fnUntraced(function* (
        lastError: string | null,
        lastErrorClass: string | null,
      ) {
        const projection = yield* store.getThreadProjection(threadId);
        const memoryShell = ProjectionStore.threadShellFromProjection(projection);
        const shells = yield* store.getShellSnapshot();
        const sqlShell = shells.threads.find((row) => row.id === threadId)!;
        for (const shell of [memoryShell, sqlShell]) {
          assert.equal(shell.lastError, lastError);
          assert.equal(shell.lastErrorClass, lastErrorClass);
          assert.equal(
            shell.usageLimitResetAt,
            lastErrorClass === "usage_limit" ? "2099-01-01T00:00:00.000Z" : null,
          );
        }
        assert.isNull(shells.threads.find((row) => row.id === otherThreadId)!.lastErrorClass);
        const candidates = yield* store.getLimitRecoveryCandidates({
          now,
          autoResume: true,
          snooze: false,
        });
        const candidate = candidates.find((row) => row.id === threadId);
        if (lastErrorClass === "usage_limit") {
          assert.deepEqual(candidate, {
            id: sqlShell.id,
            status: sqlShell.status,
            lastErrorClass: sqlShell.lastErrorClass,
            usageLimitResetAt: sqlShell.usageLimitResetAt,
            latestRunId: sqlShell.latestRunId,
            latestRunCompletedAt: sqlShell.latestRunCompletedAt,
            updatedAt: sqlShell.updatedAt,
            archivedAt: sqlShell.archivedAt,
            settledOverride: sqlShell.settledOverride,
            pendingRuntimeRequest: null,
            limitRecovery: sqlShell.limitRecovery,
            snoozedUntil: sqlShell.snoozedUntil,
          });
        } else assert.isUndefined(candidate);
        assert.isUndefined(candidates.find((row) => row.id === otherThreadId));
      });
      yield* store.apply({
        id: EventId.make("event:limit-shell:error"),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: limitItem,
      });
      yield* applyRun("failed");
      yield* assertSummary("Plan limit reached.", "usage_limit");
      const queuedRunId = RunId.make("run:limit-shell:queued");
      yield* store.apply({
        id: EventId.make("event:limit-shell:queued"),
        type: "run.created",
        threadId,
        runId: queuedRunId,
        nodeId: NodeId.make("node:limit-shell:queued"),
        driver,
        providerInstanceId,
        occurredAt: now,
        payload: {
          ...original,
          id: queuedRunId,
          ordinal: original.ordinal + 1,
          rootNodeId: NodeId.make("node:limit-shell:queued"),
          userMessageId: MessageId.make("message:limit-shell:queued"),
          status: "queued",
          startedAt: null,
          completedAt: null,
        },
      });
      yield* assertSummary("Plan limit reached.", "usage_limit");
      const queuedProjection = yield* store.getThreadProjection(threadId);
      const queuedMemoryShell = ProjectionStore.threadShellFromProjection(queuedProjection);
      const queuedSqlShell = (yield* store.getShellSnapshot()).threads.find(
        (row) => row.id === threadId,
      )!;
      assert.equal(queuedMemoryShell.status, "failed");
      assert.equal(queuedMemoryShell.latestRunId, original.id);
      assert.equal(queuedSqlShell.status, "failed");
      assert.equal(queuedSqlShell.latestRunId, original.id);
      assert.equal(queuedProjection.runs.find((run) => run.id === queuedRunId)?.status, "queued");
      const cancelledRunId = RunId.make("run:limit-shell:cancelled-queued");
      yield* store.apply({
        id: EventId.make("event:limit-shell:cancelled-queued"),
        type: "run.created",
        threadId,
        runId: cancelledRunId,
        nodeId: NodeId.make("node:limit-shell:cancelled-queued"),
        driver,
        providerInstanceId,
        occurredAt: now,
        payload: {
          ...original,
          id: cancelledRunId,
          ordinal: original.ordinal + 2,
          rootNodeId: NodeId.make("node:limit-shell:cancelled-queued"),
          userMessageId: MessageId.make("message:limit-shell:cancelled-queued"),
          status: "cancelled",
          startedAt: null,
          completedAt: now,
        },
      });
      yield* store.apply({
        id: EventId.make("event:limit-shell:cancelled-queued-message"),
        type: "turn-item.updated",
        threadId,
        runId: cancelledRunId,
        nodeId: NodeId.make("node:limit-shell:cancelled-queued"),
        driver,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: TurnItemId.make("limit-shell:cancelled-queued-message"),
          threadId,
          runId: cancelledRunId,
          nodeId: NodeId.make("node:limit-shell:cancelled-queued"),
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 3,
          status: "completed",
          title: null,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "user_message",
          messageId: MessageId.make("message:limit-shell:cancelled-queued"),
          inputIntent: "turn_start",
          text: "cancelled before the provider started",
          attachments: [],
        },
      });
      yield* assertSummary("Plan limit reached.", "usage_limit");
      const aheadRunId = RunId.make("run:limit-shell:ran-ahead");
      yield* store.apply({
        id: EventId.make("event:limit-shell:ran-ahead"),
        type: "run.created",
        threadId,
        runId: aheadRunId,
        nodeId: NodeId.make("node:limit-shell:ran-ahead"),
        driver,
        providerInstanceId,
        occurredAt: now,
        payload: {
          ...original,
          id: aheadRunId,
          ordinal: original.ordinal + 3,
          rootNodeId: NodeId.make("node:limit-shell:ran-ahead"),
          userMessageId: MessageId.make("message:limit-shell:ran-ahead"),
          status: "completed",
          startedAt: DateTime.subtract(now, { minutes: 10 }),
          completedAt: DateTime.subtract(now, { minutes: 5 }),
        },
      });
      yield* assertSummary("Plan limit reached.", "usage_limit");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM orchestration_v2_projection_runs WHERE run_id = ${aheadRunId}`;
      yield* sql`DELETE FROM orchestration_v2_projection_runs WHERE run_id = ${queuedRunId}`;
      yield* assertSummary("Plan limit reached.", "usage_limit");
      yield* sql`DELETE FROM orchestration_v2_projection_runs WHERE run_id = ${cancelledRunId}`;
      const [originalRow] = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}`;
      for (const [field, value] of [
        ["archivedAt", DateTime.formatIso(now)],
        ["settledOverride", "settled"],
      ]) {
        yield* sql`UPDATE orchestration_v2_projection_threads
          SET payload_json = json_set(payload_json, ${`$.${field}`}, ${value})
          WHERE thread_id = ${threadId}`;
        assert.isUndefined(
          (yield* store.getLimitRecoveryCandidates({ now, autoResume: true, snooze: false })).find(
            (row) => row.id === threadId,
          ),
        );
        yield* sql`UPDATE orchestration_v2_projection_threads
          SET payload_json = ${originalRow!.payload_json} WHERE thread_id = ${threadId}`;
      }
      yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = ${DateTime.formatIso(now)} WHERE thread_id = ${threadId}`;
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates({ now, autoResume: true, snooze: false })).find(
          (row) => row.id === threadId,
        ),
      );
      yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = NULL WHERE thread_id = ${threadId}`;
      const recoveryOptions = { now, autoResume: false, snooze: false };
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates(recoveryOptions)).find(
          (row) => row.id === threadId,
        ),
      );
      const reset = DateTime.makeUnsafe(limitItem.failure.resetAt);
      const recovery = {
        runId: original.id,
        resetAt: limitItem.failure.resetAt,
        autoResume: true,
        requestId: CommandId.make("recovery:choice"),
      };
      yield* sql`UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.limitRecovery', json(${encodeUnknownJsonString(recovery)}))
        WHERE thread_id = ${threadId}`;
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates({ ...recoveryOptions, autoResume: true })).find(
          (row) => row.id === threadId,
        ),
      );
      const due = (yield* store.getLimitRecoveryCandidates({
        ...recoveryOptions,
        now: reset,
      })).find((row) => row.id === threadId)!;
      assert.deepEqual(due.limitRecovery, recovery);
      yield* sql`INSERT INTO orchestration_v2_projection_runtime_requests
        (runtime_request_id, thread_id, node_id, kind, status, created_at, payload_json)
        VALUES ('limit-shell:pending-request', ${threadId}, ${original.rootNodeId}, 'approval', 'pending', ${DateTime.formatIso(now)}, '{}')`;
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates({ ...recoveryOptions, now: reset })).find(
          (row) => row.id === threadId,
        ),
      );
      yield* sql`DELETE FROM orchestration_v2_projection_runtime_requests WHERE runtime_request_id = 'limit-shell:pending-request'`;
      yield* sql`UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.snoozedUntil', ${DateTime.formatIso(DateTime.add(reset, { minutes: 1 }))})
        WHERE thread_id = ${threadId}`;
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates({ ...recoveryOptions, now: reset })).find(
          (row) => row.id === threadId,
        ),
      );
      yield* sql`UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.snoozedUntil', NULL, '$.limitRecovery.autoResume', json('false'))
        WHERE thread_id = ${threadId}`;
      assert.isUndefined(
        (yield* store.getLimitRecoveryCandidates({
          ...recoveryOptions,
          now: reset,
          autoResume: true,
        })).find((row) => row.id === threadId),
      );
      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${originalRow!.payload_json} WHERE thread_id = ${threadId}`;
      const session = {
        id: ProviderSessionId.make("session:limit-shell:shared"),
        driver,
        providerInstanceId,
        status: "ready" as const,
        cwd: "/workspace",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      for (const boundThreadId of [threadId, otherThreadId]) {
        yield* store.apply({
          id: EventId.make(`event:limit-shell:bind:${boundThreadId}`),
          type: "provider-session.attached",
          threadId: boundThreadId,
          driver,
          providerInstanceId,
          occurredAt: now,
          payload: session,
        });
      }
      yield* assertSummary("Plan limit reached.", "usage_limit");
      yield* store.apply({
        id: EventId.make("event:limit-shell:session-failed"),
        type: "provider-session.updated",
        threadId,
        occurredAt: now,
        payload: { ...session, status: "error", lastError: "Provider process exited." },
      });
      yield* assertSummary("Provider process exited.", null);
      yield* store.apply({
        id: EventId.make("event:limit-shell:session-recovered"),
        type: "provider-session.updated",
        threadId,
        occurredAt: now,
        payload: session,
      });
      yield* assertSummary("Plan limit reached.", "usage_limit");
      yield* store.apply({
        id: EventId.make("event:limit-shell:child-error"),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: {
          ...limitItem,
          id: TurnItemId.make("limit-shell:child-error"),
          nodeId: NodeId.make("child-node"),
          ordinal: 3,
          failure: { ...limitItem.failure, class: "provider_error", message: "Child failed." },
        },
      });
      yield* assertSummary("Plan limit reached.", "usage_limit");
      yield* store.apply({
        id: EventId.make("event:limit-shell:replacement"),
        type: "turn-item.updated",
        threadId,
        occurredAt: now,
        payload: {
          ...limitItem,
          id: TurnItemId.make("limit-shell:replacement"),
          ordinal: 4,
          failure: { ...limitItem.failure, class: "provider_error", message: "Provider failed." },
        },
      });
      yield* assertSummary("Provider failed.", "provider_error");
      for (const status of [
        "running",
        "completed",
        "interrupted",
        "cancelled",
        "rolled_back",
      ] as const) {
        yield* applyRun(status);
        yield* assertSummary(null, null);
      }
      yield* applyRun("failed", NodeId.make("new-attempt-root"));
      yield* assertSummary(null, null);
    }),
  );

  it.effect("projects one shared provider session into multiple thread bindings", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const projectId = ProjectId.make("project:projection-shared-provider-session");
      const firstThreadId = ThreadId.make("thread:projection-shared-provider-session:first");
      const secondThreadId = ThreadId.make("thread:projection-shared-provider-session:second");
      const providerSessionId = ProviderSessionId.make(
        "provider-session:projection-shared-provider-session",
      );
      const makeThread = (threadId: ThreadId) => ({
        createdBy: "user" as const,
        creationSource: "web" as const,
        id: threadId,
        projectId,
        title: "Shared provider session",
        providerInstanceId,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: {
          parentThreadId: null,
          relationshipToParent: null,
          rootThreadId: threadId,
        },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      });
      const session = {
        id: providerSessionId,
        driver,
        providerInstanceId,
        status: "error" as const,
        cwd: "/workspace",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: "provider process exited",
      };

      yield* projectionStore.apply({
        id: EventId.make("event:projection-shared-provider-session:first-thread"),
        type: "thread.created",
        threadId: firstThreadId,
        occurredAt: now,
        payload: makeThread(firstThreadId),
      });
      yield* projectionStore.apply({
        id: EventId.make("event:projection-shared-provider-session:second-thread"),
        type: "thread.created",
        threadId: secondThreadId,
        occurredAt: now,
        payload: makeThread(secondThreadId),
      });
      for (const [threadId, suffix] of [
        [firstThreadId, "first"],
        [secondThreadId, "second"],
      ] as const) {
        yield* projectionStore.apply({
          id: EventId.make(`event:projection-shared-provider-session:${suffix}-binding`),
          type: "provider-session.attached",
          threadId,
          driver,
          providerInstanceId,
          occurredAt: now,
          payload: session,
        });
      }

      assert.deepEqual(
        (yield* projectionStore.getThreadProjection(firstThreadId)).providerSessions.map(
          (value) => value.id,
        ),
        [providerSessionId],
      );
      assert.deepEqual(
        (yield* projectionStore.getThreadProjection(secondThreadId)).providerSessions.map(
          (value) => value.id,
        ),
        [providerSessionId],
      );
      assert.deepEqual(
        (yield* projectionStore.getShellSnapshot()).threads
          .filter((thread) => thread.id === firstThreadId || thread.id === secondThreadId)
          .map((thread) => ({
            id: thread.id,
            lastError: thread.lastError,
          })),
        [
          { id: firstThreadId, lastError: "provider process exited" },
          { id: secondThreadId, lastError: "provider process exited" },
        ],
      );

      yield* projectionStore.apply({
        id: EventId.make("event:projection-shared-provider-session:first-detached"),
        type: "provider-session.detached",
        threadId: firstThreadId,
        driver,
        providerInstanceId,
        occurredAt: now,
        payload: { providerSessionId, detachedAt: now },
      });

      assert.lengthOf(
        (yield* projectionStore.getThreadProjection(firstThreadId)).providerSessions,
        0,
      );
      assert.lengthOf(
        (yield* projectionStore.getThreadProjection(secondThreadId)).providerSessions,
        1,
      );
    }),
  );

  it.effect("selects the latest waiting secret only from active runs", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const suffix = "shell-pending-secret";
      const threadId = yield* addRolledBackRecoveryCandidate(suffix);
      const runId = RunId.make(`run:${suffix}:rolled-back`);
      const nodeId = NodeId.make(`node:${suffix}:rolled-back`);
      const now = yield* DateTime.now;
      const addSecret = (id: string, ordinal: number, status: "waiting" | "completed") =>
        projectionStore.apply({
          id: EventId.make(`event:${id}`),
          type: "turn-item.updated",
          threadId,
          runId,
          nodeId,
          driver,
          occurredAt: now,
          payload: {
            id: TurnItemId.make(id),
            threadId,
            runId,
            nodeId,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal,
            status,
            title: null,
            startedAt: now,
            completedAt: null,
            updatedAt: DateTime.add(now, { seconds: ordinal }),
            type: "secret_request",
            label: "Test credential",
            reason: "Test pending input",
            secretStatus: status === "waiting" ? "pending" : "saved",
          },
        });
      yield* addSecret("secret:a", 2, "waiting");
      yield* addSecret("secret:b", 3, "waiting");
      yield* addSecret("secret:c", 4, "completed");

      yield* sql`
        UPDATE orchestration_v2_projection_runs
        SET status = 'running', payload_json = json_set(payload_json, '$.status', 'running')
        WHERE run_id = ${runId}
      `;
      const secretOnlyShell = (yield* projectionStore.getShellSnapshot()).threads.find(
        (thread) => thread.id === threadId,
      );
      const secretOnlyProjection = yield* projectionStore.getThreadProjection(threadId);
      for (const shell of [
        secretOnlyShell,
        ProjectionStore.threadShellFromProjection(secretOnlyProjection),
      ]) {
        assert.equal(shell?.pendingRuntimeRequest?.id, "secret:b");
        assert.isTrue(shell?.pendingRuntimeRequest?.blocking);
      }

      const requestId = RuntimeRequestId.make(`request:${suffix}:async`);
      yield* projectionStore.apply({
        id: EventId.make(`event:${suffix}:async`),
        type: "runtime-request.updated",
        threadId,
        runId,
        nodeId,
        driver,
        occurredAt: now,
        payload: {
          id: requestId,
          nodeId,
          providerTurnId: null,
          nativeRequestRef: null,
          kind: "user_input",
          status: "pending",
          responseCapability: { type: "message" },
          createdAt: DateTime.subtract(now, { seconds: 1 }),
          resolvedAt: null,
        },
      });

      for (const status of [
        "preparing",
        "starting",
        "running",
        "waiting",
        "completed",
        "rolled_back",
      ]) {
        yield* sql`
          UPDATE orchestration_v2_projection_runs
          SET status = ${status}, payload_json = json_set(payload_json, '$.status', ${status})
          WHERE run_id = ${runId}
        `;
        const shell = yield* projectionStore.getShellSnapshot();
        const thread = shell.threads.find((candidate) => candidate.id === threadId);
        assert.isDefined(thread);
        const projection = yield* projectionStore.getThreadProjection(threadId);
        const memoryShell = ProjectionStore.threadShellFromProjection(projection);
        const terminal = status === "completed" || status === "rolled_back";
        assert.deepEqual(
          [thread?.pendingRuntimeRequest?.id, memoryShell.pendingRuntimeRequest?.id],
          terminal ? [requestId, requestId] : ["secret:b", "secret:b"],
        );
        assert.deepEqual(
          [thread?.pendingRuntimeRequest?.blocking, memoryShell.pendingRuntimeRequest?.blocking],
          terminal ? [false, false] : [true, true],
        );
      }
    }),
  );

  it.effect("builds shell snapshots without decoding full turn item payloads", () =>
    Effect.gen(function* () {
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const threadId = ThreadId.make("thread:projection-shell-stale-item");
      const projectId = ProjectId.make("project:projection-shell");

      yield* projectionStore.apply({
        id: EventId.make("event:projection-shell-thread-created"),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId,
          title: "Projection shell",
          providerInstanceId,
          modelSelection: modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: {
            parentThreadId: null,
            relationshipToParent: null,
            rootThreadId: threadId,
          },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });

      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items (
          turn_item_id,
          thread_id,
          run_id,
          node_id,
          provider_thread_id,
          provider_turn_id,
          parent_item_id,
          ordinal,
          type,
          status,
          updated_at,
          payload_json
        )
        VALUES (
          ${"turn-item:stale-user-message"},
          ${threadId},
          ${null},
          ${null},
          ${null},
          ${null},
          ${null},
          ${0},
          ${"user_message"},
          ${"completed"},
          ${nowIso},
          ${encodeUnknownJsonString({
            id: "turn-item:stale-user-message",
            threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 0,
            status: "completed",
            title: null,
            startedAt: nowIso,
            completedAt: nowIso,
            updatedAt: nowIso,
            type: "user_message",
            messageId: "message:stale-user-message",
            text: "stale user message",
            attachments: [],
          })}
        )
      `;

      const shell = yield* projectionStore.getShellSnapshot();
      const fullProjectionExit = yield* Effect.exit(projectionStore.getThreadProjection(threadId));

      assert.deepEqual(
        shell.threads
          .filter((thread) => thread.id === threadId)
          .map((thread) => ({
            id: thread.id,
            itemCount: thread.itemCount,
            visibleItemCount: thread.visibleItemCount,
            status: thread.status,
          })),
        [
          {
            id: threadId,
            itemCount: 1,
            visibleItemCount: 1,
            status: "idle",
          },
        ],
      );
      assert.equal(fullProjectionExit._tag, "Failure");
    }),
  );
});
