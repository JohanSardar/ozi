import * as NodeCrypto from "node:crypto";
import {
  CalendarError,
  CalendarEvent,
  CalendarEventInput,
  calendarDate,
  calendarEnd,
  calendarKey,
  type CalendarListInput,
  type CalendarListResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Tickets from "../tickets/Tickets.ts";

export class Calendar extends Context.Service<
  Calendar,
  {
    readonly list: (input: CalendarListInput) => Effect.Effect<CalendarListResult, CalendarError>;
    readonly add: (input: CalendarEventInput) => Effect.Effect<CalendarEvent, CalendarError>;
  }
>()("ozi/calendar/Calendar") {}

const storageError = () =>
  new CalendarError({ message: "Could not read or save the Ozi calendar." });
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(CalendarEvent));
const parse = Schema.decodeUnknownOption(Schema.fromJsonString(CalendarEventInput));
const id = (event: CalendarEventInput) =>
  NodeCrypto.createHash("sha256").update(calendarKey(event)).digest("hex");
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tickets = yield* Tickets.Tickets;
  yield* sql`CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)`;

  const add = Effect.fn("Calendar.add")(
    function* (input: CalendarEventInput) {
      if (calendarEnd(input) <= calendarDate(input.start)) {
        return yield* new CalendarError({ message: "An event must end after it starts." });
      }
      const event: CalendarEvent = {
        ...input,
        id: id(input),
        source: input.source ?? "ozi",
        added: true,
      };
      yield* sql`INSERT INTO calendar_events (id, payload_json) VALUES (${event.id}, ${JSON.stringify(event)})
      ON CONFLICT(id) DO NOTHING`;
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM calendar_events WHERE id = ${event.id}`;
      return yield* decode(rows[0]!.payload_json);
    },
    Effect.mapError((error) => (error instanceof CalendarError ? error : storageError())),
  );

  const list = Effect.fn("Calendar.list")(
    function* (input: CalendarListInput) {
      if (calendarDate(input.end) <= calendarDate(input.start)) {
        return yield* new CalendarError({ message: "The range must end after it starts." });
      }
      const rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM calendar_events`;
      const events = new Map<string, CalendarEvent>();
      const snapshot = yield* tickets.list({ status: "all" });
      for (const ticket of snapshot.tickets) {
        for (const match of `${ticket.summary}\n${ticket.markdown}`.matchAll(
          /^\s*```event[^\S\r\n]*\r?\n([\s\S]*?)^\s*```\s*$/gm,
        )) {
          const parsed = parse(match[1]);
          if (
            Option.isSome(parsed) &&
            calendarEnd(parsed.value) > calendarDate(parsed.value.start)
          ) {
            const event = parsed.value;
            const key = id(event);
            events.set(key, { ...event, id: key, source: "ticket", added: false });
          }
        }
      }
      for (const row of rows) {
        const event = yield* decode(row.payload_json);
        events.set(event.id, event);
      }
      return {
        events: [...events.values()]
          .filter(
            (event) =>
              calendarDate(event.start) < calendarDate(input.end) &&
              calendarEnd(event) > calendarDate(input.start),
          )
          .sort((a, b) => calendarDate(a.start).getTime() - calendarDate(b.start).getTime()),
      };
    },
    Effect.mapError((error) => (error instanceof CalendarError ? error : storageError())),
  );
  return Calendar.of({ list, add });
});
export const layer = Layer.effect(Calendar, make);
