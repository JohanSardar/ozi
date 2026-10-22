import {
  OZI_MAIN_THREAD_ID,
  OziJobError,
  OziJobHandleInput,
  OziJobCard,
  OrchestrationV2DispatchCommandResult,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as Jobs from "./Jobs.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export const JobsToolkit = Toolkit.make(
  Tool.make("job_cards", {
    description:
      "Read current job cards and exact report event IDs. Retries and follow-ups pass the card's jobId to delegate_task, or send to its lead.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(OziJobCard),
    failure: Schema.Union([OziJobError, OrchestratorMcpFailure]),
    failureMode: "return",
    dependencies: [McpInvocationContext, Jobs.Jobs],
  }),
  Tool.make("handle_job", {
    description:
      "Close a job against the exact eventId shown on its card. Close leaves work and requests alone. Reuse commandId when retrying.",
    parameters: OziJobHandleInput,
    success: OrchestrationV2DispatchCommandResult,
    failure: Schema.Union([OziJobError, OrchestratorMcpFailure]),
    failureMode: "return",
    dependencies: [McpInvocationContext, Jobs.Jobs, ThreadManagement.ThreadManagementService],
  }),
);

export const layer = McpToolAccess.toLayer(JobsToolkit, {
  job_cards: McpToolAccess.readsAsCaller(() => Effect.flatMap(Jobs.Jobs, (jobs) => jobs.cards())),
  handle_job: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (scope.thread?.threadId !== OZI_MAIN_THREAD_ID && scope.thread?.role !== "main-fork")
        return yield* new OziJobError({ reason: "WrongJob", detail: "Only main may handle jobs." });
      return yield* (yield* Jobs.Jobs).handle(input);
    }),
  ),
});
