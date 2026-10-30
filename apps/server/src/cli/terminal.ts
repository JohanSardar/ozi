import {
  OrchestratorMcpThreadListResult,
  InboxSnapshot,
  type RunId,
  OrchestratorMcpThreadSendResult,
  ThreadId,
  Ticket,
  TicketResponse,
  type TicketListInput,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Command, Flag, Prompt } from "effect/cli";
import { formatInbox, formatTicket, formatJson, inboxFlags, withInboxTools } from "./inbox.ts";
import {
  readTimeline,
  readFullText,
  ThreadLaunchResult,
  ThreadUsageError,
  waitForRun,
} from "./thread.ts";

const decodeThreadId = Schema.decodeEffect(ThreadId);

const help =
  "/inbox · /archive [search] · /open <ticket> · /choose <1–4> · /reply <text> · /got-it · /chat <id> · /chats · /new <message> · /show · /quit\nType a message to send it to the current chat.";

export const terminalCommand = Command.make("terminal", {
  ...inboxFlags,
  chat: Flag.String("chat").pipe(Flag.withSchema(ThreadId), Flag.optional),
}).pipe(
  Command.withDescription(
    "Use chats and the inbox in a terminal. --json accepts line commands and emits newline-delimited JSON.",
  ),
  Command.withHandler((flags) =>
    withInboxTools(
      flags,
      Effect.fn("cli.terminal")(function* (tools) {
        let chatId = Option.getOrUndefined(flags.chat);
        let selected: Ticket | undefined;
        let filter: TicketListInput = {};
        let tickets: ReadonlyArray<Ticket> = [];
        let revision: string | undefined;
        const emit = (type: string, value: unknown, text: string) =>
          Console.log(flags.json ? formatJson({ type, value }) : text);
        const readChat = Effect.fn("cli.terminal.readChat")(function* (threadId: ThreadId) {
          const timeline = yield* readTimeline(tools, threadId, "messages");
          const items = yield* Effect.forEach(timeline.items, (item) =>
            readFullText(tools, threadId, item).pipe(Effect.map((text) => ({ ...item, text }))),
          );
          return { ...timeline, items };
        });
        const refresh = Effect.fn("cli.terminal.refresh")(function* (force = true) {
          const activeFilter = filter;
          const result = yield* tools.inbox(
            { action: "watch", input: activeFilter },
            InboxSnapshot,
          );
          if (filter !== activeFilter || (!force && result.cursor === revision)) return;
          const position = Math.max(
            0,
            tickets.findIndex((ticket) => ticket.id === selected?.id),
          );
          revision = result.cursor;
          tickets = result.tickets.toSorted(
            (left, right) =>
              ["Decide", "Do", "Review", "Read"].indexOf(left.group) -
              ["Decide", "Do", "Review", "Read"].indexOf(right.group),
          );
          selected =
            tickets.find((ticket) => ticket.id === selected?.id) ??
            tickets[Math.min(position, tickets.length - 1)];
          yield* emit("inbox", { tickets }, formatInbox(tickets));
          if (selected) yield* emit("ticket", selected, formatTicket(selected));
        });
        const follow = Effect.fn("cli.terminal.follow")(function* (
          threadId: ThreadId,
          runId: RunId,
        ) {
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              const outcome = yield* waitForRun(tools, threadId, runId);
              const timeline = yield* readChat(threadId);
              const items = timeline.items.filter(
                (item) =>
                  item.type === "assistant_message" &&
                  item.runId === (outcome.type === "ended" ? outcome.runId : runId),
              );
              yield* emit(
                "reply",
                { threadId, outcome, items },
                items.map((item) => item.text ?? "").join("\n") ||
                  `Chat ${threadId}: ${outcome.type === "ended" ? outcome.status : "waiting on you"}`,
              );
            }).pipe(
              Effect.catch((error) => emit("error", { message: String(error) }, String(error))),
            ),
          );
        });
        const handle = Effect.fn("cli.terminal.command")(
          function* (line: string) {
            const [entered = "", ...words] = line.trim().split(/\s+/u);
            const numbered =
              /^[1-4]$/.test(entered) &&
              words.length === 0 &&
              selected?.status === "open" &&
              selected.choices.length > 0;
            const command = numbered ? "/choose" : entered;
            const argument = numbered ? entered : words.join(" ");
            switch (command) {
              case "":
                return;
              case "/help":
                return yield* emit("help", help, help);
              case "/inbox":
                filter = {};
                return yield* refresh();
              case "/archive":
                filter = { status: "archived", ...(argument ? { search: argument } : {}) };
                return yield* refresh();
              case "/open": {
                selected = yield* tools.inbox({ action: "get", input: { id: argument } }, Ticket);
                return yield* emit("ticket", selected, formatTicket(selected));
              }
              case "/chat": {
                const id = yield* decodeThreadId(argument);
                const timeline = yield* readChat(id);
                chatId = id;
                return yield* emit(
                  "chat",
                  timeline,
                  timeline.items.map((item) => item.text ?? "").join("\n"),
                );
              }
              case "/show": {
                if (!chatId)
                  return yield* new ThreadUsageError({
                    detail: "Select a current chat with /chat <id> or /new <message>.",
                  });
                const timeline = yield* readChat(chatId);
                return yield* emit(
                  "chat",
                  timeline,
                  timeline.items.map((item) => item.text ?? "").join("\n"),
                );
              }
              case "/chats": {
                let cursor: number | null = 0;
                do {
                  const result: OrchestratorMcpThreadListResult = yield* tools.call(
                    "ozi_thread_list",
                    { includeSubagents: false, cursor, limit: 100 },
                    OrchestratorMcpThreadListResult,
                  );
                  yield* emit(
                    "chats",
                    result,
                    result.threads
                      .map((thread) => `${thread.threadId}  ${thread.status}  ${thread.title}`)
                      .join("\n"),
                  );
                  cursor = result.nextCursor;
                } while (cursor !== null);
                return;
              }
              case "/new": {
                const result = yield* tools.call(
                  "ozi_thread_launch",
                  { title: argument.slice(0, 80), message: argument },
                  ThreadLaunchResult,
                );
                chatId = result.threadId;
                if (result.runId) yield* follow(chatId, result.runId);
                return yield* emit("chat-started", result, `Chat ${chatId}`);
              }
              case "/got-it":
              case "/choose":
              case "/reply": {
                if (!selected)
                  return yield* new ThreadUsageError({ detail: "Open a ticket first." });
                if (command === "/reply" && !chatId)
                  return yield* new ThreadUsageError({
                    detail: "Select the current chat with /chat <id> before replying.",
                  });
                const action = command === "/got-it" ? "close" : command.slice(1);
                const input =
                  command === "/got-it"
                    ? {
                        id: selected.id,
                        by: { type: "acknowledged" },
                        ...(chatId ? { chatId } : {}),
                      }
                    : command === "/choose"
                      ? {
                          id: selected.id,
                          choiceIndex: Number(argument) - 1,
                          ...(chatId ? { chatId } : {}),
                        }
                      : { id: selected.id, chatId, text: argument };
                const result = yield* tools.inbox(
                  { action, input },
                  Schema.Union([Ticket, TicketResponse]),
                );
                if ("runId" in result) yield* follow(result.threadId, result.runId);
                else if (result.status === "archived" && result.cleared.by.type === "answered") {
                  const by = result.cleared.by;
                  const timeline = yield* readChat(by.threadId);
                  const message = timeline.items.find((item) => item.messageId === by.messageId);
                  if (message?.runId) yield* follow(by.threadId, message.runId);
                }
                yield* emit("cleared", result, command === "/got-it" ? "Got it." : "Sent.");
                return yield* refresh(false);
              }
              default: {
                if (command.startsWith("/"))
                  return yield* new ThreadUsageError({ detail: "Unknown command. Type /help." });
                if (!chatId)
                  return yield* new ThreadUsageError({
                    detail: "Select a current chat with /chat <id> or /new <message>.",
                  });
                const result = yield* tools.call(
                  "ozi_thread_send",
                  { threadId: chatId, message: line, mode: "queue" },
                  OrchestratorMcpThreadSendResult,
                );
                yield* follow(result.threadId, result.runId);
                yield* emit("sent", result, result.delivery === "queued" ? "Queued." : "Sent.");
              }
            }
          },
          Effect.catch((error) => emit("error", { message: String(error) }, String(error))),
        );
        yield* refresh();
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            while (true) {
              const activeFilter = filter;
              const snapshot = yield* tools.inbox(
                {
                  action: "watch",
                  input: {
                    ...activeFilter,
                    ...(revision === undefined ? {} : { after: revision }),
                  },
                },
                InboxSnapshot,
              );
              if (filter === activeFilter && snapshot.cursor !== revision) yield* refresh(false);
            }
          }).pipe(
            Effect.catch((error) => emit("error", { message: String(error) }, String(error))),
          ),
        );
        if (flags.json) {
          const stdio = yield* Stdio.Stdio;
          return yield* stdio.stdin.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.takeWhile((line) => line.trim() !== "/quit"),
            Stream.runForEach(handle),
          );
        }
        yield* Console.log(help);
        while (true) {
          const line = yield* Prompt.String({ message: chatId ? `Ozi · ${chatId}` : "Ozi" }).pipe(
            Effect.option,
          );
          if (Option.isNone(line) || line.value.trim() === "/quit") return;
          yield* handle(line.value);
        }
      }),
    ),
  ),
);
