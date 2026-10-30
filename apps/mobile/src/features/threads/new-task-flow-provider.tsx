import { ActiveNewTaskContext } from "../../state/active-new-task";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useNowMinuteMs } from "../../lib/clock";
import React, { useEffect } from "react";

import type {
  EnvironmentId,
  ModelSelection,
  ProviderInteractionMode,
  ProviderOptionSelection,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { threadContextsOutsideEnvironment } from "@t3tools/shared/composerContextReferences";

import { useServerConfigs } from "../../state/entities";
import type { TurnCommandMetadata } from "../../lib/commandMetadata";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  buildModelOptions,
  groupByProvider,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
} from "../../lib/modelOptions";
import { useAtomValue } from "@effect/atom-react";
import { appAtomRegistry } from "../../state/atom-registry";
import { useLinkedEnvironments } from "../../state/peerLinks";
import {
  appendComposerDraftAttachments,
  type ComposerDraftInsertion,
  type ComposerDraftWorkspaceSelection,
  composerDraftsLoadedAtom,
  createNewTaskDraft,
  getComposerDraftSnapshot,
  isNewTaskDraftKey,
  removeComposerDraftAttachment,
  replaceComposerDraftAttachments,
  retargetNewTaskDraft,
  setComposerDraftText,
  setStickyComposerModelSelection,
  updateComposerDraftSettings,
  useComposerDraft,
  useStickyComposerModelSelection,
} from "../../state/use-composer-drafts";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import { type QueuedThreadMessage } from "../../state/thread-outbox";
import {
  resolvePendingTaskInteractionMode,
  resolveProviderInteractionMode,
} from "../../state/legacy-plan-mode";
import { useLegacyPlanModeState } from "./use-legacy-plan-mode-enabled";
import {
  INACTIVE_FLOW_KEY,
  type NewTaskFlowState,
  newTaskFlowStateAtom,
  readNewTaskFlowState,
  resolveRouteDraft,
  type RouteDraftResolution,
  stampedEnvironmentLoading,
  updateNewTaskFlowState,
} from "./new-task-flow-state";
import { useEnvironmentShellReadiness } from "../../state/shell";
import { useConnectionsReady, useWorkspaceEnvironments } from "../../state/workspace";

type WorkspaceMode = "local";

type NewTaskFlowContextValue = {
  readonly activeNewTask: { readonly pendingKey: string | null } | null;
  readonly workingDirectory: string | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedModelKey: string | null;
  readonly workspaceMode: WorkspaceMode;
  readonly resolveWorkspaceSelection: (
    selection: ComposerDraftWorkspaceSelection | undefined,
  ) => ComposerDraftWorkspaceSelection;
  readonly draftKey: string | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly submitting: boolean;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly planModeEnabled: boolean;
  readonly expandedProvider: string | null;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>;
  /** The machines the selected project's environment links to, whose threads it can read. */
  readonly linkedEnvironments: ReadonlyMap<EnvironmentId, string>;
  readonly modelOptions: ReadonlyArray<ModelOption>;
  readonly selectedModel: ModelSelection | null;
  readonly selectedModelOption: ModelOption | null;
  readonly selectedProviderStatus: ServerProvider | null;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  /** The flow's project, read when a continuation resumes after an await. */
  readonly getSelectedEnvironmentId: () => string | null;
  /**
   * The draft id of the route this flow serves when that draft, or its
   * project, is gone. Only the topmost draft route is served, so a screen
   * compares this with its own draft id.
   */
  readonly missingRouteDraftId: string | null;
  readonly selectEnvironment: (environmentId: EnvironmentId) => void;
  readonly switchEnvironment: (environmentId: EnvironmentId) => Promise<boolean>;
  readonly setSelectedModelKey: (
    key: string | null,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => void;
  readonly buildPendingTaskMessage: (
    metadata: TurnCommandMetadata,
    options?: {},
  ) => QueuedThreadMessage | null;
  readonly setPrompt: (value: string) => void;
  readonly replaceAttachments: (attachments: ReadonlyArray<DraftComposerAttachment>) => void;
  /** Appends draft attachments; returns how many the live cap rejected. */
  readonly appendAttachments: (
    attachments: ReadonlyArray<DraftComposerAttachment>,
    insertion?: ComposerDraftInsertion,
  ) => number;
  readonly removeAttachment: (imageId: string) => void;
  readonly clearAttachments: () => void;
  readonly setSubmitting: (value: boolean) => void;
  readonly setRuntimeMode: (value: RuntimeMode) => void;
  readonly setInteractionMode: (value: ProviderInteractionMode) => void;
  readonly setSelectedModelOptions: (
    value: ReadonlyArray<ProviderOptionSelection> | undefined,
  ) => void;
  readonly setExpandedProvider: (value: string | null) => void;
};

const NewTaskFlowContext = React.createContext<NewTaskFlowContextValue | null>(null);

export function NewTaskFlowProvider(
  props: React.PropsWithChildren<{
    active?: boolean;
    /** Identifies the draft route this flow serves; a new key starts a fresh flow. */
    flowKey?: string;
    routeDraftId?: string;
  }>,
) {
  const { enabled: legacyPlanModeEnabled } = useLegacyPlanModeState();

  const flowKey = props.flowKey ?? INACTIVE_FLOW_KEY;
  const storedFlowState = useAtomValue(newTaskFlowStateAtom(flowKey));
  const draftsLoaded = useAtomValue(composerDraftsLoadedAtom);
  // A draft route opened from a list row, a deep link, or restored state binds
  // its draft here until the flow's first write stores the binding.
  const routeDraft = useComposerDraft(
    storedFlowState.draftKey === null ? (props.routeDraftId ?? null) : null,
  );
  // Readiness of the environment the route's draft is stamped to; another
  // environment's projects loading first says nothing about it.
  const workspaceEnvironments = useWorkspaceEnvironments();
  const stampedEnvironmentId = routeDraft.environmentStamp?.environmentId ?? null;
  const connectionsReady = useConnectionsReady();
  const stampedEnvironmentConnection =
    useWorkspaceEnvironments().find(
      (environment) => environment.environmentId === stampedEnvironmentId,
    )?.connectionState ?? null;
  const stampedEnvironmentShell = useEnvironmentShellReadiness(stampedEnvironmentId);
  const stampedLoading = stampedEnvironmentLoading({
    connectionsReady,
    connectionState: stampedEnvironmentConnection,
    shellCacheRead: stampedEnvironmentShell.cacheRead,
    shellStatus: stampedEnvironmentShell.status,
    shellHasError: stampedEnvironmentShell.hasError,
  });
  const resolveRoute = (
    flow: NewTaskFlowState,
    loaded: boolean,
    stamp: Parameters<typeof resolveRouteDraft>[0]["stamp"],
  ): RouteDraftResolution =>
    resolveRouteDraft({
      flow,
      routeDraftId: props.routeDraftId,
      draftsLoaded: loaded,
      stamp,
      environments: workspaceEnvironments,
      stampedEnvironmentLoading: stampedLoading,
    });
  const routeDraftResolution = resolveRoute(
    storedFlowState,
    draftsLoaded,
    routeDraft.environmentStamp,
  );
  const flowState =
    routeDraftResolution.kind === "open" ? routeDraftResolution.flow : storedFlowState;
  const {
    environmentId: selectedEnvironmentIdOverride,
    draftKey: activeDraftKey,
    submitting,
    expandedProvider,
  } = flowState;
  // Continuations read the flow at use time, with the route's draft applied.
  const readFlow = (): NewTaskFlowState => {
    const stored = readNewTaskFlowState(flowKey);
    const resolution = resolveRoute(
      stored,
      appAtomRegistry.get(composerDraftsLoadedAtom),
      props.routeDraftId === undefined
        ? undefined
        : getComposerDraftSnapshot(props.routeDraftId).environmentStamp,
    );
    return resolution.kind === "open" ? resolution.flow : stored;
  };
  // Every flow write stores the route's draft binding along with it, so the
  // binding outlives the draft's project stamp (submit clears it).
  const updateFlow = (patch: Partial<NewTaskFlowState>) =>
    updateNewTaskFlowState(flowKey, { ...readFlow(), ...patch });
  const selectedEnvironmentId =
    selectedEnvironmentIdOverride ?? workspaceEnvironments[0]?.environmentId ?? null;
  const linkedEnvironments = useLinkedEnvironments(selectedEnvironmentId);
  const serverConfigs = useServerConfigs();
  const selectedEnvironmentServerConfig = selectedEnvironmentId
    ? (serverConfigs.get(selectedEnvironmentId) ?? null)
    : null;
  const environments = workspaceEnvironments.map((environment) => ({
    environmentId: environment.environmentId,
    environmentLabel: environment.environmentLabel,
  }));
  const selectedDraftKey = selectedEnvironmentId ? activeDraftKey : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the persistent draft in the new-task flow store once a project is selected, before the composer mounts
  useEffect(() => {
    // A route that names a draft binds that draft, or returns to the picker.
    if (
      props.active === false ||
      props.routeDraftId !== undefined ||
      activeDraftKey !== null ||
      selectedEnvironmentId === null
    ) {
      return;
    }
    // Creates the persistent draft once the project selection is ready; the key must exist before the composer mounts.
    updateNewTaskFlowState(flowKey, {
      draftKey: createNewTaskDraft({
        environmentId: selectedEnvironmentId,
      }),
    });
  }, [activeDraftKey, flowKey, selectedEnvironmentId, props.active, props.routeDraftId]);
  const activePendingKey =
    props.active === false
      ? null
      : props.routeDraftId
        ? `draft-task:${props.routeDraftId}`
        : selectedDraftKey
          ? `draft-task:${selectedDraftKey}`
          : null;
  const activeNewTask = props.active === false ? null : { pendingKey: activePendingKey };
  const selectedDraft = useComposerDraft(selectedDraftKey);
  const prompt = selectedDraft.text;
  const attachments = selectedDraft.attachments;
  const resolveWorkspaceSelection = (
    selection: ComposerDraftWorkspaceSelection | undefined,
  ): ComposerDraftWorkspaceSelection =>
    selection ?? { mode: "local", workingDirectory: selectedEnvironmentServerConfig?.cwd ?? null };
  const workspaceSelection = resolveWorkspaceSelection(selectedDraft.workspaceSelection);
  const workspaceMode = workspaceSelection.mode;
  // Keep the user's explicit choice separate from the resolved display value:
  // only the explicit flag is ever written back to the draft, so the resolved
  // value keeps tracking the server setting when the config loads late.
  const defaultRuntimeMode =
    selectedEnvironmentServerConfig?.settings.defaultRuntimeMode ?? "full-access";
  const runtimeMode = selectedDraft.runtimeMode ?? defaultRuntimeMode;

  // Antigravity keeps unavailable selections so sign-out or a catalog change
  // cannot switch the user's model.
  const draftModelSelection = resolveSelectableModelSelection(
    selectedEnvironmentServerConfig,
    selectedDraft.modelSelection ?? null,
  );
  const modelSelectionNow = useNowMinuteMs();
  const defaultModelSelection = resolveDefaultableModelSelection(
    selectedEnvironmentServerConfig,
    selectedEnvironmentServerConfig?.settings.defaultModelSelection ?? null,
  );
  const storedStickyModelSelection = useStickyComposerModelSelection();
  const stickyModelSelection = resolveDefaultableModelSelection(
    selectedEnvironmentServerConfig,
    storedStickyModelSelection,
  );
  const modelOptions = buildModelOptions(
    selectedEnvironmentServerConfig,
    draftModelSelection ?? defaultModelSelection ?? stickyModelSelection,
    undefined,
  );

  const selectedDefaultModel = resolveNewTaskModelSelection({
    draftSelection: draftModelSelection,
    defaultSelection: defaultModelSelection,
    stickySelection: stickyModelSelection,
    modelOptions,
  });
  const selectedModel = resolveNewThreadModelSelection({
    defaultSelection: selectedDefaultModel,
    explicitSelection: draftModelSelection ?? (defaultModelSelection ? null : stickyModelSelection),
    fallbackSelection: selectedEnvironmentServerConfig?.settings.fallbackModelSelection ?? null,
    providers: selectedEnvironmentServerConfig?.providers ?? [],
    ...(selectedEnvironmentServerConfig
      ? { settings: selectedEnvironmentServerConfig.settings }
      : {}),
    now: modelSelectionNow,
  }).selection;
  const selectedModelKey = selectedModel
    ? `${selectedModel.instanceId}:${selectedModel.model}`
    : null;

  const selectedModelOption =
    modelOptions.find(
      (option) =>
        selectedModel &&
        option.selection.instanceId === selectedModel.instanceId &&
        option.selection.model === selectedModel.model,
    ) ?? null;
  const selectedProviderStatus =
    selectedEnvironmentServerConfig?.providers.find(
      (provider) => provider.instanceId === selectedModel?.instanceId,
    ) ?? null;
  const planModeEnabled =
    legacyPlanModeEnabled && selectedProviderStatus?.showInteractionModeToggle !== false;
  const interactionMode = planModeEnabled
    ? (selectedDraft.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE)
    : DEFAULT_PROVIDER_INTERACTION_MODE;
  const setSelectedModelKey = (
    key: string | null,
    options?: ReadonlyArray<ProviderOptionSelection>,
  ) => {
    if (!key || !selectedDraftKey) {
      return;
    }
    const option = modelOptions.find((candidate) => candidate.key === key);
    if (!option) {
      return;
    }
    const selection = withRememberedModelOptions(
      options ? { ...option.selection, options } : option.selection,
    );
    const provider = selectedEnvironmentServerConfig?.providers.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    updateComposerDraftSettings(selectedDraftKey, {
      modelSelection: selection,
      ...(provider?.showInteractionModeToggle === false
        ? { interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE }
        : {}),
    });
    setStickyComposerModelSelection(selection);
  };
  const setSelectedModelOptions = (options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
    if (!selectedModel || !selectedDraftKey) {
      return;
    }
    rememberModelOptions(selectedModel.instanceId, selectedModel.model, options ?? []);
    const nextSelection: ModelSelection = options
      ? { ...selectedModel, options }
      : {
          instanceId: selectedModel.instanceId,
          model: selectedModel.model,
        };
    updateComposerDraftSettings(selectedDraftKey, {
      modelSelection: nextSelection,
    });
    setStickyComposerModelSelection(nextSelection);
  };

  const providerGroups = groupByProvider(modelOptions);
  const setPrompt = (value: string) => {
    if (!selectedDraftKey) {
      return;
    }
    setComposerDraftText(selectedDraftKey, value);
  };
  const replaceAttachments = (nextAttachments: ReadonlyArray<DraftComposerAttachment>) => {
    if (!selectedDraftKey) {
      return;
    }
    replaceComposerDraftAttachments(selectedDraftKey, nextAttachments);
  };
  const appendAttachments = (
    nextAttachments: ReadonlyArray<DraftComposerAttachment>,
    insertion?: ComposerDraftInsertion,
  ): number => {
    if (!selectedDraftKey) {
      return 0;
    }
    return appendComposerDraftAttachments(selectedDraftKey, nextAttachments, {
      appendReference: true,
      insertion,
    });
  };
  const removeAttachment = (imageId: string) => {
    if (!selectedDraftKey) {
      return;
    }
    removeComposerDraftAttachment(selectedDraftKey, imageId);
  };
  const clearAttachments = () => {
    if (!selectedDraftKey) {
      return;
    }
    replaceComposerDraftAttachments(selectedDraftKey, []);
  };

  const selectEnvironment = (environmentId: EnvironmentId) => {
    const current = readFlow().draftKey;
    const target = { environmentId };
    if (current !== null && isNewTaskDraftKey(current)) retargetNewTaskDraft(current, target);
    updateFlow({ environmentId, draftKey: current ?? createNewTaskDraft(target) });
  };
  const switchEnvironment = async (environmentId: EnvironmentId): Promise<boolean> => {
    selectEnvironment(environmentId);
    return true;
  };
  const setRuntimeMode = (value: RuntimeMode) => {
    if (selectedDraftKey) {
      updateComposerDraftSettings(selectedDraftKey, { runtimeMode: value });
    }
  };
  const setInteractionMode = (value: ProviderInteractionMode) => {
    if (selectedDraftKey) {
      updateComposerDraftSettings(selectedDraftKey, {
        interactionMode: resolveProviderInteractionMode(selectedProviderStatus, value),
      });
    }
  };

  const buildPendingTaskMessage = (metadata: TurnCommandMetadata): QueuedThreadMessage | null => {
    if (!selectedEnvironmentId || !selectedDraftKey) {
      return null;
    }
    const draft = getComposerDraftSnapshot(selectedDraftKey);
    const text = draft.text.trim();
    const draftModelSelection =
      resolveSelectableModelSelection(
        selectedEnvironmentServerConfig,
        draft.modelSelection ?? null,
      ) ?? selectedModel;
    if ((text.length === 0 && draft.attachments.length === 0) || !draftModelSelection) {
      return null;
    }
    if (
      threadContextsOutsideEnvironment({
        text: draft.text,
        records: draft.context?.records ?? [],
        environmentId: selectedEnvironmentId,
        linkedEnvironments,
      }).length > 0
    ) {
      return null;
    }
    const workspaceSelection = resolveWorkspaceSelection(draft.workspaceSelection);
    const mode = workspaceSelection.mode;
    return {
      environmentId: selectedEnvironmentId,
      threadId: ThreadId.make(metadata.threadId),
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      text,
      attachments: draft.attachments,
      context: draft.context,
      modelSelection: draftModelSelection,
      runtimeMode: draft.runtimeMode ?? defaultRuntimeMode,
      interactionMode: resolvePendingTaskInteractionMode({
        planModeEnabled: legacyPlanModeEnabled,
        draftInteractionMode: draft.interactionMode,
        provider: selectedEnvironmentServerConfig?.providers.find(
          (candidate) => candidate.instanceId === draftModelSelection.instanceId,
        ),
      }),
      creation: {
        defaultCwd: selectedEnvironmentServerConfig?.cwd ?? "",
        workspaceMode: mode,
        workingDirectory: workspaceSelection?.workingDirectory ?? null,
      },
      createdAt: metadata.createdAt,
    };
  };

  const value = {
    activeNewTask,
    selectedEnvironmentId,
    selectedModelKey,
    workspaceMode,
    resolveWorkspaceSelection,
    draftKey: selectedDraftKey,
    prompt,
    attachments,
    submitting,
    runtimeMode,
    interactionMode,
    planModeEnabled,
    expandedProvider,
    environments,
    workingDirectory: selectedEnvironmentServerConfig?.cwd ?? null,
    linkedEnvironments,
    modelOptions,
    selectedModel,
    selectedModelOption,
    selectedProviderStatus,
    providerGroups,
    getSelectedEnvironmentId: () => readFlow().environmentId,
    missingRouteDraftId:
      routeDraftResolution.kind === "missing" ? (props.routeDraftId ?? null) : null,
    selectEnvironment,
    switchEnvironment,
    setSelectedModelKey,
    buildPendingTaskMessage,
    setPrompt,
    replaceAttachments,
    appendAttachments,
    removeAttachment,
    clearAttachments,
    setSubmitting: (value: boolean) => updateFlow({ submitting: value }),
    setRuntimeMode,
    setInteractionMode,
    setSelectedModelOptions,
    setExpandedProvider: (value: string | null) => updateFlow({ expandedProvider: value }),
  } satisfies NewTaskFlowContextValue;

  return (
    <ActiveNewTaskContext value={activeNewTask}>
      <NewTaskFlowContext.Provider value={value}>{props.children}</NewTaskFlowContext.Provider>
    </ActiveNewTaskContext>
  );
}

export function useNewTaskFlow() {
  const value = React.use(NewTaskFlowContext);
  if (value === null) {
    throw new Error("useNewTaskFlow must be used within NewTaskFlowProvider.");
  }
  return value;
}
