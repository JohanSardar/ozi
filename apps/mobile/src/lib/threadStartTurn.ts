import {
  CommandId,
  MessageId,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  deriveThreadTitleSeed,
  threadTitleTextFromPrompt,
} from "@t3tools/client-runtime/operations";

import type { UploadedMobileAttachment } from "./attachmentUpload";

export interface ThreadStartTurnSpec {
  readonly defaultCwd: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly titleText?: string;
  readonly context?: OrchestrationMessageContext;
  readonly uploadedAttachments: ReadonlyArray<UploadedMobileAttachment | ChatAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceMode: "local";
  readonly workingDirectory: string | null;
}

export function buildThreadStartTurnInput(spec: ThreadStartTurnSpec) {
  const title = deriveThreadTitleSeed({
    text: spec.titleText ?? spec.text,
    attachments: spec.uploadedAttachments,
  });
  return {
    commandId: CommandId.make(spec.commandId),
    creationSource: "mobile" as const,
    threadId: ThreadId.make(spec.threadId),
    message: {
      messageId: MessageId.make(spec.messageId),
      role: "user" as const,
      text: spec.text,
      ...(spec.context ? { context: spec.context } : {}),
      attachments: spec.uploadedAttachments,
    },
    modelSelection: spec.modelSelection,
    titleSeed: title,
    runtimeMode: spec.runtimeMode,
    interactionMode: spec.interactionMode,
    bootstrap: {
      createThread: {
        title,
        modelSelection: spec.modelSelection,
        runtimeMode: spec.runtimeMode,
        interactionMode: spec.interactionMode,
        workingDirectory: spec.workingDirectory,
        createdAt: spec.createdAt,
      },
    },
    createdAt: spec.createdAt,
  };
}

export function deriveThreadTitleFromPrompt(value: string): string {
  const title = threadTitleTextFromPrompt(value) || "New thread";
  return title.length <= 72 ? title : `${title.slice(0, 69).trimEnd()}...`;
}
