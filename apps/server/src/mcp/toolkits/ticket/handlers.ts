import { TicketError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as Tickets from "../../../tickets/Tickets.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readThread } from "../../threadAccess.ts";
import { TicketToolkit } from "./tools.ts";

const callerOrigin = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "Ticket tools");
  if (thread.inboxCheck !== undefined) {
    return {
      threadId: thread.threadId,
      sessionId: thread.inboxCheck.sessionId,
      messageId: thread.inboxCheck.messageId,
    };
  }
  const { projection, caller } = yield* readThread(thread.threadId, [
    "runs",
    "providerThreads",
    "messages",
  ]);
  const activeRunId = caller?.activeRunId ?? null;
  const run = projection.runs.findLast(
    (run) =>
      run.providerInstanceId === thread.providerInstanceId &&
      (scope.ticketRunId !== undefined
        ? run.id === scope.ticketRunId
        : activeRunId === null
          ? run.providerThreadId === projection.thread.activeProviderThreadId
          : run.id === activeRunId),
  );
  const providerThread = projection.providerThreads.find(
    (candidate) =>
      candidate.id === (run?.providerThreadId ?? projection.thread.activeProviderThreadId) &&
      candidate.providerInstanceId === thread.providerInstanceId,
  );
  if (
    run === undefined ||
    providerThread?.providerSessionId == null ||
    (scope.ticketRunId !== undefined &&
      providerThread.id !== projection.thread.activeProviderThreadId)
  ) {
    return yield* new TicketError({ reason: "invalid_origin" });
  }
  const message = projection.messages.findLast(
    (message) => message.role === "user" && message.runId === run.id,
  );
  return {
    threadId: thread.threadId,
    sessionId: providerThread.providerSessionId,
    messageId: message?.id ?? run.userMessageId,
  };
});

export const layer = McpToolAccess.toLayer(TicketToolkit, {
  ticket_create: McpToolAccess.actsOnTickets((input) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets.Tickets;
      const origin = yield* callerOrigin;
      const ticket = yield* tickets.create({ ...input, ...origin });
      const scope = yield* McpInvocationContext.McpInvocationContext;
      scope.thread?.inboxCheck?.filed.add(ticket.id);
      return ticket;
    }),
  ),
  ticket_update: McpToolAccess.actsOnTickets((input) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets.Tickets;
      yield* callerOrigin;
      return yield* tickets.update(input);
    }),
  ),
  ticket_close: McpToolAccess.actsOnTickets((input) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets.Tickets;
      const origin = yield* callerOrigin;
      return yield* tickets.close({
        id: input.id,
        by: { type: "agent", threadId: origin.threadId, messageId: origin.messageId },
      });
    }),
  ),
  ticket_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const tickets = yield* Tickets.Tickets;
      return yield* tickets.list(input);
    }),
  ),
});
