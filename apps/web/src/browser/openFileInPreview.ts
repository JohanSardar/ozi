import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";

import {
  type AtomCommandResult,
  mapAtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { AsyncResult } from "effect/reactivity";

import { previewRuntimeFor } from "~/browser/previewRuntime";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  rememberPreviewUrl,
  setActivePreviewTab,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";

import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "./browserDefaults";

export class BrowserSettingsReadError extends Data.TaggedError("BrowserSettingsReadError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Saved browser settings could not be loaded.";
  }
}

export type OpenPreviewMutation<E = unknown> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;

export async function openUrlInPreview<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly profileId?: PreviewOpenInput["profileId"];
  readonly background?: boolean;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults));
  }
  const runtime = previewRuntimeFor(input.threadRef.environmentId);
  const previousActiveTabId = readThreadPreviewState(input.threadRef).activeTabId;
  // The server's "opened" event switches the preview tab but not the panel's
  // selection, so a changed selection means the user picked a tab themselves.
  const selectedSurface = () => readThreadPreviewState(input.threadRef).activeTabId;
  const surfaceBeforeOpen = selectedSurface();
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      url: input.url,
      viewport: browserDefaultOpenViewport(defaults),
      profileId: input.profileId ?? browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined ? {} : { runtime }),
    },
  });
  return mapAtomCommandResult(result, (snapshot) => {
    rememberPreviewUrl(input.threadRef, input.url);
    if (input.background) {
      updatePreviewServerSnapshot(input.threadRef, snapshot);
      // The server's "opened" event activates the new tab; hand focus back,
      // unless the user picked a tab, this one included, while the open was in flight.
      if (
        previousActiveTabId &&
        readThreadPreviewState(input.threadRef).activeTabId === snapshot.tabId &&
        selectedSurface() === surfaceBeforeOpen
      ) {
        setActivePreviewTab(input.threadRef, previousActiveTabId);
      }
      return;
    }
    applyPreviewServerSnapshot(input.threadRef, snapshot);
    setActivePreviewTab(input.threadRef, snapshot.tabId);
  });
}
