import {
  type OrchestrationV2PendingBackgroundTask,
  type OrchestrationV2ExecutionNode,
  type ThreadId,
} from "@t3tools/contracts";

export interface ProviderSubagentStatus {
  readonly status: OrchestrationV2ExecutionNode["status"];
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

type BackgroundWorkKind = OrchestrationV2PendingBackgroundTask["kind"];

export interface PendingBackgroundWorkItem {
  readonly taskId: string;
  readonly kind: BackgroundWorkKind;
  readonly label: string;
  readonly childThreadId: ThreadId | undefined;
}

export interface PendingBackgroundWorkPresentation {
  readonly title: string;
  readonly items: ReadonlyArray<PendingBackgroundWorkItem>;
  readonly waiting: boolean;
}

export interface ProviderGoalPresentation {
  readonly title: string;
  readonly objective: string;
  readonly usage: string | null;
  readonly canResume: boolean;
}
