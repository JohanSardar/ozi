import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import type { ComposerThreadDraftState } from "../composerDraftStore";

type ComposerModelSelectionState = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider" | "modelSelectionExplicit"
>;

interface ThreadContextLike {
  environmentId: EnvironmentId;
}

interface NewThreadHandler {
  (
    environmentId: EnvironmentId,
    options?: {
      workingDirectory?: string | null;
    },
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultEnvironmentId: EnvironmentId | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewThreadModelSelectionOverride(input: {
  readonly projectDefaultSelection: ModelSelection | null;
  readonly carrySelection: ModelSelection | null;
  readonly carrySourceDraftId: string | null;
  readonly destinationDraftId: string;
}): ModelSelection | null {
  return (
    input.projectDefaultSelection ??
    (input.carrySourceDraftId === input.destinationDraftId ? null : input.carrySelection)
  );
}

export function hasExplicitComposerModelSelection(
  draft: ComposerModelSelectionState | null | undefined,
): boolean {
  const activeProvider = draft?.activeProvider;
  return (
    draft?.modelSelectionExplicit === true &&
    activeProvider !== null &&
    activeProvider !== undefined &&
    draft.modelSelectionByProvider[activeProvider] !== undefined
  );
}

export function resolveThreadActionEnvironmentId(
  context: ChatThreadActionContext,
): EnvironmentId | null {
  if (context.activeThread) {
    return context.activeThread.environmentId;
  }
  if (context.activeDraftThread) {
    return context.activeDraftThread.environmentId;
  }
  return context.defaultEnvironmentId;
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const environmentId = resolveThreadActionEnvironmentId(context);
  if (!environmentId) {
    return false;
  }

  await context.handleNewThread(environmentId);
  return true;
}
