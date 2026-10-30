import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import {
  type ComposerThreadTarget,
  composerDraftHasUserContent,
  resolveComposerDraftKey,
  useComposerDraftStore,
} from "../composerDraftStore";
import { showThreadUndoNotice } from "../hooks/showThreadUndoNotice";
import * as ThreadUndo from "@t3tools/client-runtime/state/thread-undo";
import { releaseDraftAttachments } from "./attachmentUploadQueue";

export function discardComposerDraft(target: ComposerThreadTarget): void {
  const store = useComposerDraftStore.getState();
  const key = resolveComposerDraftKey(store, target);
  const draft = key === null ? undefined : store.draftsByThreadKey[key];
  if (key === null || !draft) return;
  const session = store.draftThreadsByThreadKey[key];
  const environmentKeys = Object.entries(store.environmentDraftIdByEnvironmentId)
    .filter(([, draftKey]) => draftKey === key)
    .map(([environmentKey]) => environmentKey);
  const discardsSession = typeof target === "string";

  const claim = ThreadUndo.begin("discard", key);
  if (discardsSession) {
    store.clearDraftThread(target);
  } else {
    store.clearComposerContent(target);
  }

  showThreadUndoNotice({
    action: "Discarded",
    claim,
    failureTitle: "Failed to restore draft",
    undo: async () => {
      const current = useComposerDraftStore.getState().draftsByThreadKey[key];
      if (current && composerDraftHasUserContent(current)) {
        releaseDraftAttachments([...draft.images, ...draft.files]);
        return AsyncResult.failure(Cause.fail(new Error("The draft has new content.")));
      }
      useComposerDraftStore.setState((state) => {
        const environmentDraftIdByEnvironmentId = {
          ...state.environmentDraftIdByEnvironmentId,
        };
        for (const environmentKey of environmentKeys) {
          environmentDraftIdByEnvironmentId[environmentKey] ??= key;
        }
        return {
          draftsByThreadKey: {
            ...state.draftsByThreadKey,
            [key]: discardsSession
              ? {
                  ...draft,
                  images: draft.images.map((image) =>
                    image.previewUrl.startsWith("blob:")
                      ? { ...image, previewUrl: URL.createObjectURL(image.file) }
                      : image,
                  ),
                }
              : draft,
          },
          draftThreadsByThreadKey: session
            ? { ...state.draftThreadsByThreadKey, [key]: session }
            : state.draftThreadsByThreadKey,
          environmentDraftIdByEnvironmentId,
        };
      });
      return AsyncResult.success(undefined);
    },
    commit: () => releaseDraftAttachments([...draft.images, ...draft.files]),
  });
}
