import { OrchestratorMcpFailure, type InboxRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Inbox from "../../../tickets/Inbox.ts";
import * as Tickets from "../../../tickets/Tickets.ts";
import * as TicketClearing from "../../../tickets/TicketClearing.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { InboxToolkit } from "./tools.ts";

const handle = Effect.fn("mcp.inbox")(function* ({ request }: { readonly request: InboxRequest }) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (
    !scope.client ||
    scope.thread ||
    scope.client.linked ||
    !scope.capabilities.has("orchestration")
  ) {
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "Inbox user actions require a paired CLI client.",
    });
  }
  const tickets = yield* Tickets.Tickets;
  const inbox = yield* Inbox.Inbox;
  const clearing = yield* TicketClearing.TicketClearing;
  switch (request.action) {
    case "list":
      return yield* tickets.list(request.input);
    case "get":
      return yield* tickets.get(request.input.id);
    case "create":
      return yield* tickets.create(request.input);
    case "update":
      return yield* tickets.update(request.input);
    case "close":
      return yield* clearing.close(request.input);
    case "choose":
      return yield* clearing.choose(request.input);
    case "reply":
      return yield* inbox.reply(request.input);
    case "watch":
      return yield* inbox.watch(request.input);
  }
});

export const layer = McpToolAccess.toLayer(InboxToolkit, {
  inbox: McpToolAccess.either(
    ({ request }) =>
      request.action === "list" || request.action === "get" || request.action === "watch",
    McpToolAccess.reads(handle),
    McpToolAccess.writesThreads(
      ({ request }) => (request.action === "reply" ? [request.input.chatId] : []),
      handle,
    ),
  ),
});
