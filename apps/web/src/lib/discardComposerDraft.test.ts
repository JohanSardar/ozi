import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadUndoNotice } from "../hooks/showThreadUndoNotice";
import { releaseDraftAttachments } from "./attachmentUploadQueue";
import { discardComposerDraft } from "./discardComposerDraft";

vi.mock("./attachmentUploadQueue", () => ({ releaseDraftAttachments: vi.fn() }));

const environmentId = EnvironmentId.make("environment-local");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));

function undoNotice() {
  const notice = useThreadUndoNotice.getState().notice;
  if (!notice) throw new Error("Undo notice is missing");
  return notice;
}

beforeEach(() => {
  vi.useFakeTimers();
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    environmentDraftIdByEnvironmentId: {},
  });
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("discardComposerDraft", () => {
  it("keeps text typed after the discard and releases the old uploads", async () => {
    useComposerDraftStore.getState().setPrompt(threadRef, "old reply");
    discardComposerDraft(threadRef);
    useComposerDraftStore.getState().setPrompt(threadRef, "new reply");
    const addToast = vi.spyOn(toastManager, "add").mockReturnValue("error-toast");

    await undoNotice().undo();
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe("new reply");
    expect(releaseDraftAttachments).toHaveBeenCalledOnce();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to restore draft" }),
    );
  });
});
