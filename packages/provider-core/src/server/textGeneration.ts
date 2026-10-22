import type { ChatAttachment, ModelSelection, TextGenerationError } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface ProviderTextGeneration {
  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;
}
