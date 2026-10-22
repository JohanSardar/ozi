import { MessageId } from "@t3tools/contracts";

type CodexFeedbackSubmissionDetails = {
  readonly id: MessageId;
  readonly command: string;
  readonly createdAt: string;
};

export type CodexFeedbackSubmission = CodexFeedbackSubmissionDetails &
  (
    | { readonly status: "uploading" | "interrupted" }
    | { readonly status: "sent"; readonly feedbackId: string }
    | { readonly status: "failed"; readonly errorMessage: string }
  );

export interface LocalChatMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly turnId: null;
  readonly streaming: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
