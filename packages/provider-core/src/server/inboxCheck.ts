import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

export const inboxCheckStep = (
  base: Pick<
    Extract<OrchestrationV2TurnItem, { type: "dynamic_tool" }>,
    | "id"
    | "threadId"
    | "runId"
    | "nodeId"
    | "providerThreadId"
    | "providerTurnId"
    | "ordinal"
    | "startedAt"
    | "updatedAt"
  >,
  filed: number,
  status: "running" | "completed" | "failed",
): OrchestrationV2TurnItem => ({
  ...base,
  type: "dynamic_tool",
  toolName: "inbox_check",
  title: `Inbox check · ${filed} filed`,
  status,
  nativeItemRef: null,
  parentItemId: null,
  completedAt: status === "running" ? null : base.updatedAt,
  input: null,
});
