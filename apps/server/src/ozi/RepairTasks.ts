import {
  CommandId,
  MessageId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";
import * as Adapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { RepairError } from "./RepairModel.ts";

export class RepairTasks extends Context.Service<
  RepairTasks,
  {
    readonly register: <A>(input: {
      threadId: ThreadId;
      commandId: CommandId;
      parentThreadId: ThreadId;
      run: Effect.Effect<A, RepairError>;
    }) => Effect.Effect<Effect.Effect<A, RepairError>, RepairError>;
    readonly authorized: (commandId: CommandId, parentThreadId: ThreadId) => boolean;
    readonly reserved: (threadId: ThreadId) => Effect.Effect<boolean, RepairError>;
    readonly open: (
      input: Adapter.ProviderAdapterV2OpenSessionInput,
      adapter: Adapter.ProviderAdapterV2["Service"],
    ) => Effect.Effect<
      Adapter.ProviderAdapterV2SessionRuntime | undefined,
      Adapter.ProviderAdapterV2Error,
      Scope.Scope
    >;
  }
>()("t3/ozi/RepairTasks") {}

export const isRepairThread = (threadId: string) =>
  threadId.startsWith("thread:delegated-task:ozi-repair%3A");

const isRepairError = Schema.is(RepairError);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isAdapterError = Schema.is(Adapter.ProviderAdapterV2Error);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const entries = new Map<
    string,
    { commandId: CommandId; parentThreadId: ThreadId; run: Effect.Effect<string, RepairError> }
  >();
  const register: RepairTasks["Service"]["register"] = Effect.fn("RepairTasks.register")(
    function* (input) {
      const result = yield* Deferred.make<Effect.Success<typeof input.run>, RepairError>();
      yield* sql`INSERT INTO ozi_repair_tasks (thread_id, command_id, parent_thread_id) VALUES (${input.threadId}, ${input.commandId}, ${input.parentThreadId})`;
      entries.set(input.threadId, {
        commandId: input.commandId,
        parentThreadId: input.parentThreadId,
        run: Effect.gen(function* () {
          const exit = yield* Effect.exit(input.run);
          yield* Deferred.done(result, exit);
          return yield* encodeJson(yield* exit);
        }).pipe(
          Effect.mapError((cause) =>
            isRepairError(cause) ? cause : new RepairError({ reason: "task-failed", cause }),
          ),
          Effect.ensuring(Effect.sync(() => entries.delete(input.threadId))),
        ),
      });
      return Deferred.await(result);
    },
    Effect.mapError((cause) =>
      isRepairError(cause) ? cause : new RepairError({ reason: "task-register-failed", cause }),
    ),
  );
  const reserved = Effect.fn("RepairTasks.reserved")((threadId: ThreadId) =>
    sql`SELECT thread_id FROM ozi_repair_tasks WHERE thread_id = ${threadId}`.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError((cause) => new RepairError({ reason: "task-lookup-failed", cause })),
    ),
  );
  const open: RepairTasks["Service"]["open"] = Effect.fn("RepairTasks.open")(
    function* (input, adapter) {
      if (!(yield* reserved(input.threadId))) return undefined;
      const entry = entries.get(input.threadId);
      const protocol = () =>
        new Adapter.ProviderAdapterProtocolError({
          driver: adapter.driver,
          detail: "Repair task is unavailable or does not support this operation",
        });
      if (!entry) return yield* protocol();
      const scope = yield* Effect.scope;
      const events = yield* Queue.unbounded<Adapter.ProviderAdapterV2Event>();
      const now = yield* DateTime.now;
      const providerSession = {
        id: input.providerSessionId,
        driver: adapter.driver,
        providerInstanceId: adapter.instanceId,
        status: "ready" as const,
        cwd: input.runtimePolicy.cwd ?? "/",
        model: input.modelSelection.model,
        capabilities: yield* adapter.getCapabilities().pipe(
          Effect.map((capabilities) => ({
            ...capabilities,
            sessions: {
              ...capabilities.sessions,
              supportsMultipleProviderThreadsPerSession: false,
            },
          })),
        ),
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const providerThread: OrchestrationV2ProviderThread = {
        id: ProviderThreadId.make(`repair:${input.threadId}`),
        driver: adapter.driver,
        providerInstanceId: adapter.instanceId,
        providerSessionId: input.providerSessionId,
        appThreadId: input.threadId,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        contextUsage: null,
        nativeMetadata: null,
        goal: null,
        createdAt: now,
        updatedAt: now,
      };
      const turns: OrchestrationV2ProviderTurn[] = [];
      let active: Fiber.Fiber<void, never> | undefined;
      const runtime: Adapter.ProviderAdapterV2SessionRuntime = {
        instanceId: adapter.instanceId,
        driver: adapter.driver,
        providerSessionId: input.providerSessionId,
        providerSession,
        events: Stream.fromQueue(events),
        ensureThread: () => Effect.succeed(providerThread),
        resumeThread: () => Effect.succeed(providerThread),
        readThreadSnapshot: () =>
          Effect.succeed({
            providerThread,
            providerTurns: turns,
            messages: [],
            runtimeRequests: [],
          }),
        steerTurn: () => Effect.fail(protocol()),
        rollbackThread: () => Effect.fail(protocol()),
        forkThread: () => Effect.fail(protocol()),
        respondToRuntimeRequest: () => Effect.fail(protocol()),
        interruptTurn: () => (active ? Fiber.interrupt(active).pipe(Effect.asVoid) : Effect.void),
        startTurn: Effect.fn("RepairTasks.startTurn")(function* (turn) {
          if (active) return yield* protocol();
          const providerTurnId = ProviderTurnId.make(`repair:${turn.attemptId}`);
          const started = yield* DateTime.now;
          const providerTurn: OrchestrationV2ProviderTurn = {
            id: providerTurnId,
            providerThreadId: providerThread.id,
            nodeId: turn.rootNodeId,
            runAttemptId: turn.attemptId,
            nativeTurnRef: null,
            ordinal: turn.providerTurnOrdinal,
            status: "running",
            startedAt: started,
            completedAt: null,
          };
          turns.push(providerTurn);
          yield* Queue.offer(events, {
            type: "provider_turn.updated",
            driver: adapter.driver,
            threadId: turn.threadId,
            providerTurn,
          });
          active = yield* Effect.gen(function* () {
            const result = yield* Effect.exit(entry.run);
            const completed = yield* DateTime.now;
            const text = Exit.isSuccess(result) ? result.value : "Repair task failed.";
            const messageId = MessageId.make(`repair:${turn.attemptId}`);
            yield* Queue.offer(events, {
              type: "message.updated",
              driver: adapter.driver,
              message: {
                id: messageId,
                threadId: turn.threadId,
                runId: turn.runId,
                nodeId: null,
                role: "assistant",
                text,
                attachments: [],
                streaming: false,
                createdBy: "agent",
                creationSource: "provider",
                createdAt: completed,
                updatedAt: completed,
              },
            });
            yield* Queue.offer(events, {
              type: "turn_item.updated",
              driver: adapter.driver,
              turnItem: {
                id: TurnItemId.make(`repair:${turn.attemptId}`),
                type: "assistant_message",
                threadId: turn.threadId,
                runId: turn.runId,
                nodeId: null,
                providerThreadId: providerThread.id,
                providerTurnId,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 1,
                status: "completed",
                title: null,
                startedAt: started,
                completedAt: completed,
                updatedAt: completed,
                messageId,
                text,
                streaming: false,
              },
            });
            const terminal: OrchestrationV2ProviderTurn = {
              ...providerTurn,
              status: Exit.isSuccess(result) ? "completed" : "failed",
              completedAt: completed,
            };
            turns[turns.length - 1] = terminal;
            yield* Queue.offer(events, {
              type: "provider_turn.updated",
              driver: adapter.driver,
              threadId: turn.threadId,
              providerTurn: terminal,
            });
            yield* Queue.offer(
              events,
              Exit.isSuccess(result)
                ? {
                    type: "turn.terminal",
                    driver: adapter.driver,
                    providerThreadId: providerThread.id,
                    providerTurnId,
                    runOrdinal: turn.runOrdinal,
                    status: "completed",
                    failure: null,
                    threadDisposition: "broken",
                  }
                : {
                    type: "turn.terminal",
                    driver: adapter.driver,
                    providerThreadId: providerThread.id,
                    providerTurnId,
                    runOrdinal: turn.runOrdinal,
                    status: "failed",
                    failureItemOrdinal: 2,
                    failure: {
                      class: "provider_error",
                      message: text,
                      code: null,
                      retryable: false,
                    },
                    threadDisposition: "broken",
                  },
            );
          }).pipe(Effect.forkIn(scope));
        }),
      };
      return runtime;
    },
    (effect, input, adapter) =>
      effect.pipe(
        Effect.mapError((cause) =>
          isAdapterError(cause)
            ? cause
            : new Adapter.ProviderAdapterOpenSessionError({
                driver: adapter.driver,
                providerSessionId: input.providerSessionId,
                cause,
              }),
        ),
      ),
  );
  return RepairTasks.of({
    register,
    reserved,
    open,
    authorized: (commandId, parentThreadId) =>
      [...entries.values()].some(
        (entry) => entry.commandId === commandId && entry.parentThreadId === parentThreadId,
      ),
  });
});

export const layer = Layer.effect(RepairTasks, make);
