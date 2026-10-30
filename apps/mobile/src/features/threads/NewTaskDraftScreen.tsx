import { DraftEnvironmentControl } from "./DraftEnvironmentControl";
import { NativeScrollEdgeEffectsContext } from "../../native/NativeScrollViewMarker";
import { DraftThreadHeader } from "./DraftThreadHeader";
import { threadHeaderAppearance } from "./thread-header-appearance";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useComposerAttachmentActions } from "../../state/use-composer-attachment-actions";
import { useWorkspaceBackNavigation } from "../workspace/useAndroidWorkspaceNavigation";
import { submittedThreadParams } from "./thread-route-state";
import { ThreadScreenBinding, ThreadScreenFallback } from "./ThreadScreenHost";
import { draftThreadShell } from "./draft-thread-shell";
import { connectionTone } from "../connection/connectionTone";
import { AppBar } from "../../components/ui/AppBar";
import { ThreadId } from "@t3tools/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommonActions, useNavigation, usePreventRemove, useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";
import { Platform, View } from "react-native";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { KeyboardController } from "react-native-keyboard-controller";

import {
  AuthOrchestrationOperateScope,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";

import { ComposerEditor, type ComposerEditorHandle } from "../../components/ComposerEditor";
import { composerContextImportsAtom } from "../../state/use-composer-drafts";
import { abortComposerDraftOperations } from "../../state/composerDraftOperations";
import { composerContextSendBlockReason } from "../../lib/composerContext";
import { AppText as Text } from "../../components/ui/AppText";
import { threadContextsOutsideEnvironment } from "@t3tools/shared/composerContextReferences";

import { makeTurnCommandMetadata } from "../../lib/commandMetadata";

import {
  clearComposerDraftContent,
  getComposerDraftSnapshot,
  scheduleUnusedComposerAttachmentCleanup,
} from "../../state/use-composer-drafts";
import { useEnvironmentServerConfig } from "../../state/entities";
import {
  describeUnavailableModelSelection,
  isModelSelectionUnavailable,
  resolveSelectableModelSelection,
} from "../../lib/modelOptions";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import {
  useRemoteConnections,
  useRemoteEnvironmentRuntime,
} from "../../state/use-remote-environment-registry";
import { useNewTaskFlow } from "./new-task-flow-provider";
import {
  nextEnvironmentId,
  useHardwareKeyboardCommand,
} from "../keyboard/hardwareKeyboardCommands";
import { incomingShareImports, useIncomingShare } from "../sharing/IncomingShareProvider";
import { idleShareFlagAtom, idleShareImportPhaseAtom } from "./incomingShareImport";
import { newTaskFlowKey } from "./new-task-flow-state";
import { appAtomRegistry } from "../../state/atom-registry";

import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";

export function NewTaskDraftScreen(props: {
  readonly initialEnvironmentRef?: {
    readonly environmentId?: string;
    readonly workingDirectory?: string | null;
    readonly cloning?: boolean;
  };
  readonly draftId?: string;
  readonly incomingShareId?: string;
}) {
  const [creationMetadata] = useState(makeTurnCommandMetadata);
  const flow = useNewTaskFlow();
  const navigation = useNavigation();
  const goBack = useWorkspaceBackNavigation("threads");
  const currentRoute = useRoute();
  const flowKey = newTaskFlowKey(currentRoute);
  const { getShare, isLoading: isIncomingShareInboxLoading } = useIncomingShare();
  const { onReconnectEnvironment } = useRemoteConnections();
  const environmentRuntime = useRemoteEnvironmentRuntime(flow.selectedEnvironmentId);
  const connectionState = environmentRuntime?.connectionState ?? "offline";
  const selectedEnvironmentServerConfig = useEnvironmentServerConfig(flow.selectedEnvironmentId);
  const environmentConnected = connectionState === "connected";
  const canOperate = useEnvironmentScope(flow.selectedEnvironmentId, AuthOrchestrationOperateScope);
  const promptInputRef = useRef<ComposerEditorHandle>(null);
  const incomingShare = props.incomingShareId ? getShare(props.incomingShareId) : null;
  const isIncomingShareAwaitingServerConfig = Boolean(
    incomingShare?.attachments.some((attachment) => attachment.type === "file") &&
    selectedEnvironmentServerConfig === null,
  );
  const routeImportedShare = useAtomValue(
    flowKey !== undefined && props.incomingShareId
      ? incomingShareImports.importedAtom(flowKey, props.incomingShareId)
      : idleShareFlagAtom,
  );
  const hasImportedIncomingShare = Boolean(
    props.incomingShareId &&
    (routeImportedShare ||
      (flow.draftKey &&
        getComposerDraftSnapshot(flow.draftKey).importedShareIds?.includes(props.incomingShareId))),
  );
  const isIncomingShareUnavailable = Boolean(
    props.incomingShareId &&
    !isIncomingShareInboxLoading &&
    !incomingShare &&
    !hasImportedIncomingShare,
  );
  const shareImportTarget = (() => {
    if (!props.incomingShareId || flowKey === undefined || !flow.draftKey) return null;
    if (!flow.selectedEnvironmentId || !incomingShare || isIncomingShareAwaitingServerConfig)
      return null;
    return {
      flowKey,
      routeKey: currentRoute.key,
      draftKey: flow.draftKey,
      destination: {
        environmentId: String(flow.selectedEnvironmentId),
      },
      shareId: incomingShare.id,
    };
  })();
  const shareImportPhase = useAtomValue(
    shareImportTarget === null
      ? idleShareImportPhaseAtom
      : incomingShareImports.phaseAtom(shareImportTarget),
  );
  // Locks on the route, not the target: the target turns null when server config
  // drops or the project stops matching, while the import keeps writing the draft.
  const isImportingShare = useAtomValue(
    flowKey === undefined ? idleShareFlagAtom : incomingShareImports.inFlightAtom(flowKey),
  );
  const isIncomingShareTransferPending = Boolean(
    incomingShare && shareImportPhase !== "cancelled" && !isIncomingShareAwaitingServerConfig,
  );
  // A failed import waits in a modal alert, and a cancel finishes its undo even
  // after the route leaves, so neither holds the route: the cancel can leave as
  // soon as it is done.
  const isIncomingShareHoldingRoute =
    isIncomingShareTransferPending &&
    shareImportPhase !== "failed" &&
    shareImportPhase !== "cancelling";
  const contextImports = useAtomValue(composerContextImportsAtom);
  const isImportingContext = flow.draftKey ? contextImports[flow.draftKey] === true : false;
  const isComposerInteractionLocked =
    isIncomingShareTransferPending || flow.submitting || isImportingContext;
  const { environments, selectedEnvironmentId, switchEnvironment } = flow;
  const cycleEnvironment = () => {
    if (isComposerInteractionLocked) return true;
    const next = nextEnvironmentId(environments, selectedEnvironmentId);
    if (next !== null) void switchEnvironment(next);
    return true;
  };
  const cycleEnvironmentCommands = environments.length > 1 ? (["cycleHost"] as const) : [];
  useHardwareKeyboardCommand(cycleEnvironmentCommands, cycleEnvironment);
  const composerWorkspaceCwd = flow.workingDirectory;
  const preventRemove = isIncomingShareHoldingRoute || flow.submitting;
  usePreventRemove(preventRemove, () => undefined);
  const isIncomingShareReady =
    !props.incomingShareId ||
    (hasImportedIncomingShare && !incomingShare) ||
    isIncomingShareUnavailable;
  const selectedEnvironmentLabel =
    flow.environments.find(
      (environment) => environment.environmentId === flow.selectedEnvironmentId,
    )?.environmentLabel ?? "Environment";

  const {
    onPickDraftMedia: handlePickMedia,
    onPickDraftFiles: handlePickFiles,
    onNativePasteImages: handleNativePasteImages,
    onNativePasteText: handleNativePasteText,
  } = useComposerAttachmentActions({
    draftKey: flow.draftKey,
    serverConfig: selectedEnvironmentServerConfig,
    locked: isComposerInteractionLocked,
  });

  async function handleStart(): Promise<import("@t3tools/contracts").MessageId | null> {
    const draftKey = flow.draftKey;
    if (
      !flow.selectedEnvironmentId ||
      !draftKey ||
      !isIncomingShareReady ||
      isImportingShare ||
      isComposerInteractionLocked
    ) {
      return null;
    }
    if (
      environmentConnected &&
      !readEnvironmentScope(flow.selectedEnvironmentId, AuthOrchestrationOperateScope)
    ) {
      return null;
    }
    const draft = getComposerDraftSnapshot(draftKey);
    if (appAtomRegistry.get(composerContextImportsAtom)[draftKey]) return null;
    const modelSelection =
      resolveSelectableModelSelection(
        selectedEnvironmentServerConfig,
        draft.modelSelection ?? null,
      ) ?? flow.selectedModel;
    if (modelSelection === null) return null;
    if (
      environmentConnected &&
      isModelSelectionUnavailable(selectedEnvironmentServerConfig, modelSelection)
    ) {
      const { title, detail } = describeUnavailableModelSelection(
        selectedEnvironmentServerConfig,
        modelSelection,
      );
      Dialog.alert(title, detail);
      return null;
    }
    // Recovery may retain over-cap attachments; block send before uploading a turn the server would reject.
    if (draft.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      Dialog.alert(
        "Too many attachments",
        `Remove attachments until there are at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}.`,
      );
      return null;
    }

    const contextBlockReason = composerContextSendBlockReason(draft.context);
    if (contextBlockReason) {
      Dialog.alert("Too much context", contextBlockReason);
      return null;
    }
    const strandedThread = threadContextsOutsideEnvironment({
      text: draft.text,
      records: draft.context?.records ?? [],
      environmentId: flow.selectedEnvironmentId,
      linkedEnvironments: flow.linkedEnvironments,
    })[0];
    if (strandedThread) {
      const owner =
        flow.environments.find(
          (environment) => environment.environmentId === strandedThread.environmentId,
        )?.environmentLabel ?? "its machine";
      Dialog.alert(
        "Attached thread unavailable",
        `"${strandedThread.title}" is on another machine. Switch back to ${owner} or remove it from the draft.`,
      );
      return null;
    }

    const message = flow.buildPendingTaskMessage(creationMetadata, {});
    if (!message) {
      return null;
    }
    // Persist locally before clearing or leaving the draft; server setup runs on the thread.
    flow.setSubmitting(true);
    const queued = await settlePromise(() => enqueueThreadOutboxMessage(message));
    flow.setSubmitting(false);
    if (AsyncResult.isFailure(queued)) {
      const error = squashAtomCommandFailure(queued);
      Dialog.alert(
        "Could not queue task",
        error instanceof Error ? error.message : "The task could not be saved to the outbox.",
      );
      return null;
    }
    promptInputRef.current?.blur();
    navigation.dispatch(
      CommonActions.setParams(
        submittedThreadParams(String(message.environmentId), String(message.threadId)),
      ),
    );
    // The composer has moved to the submitted thread; a pick still converting
    // would otherwise resurrect this draft.
    abortComposerDraftOperations(draftKey);
    const draftSnapshot = getComposerDraftSnapshot(draftKey);
    // The queued message owns the attachments now, so the sweep is deferred
    // until the write confirms it.
    clearComposerDraftContent(draftKey, {
      clearModelSelection: true,
      clearWorkspaceSelection: true,
      deferAttachmentCleanup: true,
    });
    scheduleUnusedComposerAttachmentCleanup(draftSnapshot.attachments);
    return message.messageId;
  }

  // Keep the current surface until the local draft selection is ready. Publishing
  // an empty loading surface here flashes between two already-cached threads.
  if (!flow.selectedEnvironmentId) return null;

  const setupBlockReason =
    isIncomingShareReady && !isImportingShare
      ? flow.submitting
        ? "Starting the thread…"
        : null
      : "Wait for shared content to finish importing.";
  const openContextPicker = (routeName: "NewTaskEnvironment") => {
    if (isComposerInteractionLocked) {
      return;
    }
    promptInputRef.current?.blur();
    void KeyboardController.dismiss({ animated: true });
    navigation.navigate(routeName);
  };

  const environmentControl = (
    <DraftEnvironmentControl
      connectionState={connectionState}
      label={selectedEnvironmentLabel}
      machineKind={resolveEnvironmentMachineKind(selectedEnvironmentServerConfig)}
      disabled={isComposerInteractionLocked}
      onChooseEnvironment={() => openContextPicker("NewTaskEnvironment")}
    />
  );
  const shareUnavailableNotice = isIncomingShareUnavailable ? (
    <Text textRole="footnote" className="text-center text-foreground-muted">
      The shared content is no longer in the inbox. You can continue editing this task draft.
    </Text>
  ) : null;
  const hero = (
    <View className="items-center gap-6 px-6" testID="new-task-hero">
      <Text className="text-center text-2xl font-t3-medium tracking-tight text-foreground">
        What should we work on?
      </Text>
      {environmentControl}
      {shareUnavailableNotice}
    </View>
  );
  // The nested hero scroll view does not receive UIKit's automatic navigation inset in split columns.
  const heroViewport = (headerInset: number, bottomInset: number, availableHeight: number) =>
    availableHeight < 180 ? null : (
      <NativeScrollEdgeEffectsContext
        value={{ top: "hidden", bottom: "hidden", left: "hidden", right: "hidden" }}
      >
        <View
          collapsable={false}
          style={{
            position: "absolute",
            top: headerInset,
            bottom: bottomInset,
            left: 0,
            right: 0,
            overflow: "hidden",
          }}
        >
          <ScrollView
            alwaysBounceVertical={false}
            className="flex-1"
            contentInsetAdjustmentBehavior="never"
            contentContainerClassName="grow items-center"
            contentContainerStyle={{ paddingVertical: 24 }}
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            testID="new-task-hero-scroll"
          >
            <View style={{ flexGrow: 1 }} />
            {hero}
            <View style={{ flexGrow: 2 }} />
          </ScrollView>
        </View>
      </NativeScrollEdgeEffectsContext>
    );

  if (!flow.selectedModel) {
    return (
      <ThreadScreenFallback
        header={
          <AppBar
            title="New thread"
            sidebar={false}
            onBack={goBack}
            options={{
              ...threadHeaderAppearance(NATIVE_LIQUID_GLASS_SUPPORTED),
              unstable_headerSubtitle: undefined,
              unstable_headerRightItems: () => [],
              unstable_headerToolbarItems: () => [],
            }}
          />
        }
      >
        <View className="flex-1 justify-end gap-3 p-4">
          {environmentControl}
          <Text className="text-foreground-muted">
            Your draft is saved on this device. Connect to an environment to choose its first model.
          </Text>
          <ComposerEditor
            draftKey={flow.draftKey}
            value={flow.prompt}
            onChangeText={flow.setPrompt}
            placeholder="Ask anything"
            multiline
            style={{ minHeight: 64 }}
          />
        </View>
      </ThreadScreenFallback>
    );
  }
  const thread = draftThreadShell({
    environmentId: flow.selectedEnvironmentId,
    threadId: ThreadId.make(creationMetadata.threadId),
    modelSelection: flow.selectedModel,
    runtimeMode: flow.runtimeMode,
    interactionMode: flow.interactionMode,
    workingDirectory: flow.workingDirectory,
    createdAt: creationMetadata.createdAt,
  });
  return (
    <>
      <ThreadScreenBinding
        environmentId={flow.selectedEnvironmentId}
        header={<DraftThreadHeader thread={thread} cwd={composerWorkspaceCwd} />}
        draftMode={{
          content: heroViewport,
          controls: environmentControl,
          editorRef: promptInputRef,
          sendBlockedReason: setupBlockReason,
          interactionLocked: isComposerInteractionLocked,
        }}
        canOperateThread={canOperate}
        selectedThread={thread}
        selectedThreadDetailRef={null}
        contentPresentation={{ kind: "ready" }}
        screenTone={connectionTone(connectionState)}
        connectionError={environmentRuntime?.connectionError ?? null}
        environmentLabel={selectedEnvironmentLabel}
        feedbackSubmissions={[]}
        onDismissFeedback={() => {}}
        selectedThreadFeed={[]}
        activityRun={null}
        activeWorkStartedAt={null}
        isCompacting={false}
        creationState={null}
        activePendingApproval={null}
        activePendingApprovals={[]}
        respondingApprovalId={null}
        activePendingUserInput={null}
        activePendingUserInputDrafts={{}}
        activePendingUserInputAnswers={null}
        respondingUserInputId={null}
        connectionStateLabel={connectionState}
        activeThreadBusy={false}
        canStopThread={false}
        queuedRunEdit={null}
        composerDraftKey={flow.draftKey}
        followUpBehavior="queue"
        canSteerActiveTurn={false}
        isSavingQueuedEdit={false}
        onCancelQueuedRunEdit={() => {}}
        onRemoveQueuedEditAttachment={() => {}}
        workspaceRoot={composerWorkspaceCwd ?? ""}
        threadCwd={composerWorkspaceCwd}
        selectedThreadQueueCount={0}
        queuedMessages={[]}
        dispatchingMessageId={null}
        serverConfig={selectedEnvironmentServerConfig}
        usesAutomaticContentInsets
        onOpenConnectionEditor={() => navigation.navigate("Connections")}
        onChangeDraftMessage={flow.setPrompt}
        onPickDraftMedia={handlePickMedia}
        onPickDraftFiles={handlePickFiles}
        onNativePasteImages={handleNativePasteImages}
        onNativePasteText={handleNativePasteText}
        onRemoveDraftImage={flow.removeAttachment}
        onStopThread={() => {}}
        onResumeQueue={null}
        onSendMessage={handleStart}
        onReconnectEnvironment={() => onReconnectEnvironment(thread.environmentId)}
        canSwitchThreadProvider
        onUpdateThreadInteractionMode={flow.planModeEnabled ? flow.setInteractionMode : undefined}
        onRespondToApproval={async () => {}}
        onSelectUserInputOption={() => {}}
        onChangeUserInputCustomAnswer={() => {}}
        onSubmitUserInput={async () => {}}
        onDismissUserInput={async () => {}}
      />
    </>
  );
}
