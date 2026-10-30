import type { ChatAttachment, ModelSelection, TextGenerationError } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { ThreadTitleForkSource } from "./textGenerationPrompts.ts";

export interface ThreadTitleGenerationInput {
  cwd: string;
  message: string;
  previousTitle?: string | undefined;
  forkSource?: ThreadTitleForkSource | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  instructions?: string | undefined;
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
