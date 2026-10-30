import {
  InboxResult,
  InboxSnapshot,
  TicketCreateInput,
  TicketUpdateInput,
  TicketCloseInput,
  TicketChooseInput,
  TicketGetInput,
  TicketListInput,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { baseDirFlag } from "./config.ts";
import { formatJson, withInboxTools } from "./inbox.ts";

const print = (value: unknown) => Console.log(formatJson(value));
const run = Effect.fn("cli.ticket")(function* (
  flags: { readonly baseDir: Option.Option<string>; readonly json: boolean },
  action: "create" | "update" | "close" | "get" | "list" | "choose",
  input: unknown,
) {
  return yield* withInboxTools(flags, (tools) =>
    tools.inbox({ action, input }, InboxResult).pipe(Effect.flatMap(print)),
  );
});

const decodeList = Schema.decodeEffect(Schema.fromJsonString(TicketListInput));

const flags = {
  baseDir: baseDirFlag,
  input: Flag.String("input").pipe(Flag.withDefault("{}"), Flag.withDescription("JSON request.")),
  json: Flag.Boolean("json").pipe(Flag.withDefault(true)),
};
const command = <S extends Schema.Decoder<unknown>>(
  name: "create" | "update" | "close" | "get" | "list" | "choose",
  schema: S,
) =>
  Command.make(name, flags).pipe(
    Command.withHandler((flags) =>
      Schema.decodeEffect(Schema.fromJsonString(schema))(flags.input).pipe(
        Effect.flatMap((input) => run(flags, name, input)),
      ),
    ),
  );

export const ticketCommand = Command.make("ticket").pipe(
  Command.withDescription(
    "Create, update, archive and watch structured inbox tickets. All output is JSON.",
  ),
  Command.withSubcommands([
    command("create", TicketCreateInput),
    command("update", TicketUpdateInput),
    command("close", TicketCloseInput),
    command("choose", TicketChooseInput),
    command("get", TicketGetInput),
    command("list", TicketListInput),
    Command.make("subscribe", flags).pipe(
      Command.withHandler((flags) =>
        decodeList(flags.input).pipe(
          Effect.flatMap((input) =>
            withInboxTools(
              flags,
              Effect.fn("cli.ticket.subscribe")(function* (tools) {
                let after: string | undefined;
                while (true) {
                  const snapshot = yield* tools.inbox(
                    {
                      action: "watch",
                      input: { ...input, ...(after === undefined ? {} : { after }) },
                    },
                    InboxSnapshot,
                  );
                  if (snapshot.cursor !== after) yield* print({ tickets: snapshot.tickets });
                  after = snapshot.cursor;
                }
              }),
            ),
          ),
        ),
      ),
    ),
  ]),
);
