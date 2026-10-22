import type { OrchestrationV2Subagent } from "@t3tools/contracts";

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SubagentUsage {
  readonly totalTokens: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly toolUses?: number;
  readonly durationMs?: number;
}

export interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

export interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

export interface SubagentRunHandles {
  readonly runId?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly transcriptDir?: string | undefined;
  readonly sessionUrl?: string | undefined;
}

export interface RuntimeSubagent {
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly childThreadId: string | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

export interface SubagentWorkflowGroup {
  readonly workflow: RuntimeSubagent;
  readonly phases: ReadonlyArray<{
    readonly index: number;
    readonly title: string;
    readonly members: ReadonlyArray<RuntimeSubagent>;
    readonly state: "pending" | "running" | "done";
    readonly settledCount: number;
  }>;
  readonly unphasedMembers: ReadonlyArray<RuntimeSubagent>;
}

export interface WorkflowOpening {
  readonly messageId: string;
  readonly script: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly driver: OrchestrationV2Subagent["driver"] | null;
  readonly providerInstanceId: OrchestrationV2Subagent["providerInstanceId"] | null;
  /** Null until the parent thread's coordinator row is loaded. */
  readonly group: SubagentWorkflowGroup | null;
}
