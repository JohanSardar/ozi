import type { ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { releaseDraftAttachments } from "./attachmentUploadQueue";

export function releaseComposerDraftUploads(target: ScopedThreadRef | DraftId): void {
  const draft = useComposerDraftStore.getState().getComposerDraft(target);
  if (draft) {
    releaseDraftAttachments([...draft.images, ...draft.files]);
  }
}
