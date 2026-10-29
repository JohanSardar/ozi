import {
  CommandId,
  EventId,
  MessageId,
  TicketError,
  TurnItemId,
  type Ticket,
  type TicketChooseInput,
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

export class TicketChoices extends Context.Service<
  TicketChoices,
  { readonly choose: (input: TicketChooseInput) => Effect.Effect<Ticket, TicketError> }
>()("ozi/tickets/TicketChoices") {}

const isTicketError = Schema.is(TicketError);

const make = Effect.gen(function* () {
  const tickets = yield* Tickets.Tickets;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const sink = yield* EventSink.EventSinkV2;
  const lock = yield* Semaphore.make(1);

  const choose = Effect.fn("TicketChoices.choose")(
    function* (input: TicketChooseInput) {
      const ticket = yield* tickets.get(input.id);
      if (ticket.status === "archived") return ticket;
      const choice = ticket.choices[input.choiceIndex];
      if (!choice) return yield* new TicketError({ reason: "invalid_clearance" });
      const chatId = input.chatId ?? ticket.origin.chatId;
      const chat = yield* threads.getThreadRecords(chatId, ["runs"]);
      if (chat.thread.archivedAt !== null) {
        return yield* new TicketError({ reason: "invalid_origin" });
      }
      const source = yield* threads.getThreadRecords(ticket.origin.threadId, []);
      const key = `ticket:${ticket.id}:answer`;
      const text = `Ticket: ${ticket.title}\n${ticket.need}\n${ticket.summary}\nChosen option ${input.choiceIndex + 1}: ${choice.label}\n${choice.detail}`;
      const { message } = yield* threads.sendToThread({
        projectId: source.thread.projectId,
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
      const now = yield* DateTime.now;
      const summary = `Answered: ${ticket.title}: ${choice.label}`.replace(/\s+/g, " ");
      yield* sink.commitCommand({
        commandId: CommandId.make(`${key}:note`),
        commandType: "ticket.choice.note",
        threadId: chatId,
        acceptedAt: now,
        effects: [],
        events: [
          {
            id: EventId.make(`${key}:note`),
            type: "turn-item.updated",
            threadId: chatId,
            occurredAt: now,
            payload: {
              id: TurnItemId.make(`${key}:note`),
              threadId: chatId,
              runId: chat.runs.at(-1)?.id ?? null,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 0,
              type: "notification",
              source: { kind: "system" },
              outcome: "updated",
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
      return yield* tickets.close({
        id: ticket.id,
        by: {
          type: "answered",
          choiceIndex: input.choiceIndex,
          threadId: ticket.origin.threadId,
          messageId: message.id,
        },
      });
    },
    lock.withPermit,
    Effect.mapError((cause) =>
      isTicketError(cause) ? cause : new TicketError({ reason: "delivery", cause }),
    ),
    Effect.uninterruptible,
  );

  return TicketChoices.of({ choose });
});

export const layer = Layer.effect(TicketChoices, make);
