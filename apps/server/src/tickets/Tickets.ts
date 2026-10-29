import {
  MessageId,
  NodeId,
  ProviderSessionId,
  ThreadId,
  Ticket,
  TicketContent,
  TicketError,
  TicketId,
  type TicketCloseInput,
  type TicketCreateInput,
  type TicketListInput,
  type TicketListResult,
  type TicketUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

export class Tickets extends Context.Service<
  Tickets,
  {
    readonly create: (input: TicketCreateInput) => Effect.Effect<Ticket, TicketError>;
    readonly update: (input: TicketUpdateInput) => Effect.Effect<Ticket, TicketError>;
    readonly close: (input: TicketCloseInput) => Effect.Effect<Ticket, TicketError>;
    readonly get: (id: TicketId) => Effect.Effect<Ticket, TicketError>;
    readonly list: (input: TicketListInput) => Effect.Effect<TicketListResult, TicketError>;
    readonly subscribe: (input: TicketListInput) => Stream.Stream<TicketListResult, TicketError>;
  }
>()("ozi/tickets/Tickets") {}

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Ticket));
const encode = Schema.encodeEffect(Schema.fromJsonString(Ticket));
const decodeContent = Schema.decodeUnknownEffect(TicketContent);
const isTicketError = Schema.is(TicketError);
const storageError = (cause: unknown) =>
  isTicketError(cause) ? cause : new TicketError({ reason: "storage", cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const changes = yield* PubSub.sliding<void>(1);

  const get = Effect.fn("Tickets.get")(function* (id: TicketId) {
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM tickets WHERE id = ${id}`;
    if (!rows[0]) return yield* new TicketError({ reason: "not_found" });
    return yield* decode(rows[0].payload_json);
  }, Effect.mapError(storageError));

  const list = Effect.fn("Tickets.list")(function* (input: TicketListInput) {
    const status = input.status ?? "open";
    const rows = yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM tickets
      WHERE (${status} = 'all' OR status = ${status})
      ${input.chatId === undefined ? sql`` : sql`AND json_extract(payload_json, '$.origin.chatId') = ${input.chatId}`}
      ${
        input.search === undefined
          ? sql``
          : sql`AND instr(lower(
        json_extract(payload_json, '$.title') || char(10) ||
        json_extract(payload_json, '$.need') || char(10) ||
        json_extract(payload_json, '$.summary') || char(10) ||
        json_extract(payload_json, '$.markdown')
      ), lower(${input.search})) > 0`
      }
      ORDER BY updated_at DESC, id ASC
    `;
    return { tickets: yield* Effect.forEach(rows, (row) => decode(row.payload_json)) };
  }, Effect.mapError(storageError));

  const readThread = Effect.fn("Tickets.readThread")(function* (threadId: ThreadId) {
    const rows = yield* sql<{
      parent_id: string | null;
      relationship: string | null;
    }>`SELECT
      json_extract(payload_json, '$.lineage.parentThreadId') AS parent_id,
      json_extract(payload_json, '$.lineage.relationshipToParent') AS relationship
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${threadId} AND deleted_at IS NULL`;
    if (!rows[0]) return yield* new TicketError({ reason: "invalid_origin" });
    return rows[0];
  });

  const messageExists = Effect.fn("Tickets.messageExists")(function* (
    threadId: ThreadId,
    messageId: MessageId,
  ) {
    const rows = yield* sql`SELECT 1 FROM orchestration_v2_projection_messages
      WHERE thread_id = ${threadId} AND message_id = ${messageId}`;
    return rows.length > 0;
  });

  const create = Effect.fn("Tickets.create")(
    function* (input: TicketCreateInput) {
      const ticket = yield* sql.withTransaction(
        Effect.gen(function* () {
          const content = yield* decodeContent(input);
          let chatId = input.threadId;

          const seen = new Set<ThreadId>();
          while (true) {
            if (seen.has(chatId)) return yield* new TicketError({ reason: "invalid_origin" });
            seen.add(chatId);
            const thread = yield* readThread(chatId);
            if (thread.relationship !== "subagent" || thread.parent_id === null) break;

            chatId = ThreadId.make(thread.parent_id);
          }
          const jobs = yield* sql<{ subagent_id: string }>`
        SELECT subagent_id FROM orchestration_v2_projection_subagents
        WHERE child_thread_id = ${input.threadId} ORDER BY updated_at DESC, subagent_id DESC LIMIT 1`;
          const sessions = yield* sql<{ provider_session_id: string }>`
        SELECT sessions.provider_session_id
        FROM orchestration_v2_projection_provider_sessions AS sessions
        INNER JOIN orchestration_v2_projection_provider_session_bindings AS bindings
          ON bindings.provider_session_id = sessions.provider_session_id
        WHERE bindings.thread_id = ${input.threadId}
          ${input.sessionId === undefined ? sql`` : sql`AND sessions.provider_session_id = ${input.sessionId}`}
        ORDER BY sessions.updated_at DESC, sessions.provider_session_id DESC LIMIT 1`;
          if (input.sessionId !== undefined && !sessions[0]) {
            return yield* new TicketError({ reason: "invalid_origin" });
          }
          const messages = yield* sql<{ message_id: string }>`
        SELECT message_id FROM orchestration_v2_projection_messages
        WHERE thread_id = ${input.threadId} ORDER BY created_at DESC, rowid DESC LIMIT 1`;
          if (
            input.messageId !== undefined &&
            !(yield* messageExists(input.threadId, input.messageId))
          ) {
            return yield* new TicketError({ reason: "invalid_origin" });
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const value: Ticket = {
            ...content,
            id: TicketId.make(yield* crypto.randomUUIDv4()),
            status: "open",
            cleared: null,
            origin: {
              threadId: input.threadId,
              chatId,
              jobId: jobs[0] ? NodeId.make(jobs[0].subagent_id) : null,
              workerId: chatId === input.threadId ? null : input.threadId,
              sessionId: sessions[0]
                ? ProviderSessionId.make(sessions[0].provider_session_id)
                : null,
              messageId:
                input.messageId ?? (messages[0] ? MessageId.make(messages[0].message_id) : null),
              transcriptPath: `/api/orchestration/threads/${encodeURIComponent(input.threadId)}/transcript`,
            },
            createdAt: now,
            updatedAt: now,
          };
          const payload = yield* encode(value);
          yield* sql`INSERT INTO tickets (id, status, updated_at, payload_json)
        VALUES (${value.id}, ${value.status}, ${now}, ${payload})`;
          return value;
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return ticket;
    },
    Effect.mapError(storageError),
    Effect.uninterruptible,
  );

  const update = Effect.fn("Tickets.update")(
    function* (input: TicketUpdateInput) {
      const ticket = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* get(input.id);
          if (current.status === "archived") return yield* new TicketError({ reason: "archived" });
          const content = yield* decodeContent({ ...current, ...input.changes });
          const value: Ticket = {
            ...current,
            ...content,
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          };
          const payload = yield* encode(value);
          yield* sql`UPDATE tickets SET updated_at = ${value.updatedAt}, payload_json = ${payload} WHERE id = ${value.id}`;
          return value;
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return ticket;
    },
    Effect.mapError(storageError),
    Effect.uninterruptible,
  );

  const close = Effect.fn("Tickets.close")(
    function* (input: TicketCloseInput) {
      const ticket = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* get(input.id);
          if (current.status === "archived") return current;
          if (input.by.type === "answered" && input.by.choiceIndex >= current.choices.length) {
            return yield* new TicketError({ reason: "invalid_clearance" });
          }
          if (
            input.by.type !== "acknowledged" &&
            !(yield* messageExists(input.by.threadId, input.by.messageId))
          ) {
            return yield* new TicketError({ reason: "invalid_clearance" });
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const value: Ticket = {
            ...current,
            status: "archived",
            updatedAt: now,
            cleared: { at: now, by: input.by },
          };
          const payload = yield* encode(value);
          yield* sql`UPDATE tickets SET status = 'archived', updated_at = ${now}, payload_json = ${payload} WHERE id = ${value.id}`;
          return value;
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return ticket;
    },
    Effect.mapError(storageError),
    Effect.uninterruptible,
  );

  const subscribe: Tickets["Service"]["subscribe"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list(input)),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list(input))),
        );
      }),
    );

  return Tickets.of({ create, update, close, get, list, subscribe });
});

export const layer = Layer.effect(Tickets, make);
