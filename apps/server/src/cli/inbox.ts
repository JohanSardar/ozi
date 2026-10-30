import {
  ThreadId,
  Ticket,
  TicketId,
  TicketListResult,
  TicketResponse,
  type TicketListInput,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { baseDirFlag } from "./config.ts";
import { reportThreadErrors, withThreadTools, type CliTools } from "./thread.ts";

export const inboxFlags = {
  baseDir: baseDirFlag,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
};
export const formatJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
export const withInboxTools = Effect.fn("cli.inbox.withTools")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string>; readonly json: boolean },
  run: (tools: CliTools) => Effect.Effect<A, E, R>,
) {
  return yield* withThreadTools(flags, run).pipe(reportThreadErrors(flags.json));
});
const idArgument = Argument.String("ticket").pipe(Argument.withSchema(TicketId));
const ticketClearance = (ticket: Ticket) => {
  if (ticket.status === "open") return "Open";
  switch (ticket.cleared.by.type) {
    case "acknowledged":
      return "Got it";
    case "answered":
      return `Chose ${ticket.cleared.by.choiceIndex + 1}`;
    case "replied":
      return "Replied";
    case "agent":
      return "Closed by agent";
  }
};
export const formatTicket = (ticket: Ticket) =>
  [
    `${ticket.group}: ${ticket.title}`,
    ticket.need,
    ticket.summary,
    ticket.markdown,
    ...ticket.choices.map((choice, index) => `${index + 1}. ${choice.label}: ${choice.detail}`),
    ...ticket.attachments.map((attachment) => `File: ${attachment.name} (${attachment.id})`),
    ...ticket.htmlPages.map((page) => `Page: ${page.title} (${page.attachment.id})`),
    `Chat: ${ticket.origin.chatId}`,
    `Session: ${ticket.origin.sessionId ?? "none"}`,
    `Transcript: ${ticket.origin.transcriptPath}`,
    `Ticket: ${ticket.id} · ${ticketClearance(ticket)}`,
  ]
    .filter(Boolean)
    .join("\n");

export const formatInbox = (tickets: ReadonlyArray<Ticket>) =>
  ["Decide", "Do", "Review", "Read"]
    .flatMap((group) => {
      const items = tickets.filter((ticket) => ticket.group === group);
      return items.length === 0
        ? []
        : [
            `${group} (${items.length})`,
            ...items.map(
              (ticket) =>
                `${ticket.id}  ${ticket.title} · ${ticket.origin.chatId} · ${ticketClearance(ticket)} · ${ticket.cleared?.at ?? ticket.createdAt}`,
            ),
          ];
    })
    .join("\n") || "Inbox empty.";

const listFlags = {
  ...inboxFlags,
  search: Flag.String("search").pipe(Flag.optional),
  chat: Flag.String("chat").pipe(Flag.withSchema(ThreadId), Flag.optional),
};
const list = (name: "list" | "archive") =>
  Command.make(name, listFlags).pipe(
    Command.withDescription(
      name === "archive" ? "Search cleared tickets." : "List the inbox across chats.",
    ),
    Command.withHandler((flags) =>
      withInboxTools(
        flags,
        Effect.fn("cli.inbox.list")(function* (tools) {
          const input: TicketListInput = {
            status: name === "archive" ? "archived" : "open",
            ...Option.match(flags.search, {
              onNone: () => ({}),
              onSome: (search) => (search.trim() ? { search: search.trim() } : {}),
            }),
            ...Option.match(flags.chat, { onNone: () => ({}), onSome: (chatId) => ({ chatId }) }),
          };
          const result = yield* tools.inbox({ action: "list", input }, TicketListResult);
          yield* Console.log(flags.json ? formatJson(result) : formatInbox(result.tickets));
        }),
      ),
    ),
  );

export const inboxCommand = Command.make("inbox").pipe(
  Command.withDescription("List, open, answer and search inbox tickets."),
  Command.withSubcommands([
    list("list"),
    list("archive"),
    Command.make("open", { ...inboxFlags, id: idArgument }).pipe(
      Command.withHandler((flags) =>
        withInboxTools(
          flags,
          Effect.fn("cli.inbox.open")(function* (tools) {
            const ticket = yield* tools.inbox({ action: "get", input: { id: flags.id } }, Ticket);
            yield* Console.log(flags.json ? formatJson(ticket) : formatTicket(ticket));
          }),
        ),
      ),
    ),
    Command.make("got-it", { ...inboxFlags, id: idArgument }).pipe(
      Command.withHandler((flags) =>
        withInboxTools(
          flags,
          Effect.fn("cli.inbox.acknowledge")(function* (tools) {
            const ticket = yield* tools.inbox(
              { action: "close", input: { id: flags.id, by: { type: "acknowledged" } } },
              Ticket,
            );
            yield* Console.log(flags.json ? formatJson(ticket) : formatTicket(ticket));
          }),
        ),
      ),
    ),
    Command.make("choose", {
      ...inboxFlags,
      id: idArgument,
      choice: Argument.Int("choice"),
      chat: Flag.String("chat").pipe(Flag.withSchema(ThreadId), Flag.optional),
    }).pipe(
      Command.withDescription("Choose a numbered option (1–4) and answer its asking session."),
      Command.withHandler((flags) =>
        withInboxTools(
          flags,
          Effect.fn("cli.inbox.choose")(function* (tools) {
            const result = yield* tools.inbox(
              {
                action: "choose",
                input: {
                  id: flags.id,
                  choiceIndex: flags.choice - 1,
                  ...Option.match(flags.chat, {
                    onNone: () => ({}),
                    onSome: (chatId) => ({ chatId }),
                  }),
                },
              },
              Ticket,
            );
            yield* Console.log(flags.json ? formatJson(result) : formatTicket(result));
          }),
        ),
      ),
    ),
    Command.make("reply", {
      ...inboxFlags,
      id: idArgument,
      text: Argument.String("message"),
      chatId: Flag.String("chat").pipe(Flag.withSchema(ThreadId)),
    }).pipe(
      Command.withDescription(
        "Reply in the selected current chat, including from the archive. --chat is required.",
      ),
      Command.withHandler((flags) =>
        withInboxTools(
          flags,
          Effect.fn("cli.inbox.reply")(function* (tools) {
            const result = yield* tools.inbox(
              { action: "reply", input: { id: flags.id, chatId: flags.chatId, text: flags.text } },
              TicketResponse,
            );
            yield* Console.log(flags.json ? formatJson(result) : formatTicket(result.ticket));
          }),
        ),
      ),
    ),
  ]),
);
