import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_SERVER_SETTINGS, type EnvironmentId } from "@t3tools/contracts";
import { type AnyRouter, useRouter } from "@tanstack/react-router";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { composerDraftHasUserContent, useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { readThreadShell, useQuietThreadShell } from "../state/entities";
import { hasExplicitComposerModelSelection } from "../lib/chatThreadActions";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useThreadRouteTarget } from "./useThreadRouteTarget";
import { resolveEnvironmentDefaultModelSelection } from "../providerInstances";
import { usePrimaryEnvironmentId } from "../state/environments";

export function useNewThreadHandler() {
  return createNewThreadHandler(useRouter());
}

export type NewThreadHandler = ReturnType<typeof createNewThreadHandler>;

export function createNewThreadHandler(router: AnyRouter) {
  return async (
    environmentId: EnvironmentId,
    options?: { workingDirectory?: string | null; replace?: boolean; prompt?: string },
  ) => {
    const state = useComposerDraftStore.getState();
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
    const route = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
    const source = route?.kind === "server" ? readThreadShell(route.threadRef) : null;
    const sourceDraft = route?.kind === "draft" ? state.getDraftSession(route.draftId) : null;
    const composer = route
      ? state.getComposerDraft(route.kind === "server" ? route.threadRef : route.draftId)
      : null;
    const carry = composer?.activeProvider
      ? composer.modelSelectionByProvider[composer.activeProvider]
      : source?.modelSelection;
    const selection = resolveNewThreadModelSelection({
      defaultSelection:
        settings.defaultModelSelection ??
        (carry || state.stickyActiveProvider
          ? null
          : resolveEnvironmentDefaultModelSelection(config?.providers ?? [], settings)),
      fallbackSelection: settings.fallbackModelSelection,
      providers: config?.providers ?? [],
      settings,
      now: Date.now(),
    }).selection;
    const stored = state.getDraftSessionForEnvironment(environmentId);
    const reusable =
      stored &&
      stored.promotedTo == null &&
      readThreadShell(scopeThreadRef(stored.environmentId, stored.threadId)) === null &&
      !composerDraftHasUserContent(state.getComposerDraft(stored.draftId))
        ? stored
        : null;
    const draftId = reusable?.draftId ?? newDraftId();
    const threadId = reusable?.threadId ?? newThreadId();
    const alreadyOpen = route?.kind === "draft" && route.draftId === draftId;
    state.setEnvironmentDraftId(environmentId, draftId, {
      threadId,
      runtimeMode: alreadyOpen
        ? (reusable?.runtimeMode ?? settings.defaultRuntimeMode)
        : settings.defaultRuntimeMode,
      interactionMode:
        composer?.interactionMode ??
        source?.interactionMode ??
        sourceDraft?.interactionMode ??
        "default",
      workingDirectory:
        options?.workingDirectory !== undefined
          ? options.workingDirectory
          : alreadyOpen
            ? (reusable?.workingDirectory ?? null)
            : null,
    });
    if (!hasExplicitComposerModelSelection(state.getComposerDraft(draftId))) {
      state.applyStickyState(draftId);
      const picked =
        selection ?? (route?.kind === "draft" && route.draftId === draftId ? null : carry);
      if (picked) state.setModelSelection(draftId, picked, { replaceOptions: true });
    }
    if (
      options?.prompt !== undefined &&
      !composerDraftHasUserContent(state.getComposerDraft(draftId))
    )
      state.setPrompt(draftId, options.prompt);
    if (!alreadyOpen)
      await router.navigate({
        to: "/draft/$draftId",
        params: { draftId },
        replace: options?.replace ?? false,
      });
    return { draftId, threadId };
  };
}

export function useHandleNewThread() {
  const routeTarget = useThreadRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const activeThread = useQuietThreadShell(routeThreadRef);
  const activeDraftThread = useComposerDraftStore((state) =>
    routeDraftId
      ? state.getDraftSession(routeDraftId)
      : routeThreadRef
        ? state.getDraftThread(routeThreadRef)
        : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return {
    activeDraftThread,
    activeThread,
    defaultEnvironmentId: primaryEnvironmentId,
    handleNewThread: useNewThreadHandler(),
    routeDraftId,
    routeThreadRef,
  };
}
