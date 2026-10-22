import type { ChatAttachment, OrchestrationV2ThreadProjection } from "@t3tools/contracts";

type Projection = OrchestrationV2ThreadProjection;
type Run = Projection["runs"][number];
type Message = Projection["messages"][number];
export interface QueuedThreadRun {
  readonly run: Run;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly messageId: Message["id"];
  readonly context?: Message["context"];
}

export interface ThreadQueueWorkflowState {
  readonly activeRun: Run | null;
  readonly queuedRuns: ReadonlyArray<QueuedThreadRun>;
  readonly isHeld: boolean;
  readonly canReorder: boolean;
  readonly canPromoteToSteer: boolean;
}
