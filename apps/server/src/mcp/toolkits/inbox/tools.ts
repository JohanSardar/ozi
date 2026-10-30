import { InboxRequest, InboxResult, OrchestratorMcpFailure, TicketError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as TicketClearing from "../../../tickets/TicketClearing.ts";
import * as Inbox from "../../../tickets/Inbox.ts";
import * as Tickets from "../../../tickets/Tickets.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const InboxToolkit = Toolkit.make(
  Tool.make("inbox", {
    description:
      "User inbox operations for paired CLI clients. Agent sessions use ticket_create, ticket_update, ticket_close and ticket_list instead.",
    parameters: Schema.Struct({ request: InboxRequest }),
    success: InboxResult,
    failure: Schema.Union([TicketError, OrchestratorMcpFailure]),
    failureMode: "return",
    dependencies: [
      Inbox.Inbox,
      Tickets.Tickets,
      TicketClearing.TicketClearing,
      ThreadManagement.ThreadManagementService,
      McpInvocationContext.McpInvocationContext,
    ],
  })
    .annotate(Tool.Destructive, true)
    .annotate(McpSchema.EnabledWhen, McpInvocationContext.pairedClientOnly),
);
