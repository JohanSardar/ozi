import {
  OrchestratorMcpFailure,
  Ticket,
  TicketContent,
  TicketError,
  TicketGetInput,
  TicketListInput,
  TicketListResult,
  TicketUpdateInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TicketClearing from "../../../tickets/TicketClearing.ts";
import * as Tickets from "../../../tickets/Tickets.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([TicketError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Tickets.Tickets,
    TicketClearing.TicketClearing,
  ],
};

export const TicketToolkit = Toolkit.make(
  Tool.make("ticket_create", {
    ...shared,
    description:
      "File a ticket when the user needs to answer, act, review or acknowledge something. Skip small talk. Session and transcript links are attached automatically. Delegated workers use this only when their task tells them to.",
    parameters: TicketContent,
    success: Ticket,
  }).annotate(Tool.Destructive, true),
  Tool.make("ticket_update", {
    ...shared,
    description:
      "Update an open ticket when its context, request or choices change. Delegated workers use this only when their task tells them to.",
    parameters: TicketUpdateInput,
    success: Ticket,
  }).annotate(Tool.Destructive, true),
  Tool.make("ticket_close", {
    ...shared,
    description:
      "Close a ticket after the user acknowledges it in this chat. The server records the calling session's user message as the acknowledgement. Delegated workers use this only when their task tells them to.",
    parameters: TicketGetInput,
    success: Ticket,
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true),
  Tool.make("ticket_list", {
    ...shared,
    description:
      "List open tickets before filing duplicates or closing acknowledged ones. Filter by chat, search text or archived/all status to find earlier tickets. Delegated workers use this only when their task tells them to.",
    parameters: TicketListInput,
    success: TicketListResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true),
);
