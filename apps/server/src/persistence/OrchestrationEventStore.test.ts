import {
  EventId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { PersistenceDecodeError } from "./Errors.ts";
import { toShellApplicationEvent } from "../orchestration-v2/ShellStream.ts";
import * as OrchestrationEventStore from "./OrchestrationEventStore.ts";
import * as SqlitePersistence from "./Sqlite.ts";
const isPersistenceDecodeError = Schema.is(PersistenceDecodeError);

const layerTest = OrchestrationEventStore.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const layer = it.layer(layerTest);

layer("OrchestrationEventStore", (it) => {
  it.effect("retains only shell metadata from oversized replay and live application events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* OrchestrationEventStore.OrchestrationEventStore;
        const afterSequence = yield* store.latestApplicationSequence;
        const now = yield* DateTime.now;
        const threadId = ThreadId.make("thread:large-shell-body");
        const input = "x".repeat(9 * 1024 * 1024);
        const event: OrchestrationV2DomainEvent = {
          id: EventId.make("event:large-shell-body:replay"),
          type: "turn-item.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make("tool:large-shell-body"),
            type: "command_execution",
            threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            status: "running",
            title: "Large command",
            input,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        };
        const [replayed] = yield* store.appendAgentEvents({ events: [event] });
        const pull = yield* Stream.toPull(
          store.streamProjectedApplicationEvents({
            afterSequence,
            project: toShellApplicationEvent,
          }),
        );
        assert.deepEqual(yield* pull, [{ sequence: replayed!.sequence, event: { threadId } }]);
        const [live] = yield* store.appendAgentEvents({
          events: [
            {
              ...event,
              id: EventId.make("event:large-shell-body:live"),
              payload: { ...event.payload, status: "completed", completedAt: now },
            },
          ],
        });
        yield* store.publishCommitted([live!]);
        assert.deepEqual(yield* pull, [{ sequence: live!.sequence, event: { threadId } }]);
        const durable = yield* store
          .readAgentEvents({ threadId, afterSequence })
          .pipe(Stream.runCollect);
        assert.lengthOf(durable, 2);
        for (const stored of durable) {
          assert.equal(stored.event.type, "turn-item.updated");
          if (stored.event.type !== "turn-item.updated") return;
          assert.equal(stored.event.payload.type, "command_execution");
          if (stored.event.payload.type !== "command_execution") return;
          assert.equal(stored.event.payload.input, input);
        }
      }),
    ),
  );

  it.effect("stores an unchanged subagent prompt once and replays it on every update", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore.OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const afterSequence = yield* store.latestApplicationSequence;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:subagent-prompt");
      const id = NodeId.make("node:subagent-prompt");
      const driver = ProviderDriverKind.make("claudeAgent");
      const providerInstanceId = ProviderInstanceId.make("claudeAgent");
      const prompt = "Audit the repository. ".repeat(200);
      const subagent = (index: number, progress: string, nextPrompt = prompt) =>
        ({
          id: EventId.make(`event:subagent-prompt:subagent:${index}`),
          type: "subagent.updated",
          threadId,
          occurredAt: now,
          payload: {
            id,
            threadId,
            runId: null,
            parentNodeId: NodeId.make("node:subagent-prompt-parent"),
            origin: "provider_native",
            createdBy: "agent",
            driver,
            providerInstanceId,
            providerThreadId: null,
            childThreadId: null,
            nativeTaskRef: { driver, nativeId: "subagent-prompt", strength: "strong" },
            prompt: nextPrompt,
            progress,
            title: "Audit",
            model: null,
            status: "running",
            result: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        }) satisfies OrchestrationV2DomainEvent;
      const item = (index: number, progress: string, nextPrompt = prompt) =>
        ({
          id: EventId.make(`event:subagent-prompt:item:${index}`),
          type: "turn-item.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make("item:subagent-prompt"),
            type: "subagent",
            threadId,
            runId: null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            status: "running",
            title: "Audit",
            subagentId: id,
            origin: "provider_native",
            driver,
            providerInstanceId,
            childThreadId: null,
            prompt: nextPrompt,
            progress,
            result: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        }) satisfies OrchestrationV2DomainEvent;
      const events = [
        subagent(0, "Reading files"),
        item(0, "Reading files"),
        subagent(1, "Running tests"),
        item(1, "Running tests"),
        subagent(2, "Writing report"),
        item(2, "Writing report"),
        subagent(3, "Retrying", "Audit again."),
        item(3, "Retrying", "Audit again."),
      ];
      yield* store.appendAgentEvents({ events });

      const stored = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM orchestration_events
        WHERE stream_id = ${threadId} ORDER BY sequence ASC
      `;
      assert.deepEqual(
        stored.map((row) => row.payload_json.includes(prompt)),
        [true, true, false, false, false, false, false, false],
      );
      const replayed = yield* store
        .readAgentEvents({ threadId, afterSequence })
        .pipe(Stream.runCollect);
      assert.deepEqual(
        replayed.map((entry) => entry.event),
        events,
      );
      const stats = yield* store.getAgentReplayStats({
        threadId,
        afterSequence,
        throughSequence: yield* store.latestApplicationSequence,
        maxEvents: events.length,
      });
      assert.isAbove(stats.rawPayloadBytes, prompt.length * 6);
      const applicationStats = yield* store.getReplayStats({
        afterSequence,
        throughSequence: yield* store.latestApplicationSequence,
      });
      assert.isAbove(applicationStats.rawPayloadBytes, prompt.length * 6);
    }),
  );

  it.effect("stores the full subagent prompt when its hint row was rolled back", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore.OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const afterSequence = yield* store.latestApplicationSequence;
      const now = yield* DateTime.now;
      const threadId = ThreadId.make("thread:subagent-rollback");
      const event = {
        id: EventId.make("event:subagent-rollback"),
        type: "subagent.updated",
        threadId,
        occurredAt: now,
        payload: {
          id: NodeId.make("node:subagent-rollback"),
          threadId,
          runId: null,
          parentNodeId: NodeId.make("node:subagent-rollback-parent"),
          origin: "provider_native",
          createdBy: "agent",
          driver: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
          providerThreadId: null,
          childThreadId: null,
          nativeTaskRef: null,
          prompt: "Audit the repository. ".repeat(200),
          progress: "Reading files",
          title: "Audit",
          model: null,
          status: "running",
          result: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        },
      } satisfies OrchestrationV2DomainEvent;
      const rolledBack = yield* sql
        .withTransaction(
          store
            .appendAgentEvents({ events: [event] })
            .pipe(Effect.andThen(Effect.fail("rollback"))),
        )
        .pipe(Effect.flip);
      assert.equal(rolledBack, "rollback");
      const rowsAfterRollback = yield* sql`
        SELECT sequence FROM orchestration_events WHERE stream_id = ${threadId}
      `;
      assert.deepEqual(rowsAfterRollback, []);

      const events = [event, { ...event, id: EventId.make("event:subagent-after-rollback") }];
      const appended = yield* store.appendAgentEvents({ events });
      assert.deepEqual(
        appended.map((entry) => entry.event),
        events,
      );
      const stored = yield* sql<{
        readonly prompt: string | null;
        readonly prompt_sequence: number | null;
      }>`
        SELECT json_extract(payload_json, '$.prompt') AS prompt,
          json_extract(payload_json, '$.promptSequence') AS prompt_sequence
        FROM orchestration_events WHERE stream_id = ${threadId} ORDER BY sequence
      `;
      assert.deepEqual(stored, [
        { prompt: event.payload.prompt, prompt_sequence: null },
        { prompt: "", prompt_sequence: appended[0]!.sequence },
      ]);
      const replayed = yield* store.readAgentEvents({ threadId }).pipe(Stream.runCollect);
      assert.deepEqual(replayed, appended);
      const applicationEvents = yield* store
        .readApplicationEvents({
          afterSequence,
          throughSequence: appended[1]!.sequence,
        })
        .pipe(Stream.runCollect);
      assert.deepEqual(applicationEvents, [...appended]);
    }),
  );
  it.effect("measures only a bounded thread replay before decoding its payloads", () =>
    Effect.gen(function* () {
      const store = yield* OrchestrationEventStore.OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("measured-replay-thread");
      const baseline = yield* store.latestApplicationSequence;
      const unicodePayload = '{"text":"🦊"}';
      const oversizedPayload = "{" + "x".repeat(1_048_576);
      let streamVersion = 0;
      const insert = Effect.fn(function* (input: {
        readonly id: string;
        readonly payload: string;
        readonly type?: string;
        readonly threadId?: string;
        readonly version?: number;
      }) {
        const rows = yield* sql<{ readonly sequence: number }>`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, actor_kind, payload_json, metadata_json, application_event_version
          ) VALUES (
            ${input.id}, 'thread', ${input.threadId ?? threadId},
            ${streamVersion++}, ${input.type ?? "thread.metadata-updated"},
            '2026-09-04T00:00:00.000Z', 'server', ${input.payload}, '{}', ${input.version ?? 2}
          ) RETURNING sequence
        `;
        return rows[0]!.sequence;
      });
      const first = yield* insert({
        id: "measured-replay-1",
        payload: unicodePayload,
        type: "thread.created",
      });
      yield* insert({
        id: "measured-unrelated",
        threadId: "other-replay-thread",
        payload: oversizedPayload,
      });
      yield* insert({ id: "measured-legacy", payload: oversizedPayload, version: 1 });
      const head = yield* insert({ id: "measured-replay-02", payload: oversizedPayload });
      const later = yield* insert({ id: "measured-replay-003", payload: "{}" });
      const range = { threadId, afterSequence: baseline, throughSequence: head, maxEvents: 128 };
      assert.deepEqual(yield* store.getAgentReplayStats(range), {
        eventCount: 2,
        rawPayloadBytes: Buffer.byteLength(unicodePayload) + Buffer.byteLength(oversizedPayload),
        hasCreateEvent: true,
      });
      assert.deepEqual(yield* store.getAgentReplayStats({ ...range, afterSequence: first }), {
        eventCount: 1,
        rawPayloadBytes: Buffer.byteLength(oversizedPayload),
        hasCreateEvent: false,
      });
      assert.equal(
        (yield* store.getAgentReplayStats({ ...range, throughSequence: later, maxEvents: 1 }))
          .eventCount,
        2,
      );
      assert.deepEqual(yield* store.getAgentReplayStats({ ...range, afterSequence: later }), {
        eventCount: 0,
        rawPayloadBytes: 0,
        hasCreateEvent: false,
      });
      assert.deepEqual(
        yield* store.getReplayStats({ afterSequence: baseline, throughSequence: head }),
        {
          eventCount: 3,
          rawPayloadBytes:
            Buffer.byteLength(unicodePayload) + 2 * Buffer.byteLength(oversizedPayload),
        },
      );
    }),
  );

  it.effect.each([
    ["agent", "thread"],
    ["application", "thread"],
    ["application", "project"],
  ] as const)(
    "%s replay skips unknown %s types but rejects malformed known payloads",
    ([reader, aggregateKind]) =>
      Effect.gen(function* () {
        const store = yield* OrchestrationEventStore.OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const streamId = ThreadId.make(`skip-unknown:${reader}:${aggregateKind}`);
        const now = "2026-01-05T00:00:00.000Z";
        const insertRow = Effect.fnUntraced(function* (
          version: number,
          eventType: string,
          payload: string,
        ) {
          const [row] = yield* sql<{ sequence: number }>`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, actor_kind, payload_json, metadata_json, application_event_version
          ) VALUES (
            ${`${streamId}:${version}`}, ${aggregateKind}, ${streamId}, ${version}, ${eventType},
            ${now}, 'server', ${payload}, '{}', 2
          ) RETURNING sequence
        `;
          return row!.sequence;
        });
        const read = (
          afterSequence: number,
          throughSequence: number,
          skipUnknownEventTypes = false,
          limit?: number,
        ) => {
          const input = { afterSequence, throughSequence, skipUnknownEventTypes };
          return reader === "agent"
            ? store
                .readAgentEvents({
                  ...input,
                  threadId: streamId,
                  ...(limit === undefined ? {} : { limit }),
                })
                .pipe(
                  Stream.map((event) => event.sequence),
                  Stream.runCollect,
                )
            : store.readApplicationEvents(input).pipe(
                Stream.map((event) => event.sequence),
                Stream.runCollect,
              );
        };
        const knownType =
          aggregateKind === "thread" ? "provider-session.detached" : "project.meta-updated";
        const knownPayload = JSON.stringify(
          aggregateKind === "thread"
            ? { providerSessionId: "session:known", detachedAt: now }
            : { updatedAt: now },
        );
        const baseline = yield* store.latestApplicationSequence;
        const before = yield* insertRow(0, knownType, knownPayload);
        yield* Effect.forEach(
          Array.from({ length: 1_000 }, (_, i) => i + 1),
          (version) => insertRow(version, "future.event", "not JSON"),
          { discard: true },
        );
        yield* insertRow(
          1_001,
          aggregateKind === "thread" ? "project.meta-updated" : "provider-session.detached",
          "{}",
        );
        const after = yield* insertRow(1_002, knownType, knownPayload);
        const highWater = yield* insertRow(1_003, "future.trailing", "{}");
        yield* insertRow(1_004, knownType, knownPayload);
        assert.deepEqual(yield* read(baseline, highWater, true), [before, after]);
        assert.isTrue(isPersistenceDecodeError(yield* read(baseline, highWater).pipe(Effect.flip)));
        if (reader === "agent") {
          assert.deepEqual(yield* read(baseline, highWater, true, 2), [before]);
        }
        const beforeBroken = yield* store.latestApplicationSequence;
        const broken = yield* insertRow(
          1_005,
          aggregateKind === "thread" ? "thread.metadata-updated" : "project.created",
          "{}",
        );
        assert.isTrue(
          isPersistenceDecodeError(yield* read(beforeBroken, broken, true).pipe(Effect.flip)),
        );
      }),
  );
});
