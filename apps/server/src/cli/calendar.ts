import {
  CalendarEvent,
  CalendarEventInput,
  CalendarListInput,
  CalendarListResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { serverLocationFlags } from "./config.ts";
import { withThreadTools } from "./thread.ts";

const flags = {
  ...serverLocationFlags,
  input: Flag.String("input").pipe(Flag.withDescription("JSON event or {start,end} date range.")),
  json: Flag.Boolean("json").pipe(Flag.withDefault(true)),
};
const command = <
  I extends Schema.Decoder<Readonly<Record<string, unknown>>>,
  O extends Schema.Decoder<unknown>,
>(
  name: "list" | "add",
  input: I,
  output: O,
) =>
  Command.make(name, flags).pipe(
    Command.withHandler((flags) =>
      Schema.decodeEffect(Schema.fromJsonString(input))(flags.input).pipe(
        Effect.flatMap((input) =>
          withThreadTools(flags, (tools) =>
            tools
              .call(`calendar_${name}`, input, output)
              .pipe(Effect.flatMap((value) => Console.log(JSON.stringify(value)))),
          ),
        ),
      ),
    ),
  );
export const calendarCommand = Command.make("calendar").pipe(
  Command.withDescription("List events and add to Ozi's calendar. Output is JSON."),
  Command.withSubcommands([
    command("list", CalendarListInput, CalendarListResult),
    command("add", CalendarEventInput, CalendarEvent),
  ]),
);
