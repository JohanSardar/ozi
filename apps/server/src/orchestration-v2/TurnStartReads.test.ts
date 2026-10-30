import { assert, it } from "@effect/vitest";
import {
  ContextTransferId,
  NodeId,
  EventId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerDatabase = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  ProjectionStore.layer.pipe(Layer.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "counts a native fork's inherited history as conversation for its first /compact in sqlite",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const now = yield* DateTime.now;
      const instanceId = ProviderInstanceId.make("claudeAgent");
      const sourceId = ThreadId.make("thread:fork-source");
      const forkId = ThreadId.make("thread:fork-target");
      const sourceRunId = RunId.make("run:fork-source-third");
      const forkRunId = RunId.make("run:fork-compact");
      const source: OrchestrationV2AppThread = {
        id: sourceId,
        title: "Source",
        providerInstanceId: instanceId,
        modelSelection: { instanceId, model: "claude-opus-5-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        workingDirectory: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: sourceId },
        forkedFrom: null,
        createdBy: "user",
        creationSource: "web",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      const fork: OrchestrationV2AppThread = {
        ...source,
        id: forkId,
        title: "Fork",
        lineage: { parentThreadId: sourceId, relationshipToParent: "fork", rootThreadId: sourceId },
        forkedFrom: { type: "run", threadId: sourceId, runId: sourceRunId },
      };
      const run = (threadId: ThreadId, id: RunId, status: OrchestrationV2Run["status"]) =>
        ({
          id,
          threadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection: source.modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make(`message:${id}`),
          rootNodeId: NodeId.make(`node:${id}`),
          activeAttemptId: null,
          status,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        }) satisfies OrchestrationV2Run;
      const userMessage = (threadId: ThreadId, runId: RunId, text: string) =>
        store.apply({
          id: EventId.make(`event:message:${runId}`),
          type: "message.updated",
          threadId,
          runId,
          occurredAt: now,
          payload: {
            id: MessageId.make(`message:${runId}`),
            threadId,
            runId,
            nodeId: null,
            role: "user",
            text,
            attachments: [],
            streaming: false,
            createdBy: "user",
            creationSource: "web",
            createdAt: now,
            updatedAt: now,
          },
        });
      for (const thread of [source, fork]) {
        yield* store.apply({
          id: EventId.make(`event:thread:${thread.id}`),
          type: "thread.created",
          threadId: thread.id,
          occurredAt: now,
          payload: thread,
        });
      }
      for (const [threadId, value] of [
        [sourceId, run(sourceId, sourceRunId, "completed")],
        [forkId, run(forkId, forkRunId, "queued")],
      ] as const) {
        yield* store.apply({
          id: EventId.make(`event:run:${value.id}`),
          type: "run.updated",
          threadId,
          runId: value.id,
          occurredAt: now,
          payload: value,
        });
      }
      yield* userMessage(sourceId, sourceRunId, "THIRD");
      yield* store.apply({
        id: EventId.make("event:fork-transfer"),
        type: "context-transfer.created",
        threadId: forkId,
        occurredAt: now,
        payload: {
          id: ContextTransferId.make("transfer:fork-compact"),
          type: "fork",
          sourceThreadId: sourceId,
          targetThreadId: forkId,
          sourcePoint: { threadId: sourceId, runId: sourceRunId },
          basePoint: null,
          sourceProviderInstanceId: instanceId,
          targetProviderInstanceId: instanceId,
          targetRunId: forkRunId,
          status: "pending",
          resolution: {
            strategy: "native_fork",
            providerThreadRef: {
              driver: ProviderDriverKind.make("claudeAgent"),
              nativeId: "native-fork-source",
              strength: "strong",
            },
          },
          createdBy: "user",
          error: null,
          createdAt: now,
          updatedAt: now,
          consumedAt: null,
        },
      });
      yield* userMessage(forkId, forkRunId, "/compact");

      assert.isTrue((yield* store.getTurnStartContext(forkId, forkRunId)).hasConversation);
    }).pipe(Effect.provide(layerDatabase)),
);
