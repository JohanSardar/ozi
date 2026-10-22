import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ContextTransferId,
  EventId,
  type ModelSelection,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Scheduler from "effect/Scheduler";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";

import { LIVE_STREAM_MAX_ITEMS, LiveStreamBufferError } from "./LiveStreamBudget.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProjectionMaintenance from "./ProjectionMaintenance.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const isLiveStreamBufferError = Schema.is(LiveStreamBufferError);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const layerDatabase = SqlitePersistence.layerMemory;
const layerEventStoreProvided = EventStore.layer.pipe(Layer.provideMerge(layerDatabase));
const layerProjectionStoreProvided = ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase));
const layerStoresProvided = Layer.mergeAll(
  layerDatabase,
  layerEventStoreProvided,
  layerProjectionStoreProvided,
);
const layerEventSinkProvided = EventSink.layer.pipe(Layer.provide(layerStoresProvided));
const layerEffectOutboxProvided = EffectOutbox.layer.pipe(Layer.provide(layerDatabase));
const layerCommandReceiptStoreProvided = CommandReceiptStore.layer.pipe(
  Layer.provide(layerDatabase),
);
const layerProjectionMaintenanceProvided = ProjectionMaintenance.layer.pipe(
  Layer.provide(layerStoresProvided),
);
const layerTest = Layer.mergeAll(
  layerStoresProvided,
  layerEventSinkProvided,
  layerEffectOutboxProvided,
  layerCommandReceiptStoreProvided,
  IdAllocator.layer,
  layerProjectionMaintenanceProvided,
);

const providerInstanceId = ProviderInstanceId.make("codex");
const providerDriver = ProviderDriverKind.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: `Thread ${threadId}`,
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
  };
}

function threadCreatedEvent(input: {
  readonly id: string;
  readonly thread: OrchestrationV2AppThread;
  readonly now: DateTime.Utc;
}): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(input.id),
    type: "thread.created",
    threadId: input.thread.id,
    providerInstanceId,
    occurredAt: input.now,
    payload: input.thread,
  };
}

it.effect("rebuilds event history one bounded page at a time", () =>
  Effect.gen(function* () {
    const eventStore = yield* EventStore.EventStoreV2;
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make("thread:foundation-paged-rebuild");
    const thread = makeThread(threadId, now);
    const eventCount = 1_005;
    yield* eventStore.append({
      events: [
        threadCreatedEvent({ id: "event:paged-rebuild:0", thread, now }),
        ...Array.from({ length: eventCount - 1 }, (_, index) => ({
          id: EventId.make(`event:paged-rebuild:${index + 1}`),
          type: "thread.metadata-updated" as const,
          threadId,
          occurredAt: now,
          payload: { ...thread, title: `Rebuilt update ${index + 1}` },
        })),
      ],
    });
    let applied = 0;
    let failAfterFirstPage = false;
    const appliedAtRead: Array<number> = [];
    const layerObservedStores = Layer.mergeAll(
      Layer.succeed(EventStore.EventStoreV2, {
        ...eventStore,
        read: (input) =>
          Stream.suspend(() => {
            appliedAtRead.push(applied);
            if (failAfterFirstPage && applied >= 500) {
              return Stream.fail(
                new EventStore.EventStoreReadEventsError({ afterSequence: input?.afterSequence }),
              );
            }
            return eventStore.read(input);
          }),
      }),
      Layer.succeed(ProjectionStore.ProjectionStoreV2, {
        ...projectionStore,
        apply: (event) =>
          projectionStore.apply(event).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                applied += 1;
              }),
            ),
          ),
      }),
    );
    const rebuild = Effect.gen(function* () {
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      return yield* maintenance.rebuild;
    }).pipe(
      Effect.provide(
        Layer.fresh(ProjectionMaintenance.layer.pipe(Layer.provide(layerObservedStores))),
      ),
    );
    const rebuilt = yield* rebuild;
    assert.isTrue(rebuilt.valid);
    assert.equal(applied, eventCount);
    assert.deepEqual(appliedAtRead, [0, 500, 1_000]);
    assert.equal(
      (yield* projectionStore.getThreadProjection(threadId)).thread.title,
      "Rebuilt update 1004",
    );
    applied = 0;
    failAfterFirstPage = true;
    const failed = yield* Effect.exit(rebuild);
    assert.equal(failed._tag, "Failure");
    assert.equal(applied, 500);
    assert.equal(
      (yield* projectionStore.getThreadProjection(threadId)).thread.title,
      "Rebuilt update 1004",
    );
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    assert.isTrue((yield* maintenance.verify).valid);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("verifies thread membership using only the thread-created partial index", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      WITH RECURSIVE history(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 25000
      )
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type,
        occurred_at, actor_kind, payload_json, metadata_json, application_event_version
      )
      SELECT 'history:' || n, 'thread', 'thread:history', n,
        'provider-session.detached', ${now}, 'server', '{}', '{}', 2
      FROM history
    `;
    let membershipQuery: string | undefined;
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          const query = span.attributes.get("db.query.text");
          if (
            typeof query === "string" &&
            query.includes("SELECT DISTINCT stream_id AS thread_id")
          ) {
            membershipQuery = query;
          }
        };
        return span;
      },
    });
    yield* maintenance.verify.pipe(Effect.withTracer(tracer));
    assert.isDefined(membershipQuery);
    const plan = yield* sql.unsafe<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${membershipQuery}`,
    );
    const details = plan.map((row) => row.detail).join("\n");
    assert.match(details, /USING (?:COVERING )?INDEX orchestration_events_v2_created_threads_idx/);
    assert.notMatch(details, /idx_orch_events_stream_sequence|TEMP B-TREE/);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps other database work runnable while discovering compaction candidates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        WITH RECURSIVE history(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 2001
        )
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, actor_kind, payload_json, metadata_json, application_event_version
        )
        SELECT 'retained:' || n, 'thread', 'thread:retained', n,
          'provider-session.detached', ${now}, 'server', '{}', '{}', 2
        FROM history
      `;
      yield* sql`
        WITH RECURSIVE history(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 2001
        )
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, command_type
        )
        SELECT 'retained:' || n, 'thread', 'thread:retained', ${now}, n, 'accepted', 'thread.create'
        FROM history
      `;
      const discoveryStarted = {
        events: yield* Deferred.make<void>(),
        receipts: yield* Deferred.make<void>(),
      };
      const queries = { events: 0, receipts: 0 };
      let finished = false;
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            const query = span.attributes.get("db.query.text");
            if (typeof query !== "string" || !query.trimStart().startsWith("SELECT")) return;
            if (query.includes("MAX(")) return;
            const table = query.includes("FROM orchestration_command_receipts")
              ? "receipts"
              : query.includes("FROM orchestration_events")
                ? "events"
                : undefined;
            if (table === undefined) return;
            queries[table] += 1;
            Deferred.doneUnsafe(discoveryStarted[table], Effect.void);
          };
          return span;
        },
      });
      const probes = yield* Effect.forEach(["events", "receipts"] as const, (table) =>
        Effect.gen(function* () {
          yield* Deferred.await(discoveryStarted[table]);
          const result = yield* sql<{ readonly responsive: number }>`SELECT 1 AS responsive`;
          assert.equal(result[0]?.responsive, 1);
          return { table, queriesAtProbe: queries[table], finished };
        }).pipe(Effect.forkScoped),
      );

      const summary = yield* maintenance.compactEventStore.pipe(
        Effect.withTracer(tracer),
        Effect.provideService(Scheduler.MaxOpsBeforeYield, Number.POSITIVE_INFINITY),
        Effect.tap(() =>
          Effect.sync(() => {
            finished = true;
          }),
        ),
      );
      assert.equal(summary.deletedEventCount, 0);
      assert.equal(summary.deletedReceiptCount, 0);
      for (const probe of probes) {
        const result = yield* Fiber.join(probe);
        assert.isFalse(result.finished);
        assert.isAtLeast(result.queriesAtProbe, 1);
        assert.isBelow(result.queriesAtProbe, queries[result.table]);
      }
    }),
  ).pipe(Effect.provide(layerTest)),
);

it.layer(layerTest)("orchestration V2 foundation persistence", (it) => {
  it.effect("projects oversized tool bodies before both replay and live RPC retention", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sink = yield* EventSink.EventSinkV2;
        const store = yield* EventStore.EventStoreV2;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const now = yield* DateTime.now;
        const thread = makeThread(ThreadId.make("thread:large-stream-body"), now);
        const output = {
          content: [{ type: "text", text: "first line\n" + "x".repeat(9 * 1024 * 1024) }],
        };
        const tool: OrchestrationV2TurnItem = {
          id: TurnItemId.make("tool:large-stream-body"),
          type: "dynamic_tool",
          threadId: thread.id,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "running",
          title: "Large tool",
          toolName: "mcp__large_tool",
          input: { query: "details" },
          output,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        };
        const [created] = yield* sink.write({
          events: [
            threadCreatedEvent({ id: "event:large-stream-body:created", thread, now }),
            {
              id: EventId.make("event:large-stream-body:replay"),
              type: "turn-item.updated",
              threadId: thread.id,
              occurredAt: now,
              payload: tool,
            },
          ],
        });
        const pull = yield* Stream.toPull(
          sink.stream({
            threadId: thread.id,
            afterSequence: created!.sequence,
            bounded: true,
          }),
        );
        const replay = yield* pull;
        assert.lengthOf(replay, 1);
        assert.equal(replay[0]!.event.type, "turn-item.updated");
        assert.isBelow(Buffer.byteLength(yield* encodeJson(replay)), 4_000);
        const [completed] = yield* sink.write({
          events: [
            {
              id: EventId.make("event:large-stream-body:live"),
              type: "turn-item.updated",
              threadId: thread.id,
              occurredAt: now,
              payload: { ...tool, status: "completed", completedAt: now },
            },
          ],
        });
        const live = yield* pull;
        assert.deepEqual(
          live.map((stored) => stored.sequence),
          [completed!.sequence],
        );
        assert.isBelow(Buffer.byteLength(yield* encodeJson(live)), 4_000);
        for (const stored of [...replay, ...live]) {
          assert.equal(stored.event.type, "turn-item.updated");
          if (stored.event.type !== "turn-item.updated") return;
          assert.equal(stored.event.payload.type, "dynamic_tool");
          if (stored.event.payload.type !== "dynamic_tool") return;
          assert.notProperty(stored.event.payload, "output");
        }
        const persisted = yield* store.read({ threadId: thread.id }).pipe(Stream.runCollect);
        const fullEvent = persisted.find(
          (stored) => stored.sequence === completed!.sequence,
        )!.event;
        assert.equal(fullEvent.type, "turn-item.updated");
        if (fullEvent.type !== "turn-item.updated") return;
        assert.equal(fullEvent.payload.type, "dynamic_tool");
        if (fullEvent.payload.type !== "dynamic_tool") return;
        assert.deepEqual(fullEvent.payload.output, output);
        const detail = (yield* projections.getThreadProjection(thread.id)).turnItems.find(
          (item) => item.id === tool.id,
        )!;
        assert.equal(detail.type, "dynamic_tool");
        if (detail.type === "dynamic_tool") assert.deepEqual(detail.output, output);
      }),
    ),
  );

  it.effect("traces an event write and its transaction without its SQL statements", () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const thread = makeThread(ThreadId.make("thread:untraced-write-statements"), now);
      const names: Array<string> = [];
      const tracer = Tracer.make({
        span: (options) => {
          names.push(options.name);
          return new Tracer.NativeSpan(options);
        },
      });

      yield* sink
        .write({
          events: [
            threadCreatedEvent({ id: "event:untraced-write-statements:created", thread, now }),
          ],
        })
        .pipe(Effect.withTracer(tracer));

      assert.deepEqual(names, ["orchestrationV2.EventSink.write", "sql.transaction"]);
    }),
  );

  it.effect.each(["high-water", "replay"] as const)(
    "bounds live events while the V2 %s query is blocked",
    (phase) =>
      Effect.scoped(
        Effect.gen(function* () {
          const sink = yield* EventSink.EventSinkV2;
          const now = yield* DateTime.now;
          const thread = makeThread(ThreadId.make(`thread:blocked-${phase}`), now);
          const [created] = yield* sink.write({
            events: [threadCreatedEvent({ id: `event:blocked-${phase}:created`, thread, now })],
          });
          const readStarted = yield* Deferred.make<void>();
          const readClosed = yield* Deferred.make<void>();
          const blockRead: Statement.Transformer = (statement) => {
            const [query] = statement.compile();
            if (
              query.includes("FROM orchestration_events") &&
              query.includes("MAX(sequence)") === (phase === "high-water")
            ) {
              return Deferred.succeed(readStarted, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(readClosed, undefined)),
                Effect.as(statement),
              );
            }
            return Effect.succeed(statement);
          };
          const reader = yield* sink
            .stream({ threadId: thread.id, afterSequence: created!.sequence, bounded: true })
            .pipe(
              Stream.provideService(Statement.CurrentTransformer, blockRead),
              Stream.runDrain,
              Effect.result,
              Effect.forkScoped,
            );
          yield* Deferred.await(readStarted);
          yield* sink.write({
            events: Array.from({ length: LIVE_STREAM_MAX_ITEMS + 1 }, (_, index) => ({
              id: EventId.make(`event:blocked-${phase}:${index}`),
              type: "thread.metadata-updated" as const,
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, title: `Updated ${index}` },
            })),
          });
          yield* Deferred.await(readClosed);
          const result = yield* Fiber.join(reader);
          assert.equal(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.equal(result.failure._tag, "EventSinkStreamError");
            assert.isTrue(isLiveStreamBufferError(result.failure.cause));
          }
        }),
      ),
  );

  it.effect(
    "keeps internal streams subscribed while replay is blocked beyond the RPC buffer cap",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const sink = yield* EventSink.EventSinkV2;
          const now = yield* DateTime.now;
          const thread = makeThread(ThreadId.make("thread:internal-stream-burst"), now);
          const [created] = yield* sink.write({
            events: [
              threadCreatedEvent({ id: "event:internal-stream-burst:created", thread, now }),
            ],
          });
          const readStarted = yield* Deferred.make<void>();
          const releaseRead = yield* Deferred.make<void>();
          const blockHighWater: Statement.Transformer = (statement) => {
            const [query] = statement.compile();
            return query.includes("MAX(sequence)") && query.includes("FROM orchestration_events")
              ? Deferred.succeed(readStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseRead)),
                  Effect.as(statement),
                )
              : Effect.succeed(statement);
          };
          const eventCount = LIVE_STREAM_MAX_ITEMS + 1;
          const reader = yield* sink
            .stream({ threadId: thread.id, afterSequence: created!.sequence })
            .pipe(
              Stream.provideService(Statement.CurrentTransformer, blockHighWater),
              Stream.take(eventCount),
              Stream.runCollect,
              Effect.forkScoped,
            );
          yield* Deferred.await(readStarted);
          const written = yield* sink.write({
            events: Array.from({ length: eventCount }, (_, index) => ({
              id: EventId.make(`event:internal-stream-burst:${index}`),
              type: "thread.metadata-updated" as const,
              threadId: thread.id,
              occurredAt: now,
              payload: { ...thread, title: `Updated ${index}` },
            })),
          });
          yield* Deferred.succeed(releaseRead, undefined);
          assert.deepEqual(
            (yield* Fiber.join(reader)).map((event) => event.sequence),
            written.map((event) => event.sequence),
          );
        }),
      ),
  );

  it.effect("paginates catch-up beyond the event-store read limit", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-large-catch-up");
      const thread = makeThread(threadId, now);
      const eventCount = 1_005;
      const events: Array<OrchestrationV2DomainEvent> = [
        threadCreatedEvent({ id: "event:foundation-catch-up:0", thread, now }),
        ...Array.from({ length: eventCount - 1 }, (_, index) => ({
          id: EventId.make(`event:foundation-catch-up:${index + 1}`),
          type: "thread.metadata-updated" as const,
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: {
            ...thread,
            title: `Catch-up update ${index + 1}`,
          },
        })),
      ];

      yield* eventSink.write({ events });
      const replayed = yield* eventSink.stream({ afterSequence: 0 }).pipe(
        Stream.take(eventCount),
        Stream.runCollect,
        Effect.map((events) => Array.from(events)),
      );

      assert.lengthOf(replayed, eventCount);
      assert.deepEqual(
        replayed.map((stored) => stored.sequence),
        Array.from({ length: eventCount }, (_, index) => index + 1),
      );
    }),
  );

  it.effect("does not lose or duplicate events while transitioning from catch-up to live", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:foundation-stream-race");
      const thread = makeThread(threadId, now);
      const created = yield* eventSink.write({
        events: [threadCreatedEvent({ id: "event:foundation-stream-race:0", thread, now })],
      });

      let afterSequence = created[0]!.sequence;
      for (let index = 1; index <= 32; index += 1) {
        const nextEvent = {
          id: EventId.make(`event:foundation-stream-race:${index}`),
          type: "thread.metadata-updated" as const,
          threadId,
          providerInstanceId,
          occurredAt: now,
          payload: { ...thread, title: `Race update ${index}` },
        } satisfies OrchestrationV2DomainEvent;
        const reader = yield* eventSink
          .stream({ threadId, afterSequence })
          .pipe(Stream.runHead, Effect.forkChild);
        yield* Effect.yieldNow;
        const written = yield* eventSink.write({ events: [nextEvent] });
        const received = yield* Fiber.join(reader);
        if (Option.isNone(received)) {
          return yield* Effect.die("The event stream ended before delivering the live event.");
        }
        assert.equal(received.value.sequence, written[0]?.sequence);
        assert.equal(received.value.event.id, nextEvent.id);
        afterSequence = received.value.sequence;
      }
    }),
  );

  it.effect("replays shared provider-session payloads across every bound thread", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const now = yield* DateTime.now;
      const firstThreadId = ThreadId.make("thread:foundation-shared-session:first");
      const secondThreadId = ThreadId.make("thread:foundation-shared-session:second");
      const providerSessionId = ProviderSessionId.make("provider-session:foundation:shared");
      const firstSession = {
        id: providerSessionId,
        driver: providerDriver,
        providerInstanceId,
        status: "ready" as const,
        cwd: "/workspace/first",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      const secondSession = { ...firstSession, cwd: "/workspace/second" };

      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-shared-session:first-thread",
            thread: makeThread(firstThreadId, now),
            now,
          }),
          {
            id: EventId.make("event:foundation-shared-session:first-attachment"),
            type: "provider-session.attached",
            threadId: firstThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: firstSession,
          },
          threadCreatedEvent({
            id: "event:foundation-shared-session:second-thread",
            thread: makeThread(secondThreadId, now),
            now,
          }),
          {
            id: EventId.make("event:foundation-shared-session:second-attachment"),
            type: "provider-session.attached",
            threadId: secondThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: secondSession,
          },
        ],
      });

      assert.equal(
        (yield* projectionStore.getThreadProjection(firstThreadId)).providerSessions[0]?.cwd,
        secondSession.cwd,
      );
      assert.isTrue((yield* maintenance.verify).valid);
      assert.isTrue((yield* maintenance.rebuild).valid);
    }),
  );

  it.effect("verifies and rebuilds projections with cross-thread subagent relations", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const parentThreadId = ThreadId.make("thread:foundation-cross-thread:parent");
      const childThreadId = ThreadId.make("thread:foundation-cross-thread:child");
      const childProviderThreadId = ProviderThreadId.make(
        "provider-thread:foundation-cross-thread:child",
      );
      const subagentId = NodeId.make("subagent:foundation-cross-thread");
      const spawnTransferId = ContextTransferId.make("transfer:foundation-cross-thread:spawn");
      const resultTransferId = ContextTransferId.make("transfer:foundation-cross-thread:result");
      const parentThread = makeThread(parentThreadId, now);
      const childThread = {
        ...makeThread(childThreadId, now),
        createdBy: "agent" as const,
        creationSource: "provider" as const,
        lineage: {
          parentThreadId,
          relationshipToParent: "subagent" as const,
          rootThreadId: parentThreadId,
        },
      };

      yield* eventSink.write({
        events: [
          threadCreatedEvent({
            id: "event:foundation-cross-thread:parent",
            thread: parentThread,
            now,
          }),
          threadCreatedEvent({
            id: "event:foundation-cross-thread:child",
            thread: childThread,
            now,
          }),
          {
            id: EventId.make("event:foundation-cross-thread:subagent"),
            type: "subagent.updated",
            threadId: parentThreadId,
            nodeId: subagentId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: subagentId,
              threadId: parentThreadId,
              runId: null,
              parentNodeId: NodeId.make("node:foundation-cross-thread:parent"),
              origin: "app_owned",
              createdBy: "agent",
              driver: providerDriver,
              providerInstanceId,
              providerThreadId: childProviderThreadId,
              childThreadId,
              nativeTaskRef: null,
              prompt: "Inspect the child flow",
              title: "Cross-thread child",
              model: modelSelection.model,
              status: "completed",
              result: "done",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:spawn-transfer"),
            type: "context-transfer.created",
            threadId: childThreadId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: spawnTransferId,
              type: "subagent_spawn",
              sourceThreadId: parentThreadId,
              targetThreadId: childThreadId,
              sourcePoint: { threadId: parentThreadId },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "consumed",
              resolution: null,
              createdBy: "agent",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:provider-thread"),
            type: "provider-thread.updated",
            threadId: parentThreadId,
            driver: providerDriver,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: childProviderThreadId,
              driver: providerDriver,
              providerInstanceId,
              providerSessionId: null,
              appThreadId: childThreadId,
              ownerNodeId: null,
              nativeThreadRef: null,
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: 1,
              lastRunOrdinal: 1,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          {
            id: EventId.make("event:foundation-cross-thread:result-transfer"),
            type: "context-transfer.created",
            threadId: parentThreadId,
            providerInstanceId,
            occurredAt: now,
            payload: {
              id: resultTransferId,
              type: "subagent_result",
              sourceThreadId: childThreadId,
              targetThreadId: parentThreadId,
              sourcePoint: { threadId: childThreadId },
              basePoint: null,
              sourceProviderInstanceId: providerInstanceId,
              targetProviderInstanceId: providerInstanceId,
              targetRunId: null,
              status: "consumed",
              resolution: null,
              createdBy: "system",
              error: null,
              createdAt: now,
              updatedAt: now,
              consumedAt: now,
            },
          },
        ],
      });

      const assertCrossThreadProjection = Effect.gen(function* () {
        const parent = yield* projectionStore.getThreadProjection(parentThreadId);
        const child = yield* projectionStore.getThreadProjection(childThreadId);
        const expectedTransferIds = [spawnTransferId, resultTransferId].toSorted();
        assert.deepEqual(
          parent.contextTransfers.map((transfer) => transfer.id).toSorted(),
          expectedTransferIds,
        );
        assert.deepEqual(
          child.contextTransfers.map((transfer) => transfer.id).toSorted(),
          expectedTransferIds,
        );
        assert.deepEqual(
          parent.providerThreads.map((providerThread) => providerThread.id),
          [childProviderThreadId],
        );
        assert.equal(child.thread.activeProviderThreadId, childProviderThreadId);
      });

      yield* assertCrossThreadProjection;
      assert.isTrue((yield* maintenance.verify).valid);
      yield* sql`
        UPDATE orchestration_v2_projection_provider_threads SET payload_json = '{}'
        WHERE provider_thread_id = ${childProviderThreadId}
      `;
      assert.deepEqual(
        new Set((yield* maintenance.verify).unreadableThreadIds),
        new Set([parentThreadId, childThreadId]),
      );
      assert.isTrue((yield* maintenance.rebuild).valid);
      yield* assertCrossThreadProjection;
    }),
  );

  it.effect("replays every command event across bounded persistence pages", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const eventStore = yield* EventStore.EventStoreV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const now = yield* DateTime.now;
      const occurredAt = DateTime.formatIso(now);
      const commandId = CommandId.make("command:paged-command-replay");
      const exactPageCommandId = CommandId.make("command:paged-command-replay:exact");
      const emptyCommandId = CommandId.make("command:paged-command-replay:empty");
      const threadId = "thread:paged-command-replay";

      const eventRow = (
        ordinal: number,
        input: {
          readonly commandId?: string | null;
          readonly aggregateKind?: "project" | "thread";
          readonly streamId?: string;
          readonly version?: number;
        } = {},
      ) => ({
        event_id: `event:paged-command-replay:${ordinal}`,
        aggregate_kind: input.aggregateKind ?? "thread",
        stream_id: input.streamId ?? threadId,
        stream_version: ordinal,
        event_type: "provider-session.detached",
        occurred_at: occurredAt,
        command_id: input.commandId ?? null,
        causation_event_id: null,
        correlation_id: null,
        actor_kind: "server",
        payload_json: JSON.stringify({
          providerSessionId: `session:paged-command-replay:${ordinal}`,
          detachedAt: occurredAt,
        }),
        metadata_json: "{}",
        application_event_version: input.version ?? 2,
      });

      const matchingCount = 1_001;
      const rows: Array<ReturnType<typeof eventRow>> = [];
      let ordinal = 0;
      for (let index = 0; index < matchingCount; index += 1) {
        rows.push(eventRow(++ordinal, { commandId }));
        if (index % 2 === 0) {
          rows.push(eventRow(++ordinal, { commandId: "command:unrelated" }));
        }
        if (index % 5 === 0) {
          rows.push(eventRow(++ordinal));
          rows.push(eventRow(++ordinal, { commandId, version: 1 }));
          rows.push(
            eventRow(++ordinal, {
              commandId,
              aggregateKind: "project",
              streamId: `project:paged-command-replay:${index}`,
            }),
          );
        }
      }
      for (let index = 0; index < 500; index += 1) {
        rows.push(eventRow(++ordinal, { commandId: exactPageCommandId }));
      }
      const inserted = yield* Effect.forEach(
        Array.from({ length: Math.ceil(rows.length / 400) }, (_, chunk) =>
          rows.slice(chunk * 400, (chunk + 1) * 400),
        ),
        (chunk) =>
          sql<{
            readonly sequence: number;
            readonly command_id: string | null;
            readonly aggregate_kind: string;
            readonly application_event_version: number;
          }>`
            INSERT INTO orchestration_events ${sql.insert(chunk)}
            RETURNING sequence, command_id, aggregate_kind, application_event_version
          `,
        { concurrency: 1 },
      ).pipe(Effect.map((chunks) => chunks.flat()));
      const expectedSequences = inserted
        .filter(
          (row) =>
            row.command_id === commandId &&
            row.aggregate_kind === "thread" &&
            row.application_event_version === 2,
        )
        .map((row) => row.sequence);
      assert.lengthOf(expectedSequences, matchingCount);

      yield* sql`
        INSERT INTO orchestration_command_receipts (
          command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, command_type
        )
        VALUES (
          ${commandId}, 'thread', ${threadId}, ${occurredAt},
          ${expectedSequences.at(-1)!}, 'accepted', 'thread.create'
        )
      `;

      const pageLimits: Array<number> = [];
      const recordReads: Statement.Transformer = (statement) => {
        const [query, params] = statement.compile();
        if (query.includes("FROM orchestration_events") && query.includes("command_id")) {
          const limit = params.at(-1);
          if (typeof limit === "number") {
            pageLimits.push(limit);
          }
        }
        return Effect.succeed(statement);
      };
      const collectByCommandId = (id: CommandId) =>
        eventStore.readByCommandId({ commandId: id }).pipe(
          Stream.provideService(Statement.CurrentTransformer, recordReads),
          Stream.runCollect,
          Effect.map((events) => Array.from(events)),
        );

      const replayed = yield* collectByCommandId(commandId);
      assert.deepEqual(
        replayed.map((stored) => stored.sequence),
        expectedSequences,
      );
      assert.deepEqual(pageLimits, [500, 500, 500]);

      pageLimits.length = 0;
      const exactPage = yield* collectByCommandId(exactPageCommandId);
      assert.lengthOf(exactPage, 500);
      assert.deepEqual(pageLimits, [500, 500]);

      pageLimits.length = 0;
      const empty = yield* collectByCommandId(emptyCommandId);
      assert.lengthOf(empty, 0);
      assert.deepEqual(pageLimits, [500]);

      pageLimits.length = 0;
      const retried = yield* eventSink
        .commitCommand({
          commandId,
          threadId: ThreadId.make(threadId),
          commandType: "thread.create",
          acceptedAt: now,
          events: [
            threadCreatedEvent({
              id: "event:paged-command-replay:retry",
              thread: makeThread(ThreadId.make(threadId), now),
              now,
            }),
          ],
          effects: [],
        })
        .pipe(Effect.provideService(Statement.CurrentTransformer, recordReads));
      assert.isFalse(retried.committed);
      assert.equal(retried.receipt.resultSequence, expectedSequences.at(-1));
      assert.deepEqual(
        retried.storedEvents.map((stored) => stored.sequence),
        expectedSequences,
      );
      assert.deepEqual(pageLimits, [500, 500, 500]);
    }),
  );

  it.effect("keeps one durable effect across command retries and executes it after recovery", () =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const now = yield* DateTime.now;
      const commandId = CommandId.make("command:foundation-effect-recovery");
      const threadId = ThreadId.make("thread:foundation-effect-recovery");
      const thread = makeThread(threadId, now);
      const event = threadCreatedEvent({
        id: "event:foundation-effect-recovery",
        thread,
        now,
      });
      const effect = {
        id: "effect:foundation-effect-recovery",
        commandId,
        threadId,
        request: {
          type: "provider-turn.start" as const,
          runId: RunId.make("run:foundation-effect-recovery"),
        },
      };

      const first = yield* eventSink.commitCommand({
        commandId,
        threadId,
        commandType: "foundation.effect-recovery",
        acceptedAt: now,
        events: [event],
        effects: [effect],
      });
      const retry = yield* eventSink.commitCommand({
        commandId,
        threadId,
        commandType: "foundation.effect-recovery",
        acceptedAt: now,
        events: [event],
        effects: [effect],
      });

      assert.isTrue(first.committed);
      assert.isFalse(retry.committed);
      assert.equal(retry.receipt.resultSequence, first.receipt.resultSequence);
      assert.lengthOf(retry.storedEvents, 1);
      assert.lengthOf(yield* outbox.listByCommandId(commandId), 1);

      const executionCount = yield* Ref.make(0);
      const layerExecutor = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () => Ref.update(executionCount, (count) => count + 1),
        }),
      );
      const layerWorker = EffectWorker.layerWithOptions({ workerId: "recovery-worker" }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), layerExecutor),
        ),
      );
      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        assert.isTrue(yield* worker.runOnce);
        assert.isFalse(yield* worker.runOnce);
      }).pipe(Effect.provide(layerWorker));

      assert.equal(yield* Ref.get(executionCount), 1);
      const storedEffect = yield* outbox.get(effect.id);
      assert.isTrue(Option.isSome(storedEffect));
      if (Option.isSome(storedEffect)) {
        assert.equal(storedEffect.value.status, "succeeded");
      }
    }),
  );

  it.effect("interrupts a running process-bound effect when it is cancelled", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-cancel-running-effect");
      const threadId = ThreadId.make("thread:foundation-cancel-running-effect");
      const effectId = "effect:foundation-cancel-running-effect";
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      yield* outbox.enqueue([
        {
          id: effectId,
          commandId,
          threadId,
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-cancel-running-effect"),
          },
        },
      ]);

      const layerExecutor = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.ignore),
              ),
            ),
        }),
      );
      const layerWorker = EffectWorker.layerWithOptions({
        workerId: "cancellation-worker",
      }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), layerExecutor),
        ),
      );

      yield* Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const workerFiber = yield* worker.runOnce.pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const cancelledEffectIds = yield* outbox.cancelUnsettled({
          threadId,
          effectTypes: ["provider-turn.start"],
          reason: "The owning run was interrupted.",
        });
        assert.deepEqual(cancelledEffectIds, [effectId]);
        yield* outbox.signalCancellations(cancelledEffectIds);
        assert.isTrue(yield* Fiber.join(workerFiber));
        yield* Deferred.await(interrupted);
      }).pipe(Effect.provide(layerWorker));

      const cancelled = yield* outbox.get(effectId);
      assert.isTrue(Option.isSome(cancelled));
      if (Option.isSome(cancelled)) assert.equal(cancelled.value.status, "cancelled");
    }),
  );

  it.effect("allows only one worker to claim an available effect", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-exclusive-claim");
      yield* outbox.enqueue([
        {
          id: "effect:foundation-exclusive-claim",
          commandId,
          threadId: ThreadId.make("thread:foundation-exclusive-claim"),
          request: {
            type: "provider-turn.start",
            runId: RunId.make("run:foundation-exclusive-claim"),
          },
        },
      ]);

      const claims = yield* Effect.all(
        [
          outbox.claimNext({ workerId: "worker-a", leaseDurationMs: 30_000 }),
          outbox.claimNext({ workerId: "worker-b", leaseDurationMs: 30_000 }),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(claims.filter(Option.isSome).length, 1);
      assert.equal(claims.filter(Option.isNone).length, 1);
      const claimedByA = claims[0];
      const claimedByB = claims[1];
      if (Option.isSome(claimedByA)) {
        yield* outbox.succeed({ effectId: claimedByA.value.id, workerId: "worker-a" });
      }
      if (Option.isSome(claimedByB)) {
        yield* outbox.succeed({ effectId: claimedByB.value.id, workerId: "worker-b" });
      }
    }),
  );

  it.effect("wakes a settle waiter when its effect finishes", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const effectId = "effect:foundation-await-settled";
      yield* outbox.enqueue([
        {
          id: effectId,
          commandId: CommandId.make("command:foundation-await-settled"),
          threadId: ThreadId.make("thread:foundation-await-settled"),
          request: {
            type: "provider-runtime.continue",
            sourceRunId: RunId.make("run:foundation-await-settled"),
          },
        },
      ]);
      const waiter = yield* outbox.awaitSettled(effectId).pipe(Effect.forkChild);
      const claimed = yield* outbox.claimNext({
        workerId: "settle-worker",
        leaseDurationMs: 30_000,
      });
      assert.isTrue(Option.isSome(claimed));
      yield* Effect.yieldNow;
      assert.isUndefined(waiter.pollUnsafe());

      yield* outbox.succeed({ effectId, workerId: "settle-worker" });
      yield* Fiber.join(waiter);
      yield* outbox.awaitSettled(effectId);
    }),
  );

  it.effect("does not emit a SQL span for an empty safety claim", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const statements: Array<unknown> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            const query = span.attributes.get("db.query.text");
            if (query !== undefined) statements.push(query);
          };
          return span;
        },
      });

      const claim = yield* outbox
        .claimNext({ workerId: "idle-safety-worker", leaseDurationMs: 30_000 })
        .pipe(Effect.withTracer(tracer));

      assert.isTrue(Option.isNone(claim));
      assert.deepEqual(statements, []);
    }).pipe(Effect.provide(Layer.fresh(layerEffectOutboxProvided))),
  );

  it.effect("runs distinct threads concurrently while serializing effects within a thread", () =>
    Effect.gen(function* () {
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const commandId = CommandId.make("command:foundation-concurrent-effects");
      const threadA = ThreadId.make("thread:foundation-concurrent-effects:a");
      const threadB = ThreadId.make("thread:foundation-concurrent-effects:b");
      const effectA1 = "effect:foundation-concurrent-effects:a1";
      const effectA2 = "effect:foundation-concurrent-effects:a2";
      const effectB1 = "effect:foundation-concurrent-effects:b1";
      const startedA1 = yield* Deferred.make<void>();
      const startedA2 = yield* Deferred.make<void>();
      const startedB1 = yield* Deferred.make<void>();
      const releaseA1 = yield* Deferred.make<void>();
      const releaseA2 = yield* Deferred.make<void>();
      const releaseB1 = yield* Deferred.make<void>();
      const gates = new Map([
        [effectA1, { started: startedA1, release: releaseA1 }],
        [effectA2, { started: startedA2, release: releaseA2 }],
        [effectB1, { started: startedB1, release: releaseB1 }],
      ]);
      const layerExecutor = Layer.succeed(
        EffectWorker.OrchestrationEffectExecutorV2,
        EffectWorker.OrchestrationEffectExecutorV2.of({
          execute: (effect) => {
            const gate = gates.get(effect.id);
            if (gate === undefined) return Effect.die(`Missing gate for ${effect.id}`);
            return Deferred.succeed(gate.started, undefined).pipe(
              Effect.andThen(Deferred.await(gate.release)),
            );
          },
        }),
      );
      const layerWorker = EffectWorker.layerWithOptions({
        workerId: "concurrency-worker",
      }).pipe(
        Layer.provide(
          Layer.merge(Layer.succeed(EffectOutbox.EffectOutboxV2, outbox), layerExecutor),
        ),
      );

      yield* Effect.gen(function* () {
        yield* EffectWorker.runDaemonWithOptions({ concurrency: 2 }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* outbox.enqueue([
          {
            id: effectA1,
            commandId,
            threadId: threadA,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:a1"),
            },
          },
          {
            id: effectA2,
            commandId,
            threadId: threadA,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:a2"),
            },
          },
          {
            id: effectB1,
            commandId,
            threadId: threadB,
            request: {
              type: "provider-turn.start",
              runId: RunId.make("run:foundation-concurrent-effects:b1"),
            },
          },
        ]);
        yield* outbox.notifyAvailable(3);

        yield* Effect.all([Deferred.await(startedA1), Deferred.await(startedB1)]);
        assert.isFalse(yield* Deferred.isDone(startedA2));

        yield* Deferred.succeed(releaseA1, undefined);
        yield* Deferred.succeed(releaseB1, undefined);
        yield* Deferred.await(startedA2);
        yield* Deferred.succeed(releaseA2, undefined);
        let settled = false;
        while (!settled) {
          settled = (yield* outbox.listByCommandId(commandId)).every(
            (effect) => effect.status === "succeeded",
          );
          if (!settled) yield* Effect.yieldNow;
        }
      }).pipe(Effect.provide(layerWorker), Effect.scoped);
    }),
  );
});

it.effect.each(["events", "receipts"] as const)(
  "allows writes while compaction waits for the reader to discover obsolete %s",
  (kind) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "compaction-reader-" });
      const database = SqlitePersistence.layerFromPath(path.join(directory, "statev2.sqlite"));
      const maintenanceLayer = ProjectionMaintenance.layer.pipe(
        Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
        Layer.provideMerge(database),
      );
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        const now = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          INSERT INTO orchestration_v2_legacy_imports (
            thread_id, source_updated_at, shell_imported_at, transcript_imported_at,
            imported_message_count, last_error
          ) VALUES ('imported', ${now}, ${now}, ${now}, 1, NULL)
        `;
        for (const threadId of ["imported", "pending"]) {
          if (kind === "events") {
            yield* sql`
              INSERT INTO orchestration_events (
                event_id, aggregate_kind, stream_id, stream_version, event_type,
                occurred_at, actor_kind, payload_json, metadata_json, application_event_version
              ) VALUES (
                ${threadId}, 'thread', ${threadId}, 1, 'thread.message-appended',
                ${now}, 'user', '{}', '{}', 1
              )
            `;
          } else {
            yield* sql`
              INSERT INTO orchestration_command_receipts (
                command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence,
                status, command_type
              ) VALUES (${threadId}, 'thread', ${threadId}, ${now}, 1, 'accepted', 'legacy')
            `;
          }
        }
        yield* sql`CREATE TABLE concurrent_writes (value TEXT)`;
        const readerHeld = yield* Deferred.make<void>();
        const releaseReader = yield* Deferred.make<void>();
        const reader = yield* sql
          .withTransaction(
            Deferred.succeed(readerHeld, undefined).pipe(
              Effect.andThen(Deferred.await(releaseReader)),
            ),
          )
          .pipe(NodeSqliteClient.readOnly, Effect.forkChild);
        yield* Deferred.await(readerHeld);
        const discoveryStarted = yield* Deferred.make<Tracer.Span>();
        const observeDiscovery: Statement.Transformer = (statement, _sql, _fiber, span) => {
          const [query] = statement.compile();
          const pageQuery =
            kind === "events" ? /^\s*SELECT\s+event\.sequence/ : /^\s*SELECT\s+receipt\.rowid/;
          return pageQuery.test(query)
            ? Deferred.succeed(discoveryStarted, span).pipe(Effect.as(statement))
            : Effect.succeed(statement);
        };
        const compacted = yield* Deferred.make<void>();
        const compaction = yield* maintenance.compactEventStore.pipe(
          Effect.provideService(Statement.CurrentTransformer, observeDiscovery),
          Effect.provideService(Statement.SpanPropagationEnabled, true),
          Effect.tap(() => Deferred.succeed(compacted, undefined)),
          Effect.forkChild,
        );
        const discoverySpan = yield* Deferred.await(discoveryStarted);
        yield* sql`INSERT INTO concurrent_writes VALUES ('committed')`;
        assert.isFalse(yield* Deferred.isDone(compacted));
        assert.deepEqual(yield* sql`SELECT value FROM concurrent_writes`, [{ value: "committed" }]);
        yield* Deferred.succeed(releaseReader, undefined);
        yield* Fiber.join(reader);
        const result = yield* Fiber.join(compaction);
        assert.equal(discoverySpan.attributes.get("db.connection"), "reader");
        assert.equal(result.deletedEventCount, kind === "events" ? 1 : 0);
        assert.equal(result.deletedReceiptCount, kind === "receipts" ? 1 : 0);
        const retained =
          kind === "events"
            ? yield* sql`SELECT stream_id AS id FROM orchestration_events`
            : yield* sql`SELECT aggregate_id AS id FROM orchestration_command_receipts`;
        assert.deepEqual(retained, [{ id: "pending" }]);
      }).pipe(Effect.provide(maintenanceLayer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
