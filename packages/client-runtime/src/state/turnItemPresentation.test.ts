import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { turnItemIsWorkspacePreparation } from "./turnItemPresentation.ts";

function command(input: string): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-08-03T00:00:00.000Z");
  return {
    id: TurnItemId.make("item-command"),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: "Workspace ready",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "command_execution",
    input,
    output: "Workspace preparation completed.",
    exitCode: 0,
  };
}

function preparationFailure(
  status: OrchestrationV2TurnItem["status"],
  code: string | null = ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
): OrchestrationV2TurnItem {
  const {
    input: _input,
    output: _output,
    exitCode: _exitCode,
    ...base
  } = command("") as Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;
  return {
    ...base,
    id: TurnItemId.make("item-error"),
    status,
    title: "Workspace preparation failed",
    type: "error",
    failure: { class: "validation_error", message: "fetch failed", code, retryable: false },
  };
}

describe("turnItemIsWorkspacePreparation", () => {
  it("hides a preparation failure only once a retry cancelled it", () => {
    expect(turnItemIsWorkspacePreparation(preparationFailure("failed"))).toBe(false);
    expect(turnItemIsWorkspacePreparation(preparationFailure("cancelled"))).toBe(true);
    expect(turnItemIsWorkspacePreparation(preparationFailure("cancelled", null))).toBe(false);
  });
});

describe("workspacePreparationRetryRunIds", () => {});
