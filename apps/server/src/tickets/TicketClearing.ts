import {
  CommandId,
  EventId,
  MessageId,
  TicketError,
  TurnItemId,
  type ThreadId,
  type Ticket,
  type TicketChooseInput,
  type TicketCloseInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Tickets from "./Tickets.ts";

export class TicketClearing extends Context.Service<
  TicketClearing,
  {
    readonly choose: (input: TicketChooseInput) => Effect.Effect<Ticket, TicketError>;
    readonly close: (input: TicketCloseInput) => Effect.Effect<Ticket, TicketError>;
  }
>()("ozi/tickets/TicketClearing") {}

const isTicketError = Schema.is(TicketError);
const deliveryError = (cause: unknown) =>
  isTicketError(cause) ? cause : new TicketError({ reason: "delivery", cause });

const make = Effect.gen(function* () {
  const tickets = yield* Tickets.Tickets;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const sink = yield* EventSink.EventSinkV2;
  const lock = yield* Semaphore.make(1);

  const note = Effect.fn("TicketClearing.note")(function* (
    key: string,
    threadId: ThreadId,
    outcome: "updated" | "completed",
    text: string,
  ) {
    const thread = yield* threads.getThreadRecords(threadId, ["runs"]);
    const now = yield* DateTime.now;
    const summary = text.replace(/\s+/g, " ");
    yield* sink.commitCommand({
      commandId: CommandId.make(key),
      commandType: "ticket.note",
      threadId,
      acceptedAt: now,
      effects: [],
      events: [
        {
          id: EventId.make(key),
          type: "turn-item.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make(key),
            threadId,
            runId: thread.runs.at(-1)?.id ?? null,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 0,
            type: "notification",
            source: { kind: "system" },
            outcome,
            summary,
            title: summary,
            status: "completed",
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        },
      ],
    });
  });

  const clear = Effect.fn("TicketClearing.clear")(function* (
    input: TicketCloseInput,
    chatId: ThreadId,
  ) {
    const ticket = yield* tickets.close(input);
    yield* note(`ticket:${ticket.id}:closed`, chatId, "completed", `Closed: ${ticket.title}`);
    return ticket;
  });

  const choose = Effect.fn("TicketClearing.choose")(
    function* (input: TicketChooseInput) {
      const ticket = yield* tickets.get(input.id);
      if (ticket.status === "archived") return ticket;
      const choice = ticket.choices[input.choiceIndex];
      if (!choice) return yield* new TicketError({ reason: "invalid_clearance" });
      const chatId = input.chatId ?? ticket.origin.chatId;
      const chat = yield* threads.getThreadRecords(chatId, []);
      if (chat.thread.archivedAt !== null) {
        return yield* new TicketError({ reason: "invalid_origin" });
      }
      yield* threads.getThreadRecords(ticket.origin.threadId, []);
      const key = `ticket:${ticket.id}:answer`;
      const text = `Ticket: ${ticket.title}\n${ticket.need}\n${ticket.summary}\nChosen option ${input.choiceIndex + 1}: ${choice.label}\n${choice.detail}`;
      const { message } = yield* threads.sendToThread({
        threadId: ticket.origin.threadId,
        commandId: CommandId.make(key),
        messageId: MessageId.make(key),
        text,
        attachments: [],
        mode: "auto",
        createdBy: "user",
        creationSource: "web",
      });
      if (message.text !== text) {
        return yield* new TicketError({ reason: "invalid_clearance" });
      }
      yield* note(`${key}:note`, chatId, "updated", `Answered: ${ticket.title}: ${choice.label}`);
      return yield* clear(
        {
          id: ticket.id,
          by: {
            type: "answered",
            choiceIndex: input.choiceIndex,
            threadId: ticket.origin.threadId,
            messageId: message.id,
          },
        },
        chatId,
      );
    },
    lock.withPermit,
    Effect.mapError(deliveryError),
    Effect.uninterruptible,
  );

  const close = Effect.fn("TicketClearing.close")(
    function* (input: TicketCloseInput) {
      const ticket = yield* tickets.get(input.id);
      if (ticket.status === "archived") return ticket;
      if (input.by.type !== "acknowledged") return yield* clear(input, input.by.threadId);
      const chatId = input.chatId ?? ticket.origin.chatId;
      return yield* clear(
        input,
        yield* threads.getThreadRecords(chatId, []).pipe(
          Effect.as(chatId),
          Effect.orElseSucceed(() => ticket.origin.chatId),
        ),
      );
    },
    lock.withPermit,
    Effect.mapError(deliveryError),
    Effect.uninterruptible,
  );

  return TicketClearing.of({ choose, close });
});

export const layer = Layer.effect(TicketClearing, make);
