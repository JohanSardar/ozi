import {
  CalendarError,
  CalendarEvent,
  CalendarEventInput,
  CalendarListInput,
  CalendarListResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Calendar from "../../../calendar/Calendar.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: Schema.Union([CalendarError, OrchestratorMcpFailure]),
  failureMode: "return" as const,
  dependencies: [
    Calendar.Calendar,
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
};
export const CalendarToolkit = Toolkit.make(
  Tool.make("calendar_list", {
    ...shared,
    description:
      "List Ozi and ticket events in a date range. An event card in a ticket lets the user add it with one click. Never add to an outside calendar without the user's Add.",
    parameters: CalendarListInput,
    success: CalendarListResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("calendar_add", {
    ...shared,
    description:
      "Save an event to Ozi's calendar only. An event card in a ticket lets the user add it with one click. Never add to an outside calendar without the user's Add.",
    parameters: CalendarEventInput,
    success: CalendarEvent,
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true),
);
