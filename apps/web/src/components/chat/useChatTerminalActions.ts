import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { Dispatch } from "react";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { selectThreadTerminalUiState } from "../../terminalUiStateStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { type SetStateAction } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { MAX_TERMINALS_PER_GROUP } from "../../types";
import { type RightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { confirmTerminalClose } from "../../lib/terminalCloseConfirm";
import { findReusableShellTerminal } from "../../lib/shellCommandTerminal";
import { type TerminalContextSelection } from "../../lib/terminalContext";
import {
  focusActiveDrawerTerminal,
  focusActivePanelTerminal,
  focusTerminal,
} from "../../lib/terminalFocus";
import { useTerminalUiStateStore } from "../../terminalUiStateStore";
import { makeThreadErrorSetter } from "../ChatView.logic";
import { readEnvironmentScope } from "../../state/session";
import type { ChatShortcutCommands } from "./useChatShortcuts";
const SHELL_TERMINAL_COLS = 120;
const SHELL_TERMINAL_ROWS = 30;

export interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  workingDirectory: string | null;
}

interface ChatTerminalActionsInput {
  readonly environmentId: EnvironmentId;
  readonly composerRef: ComposerHandleRef;
  readonly terminalUiState: ReturnType<typeof selectThreadTerminalUiState>;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeThreadId: ThreadId | null;
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly defaultCwd: string | null;
  readonly activeRightPanelSurface: RightPanelSurface | null;
  readonly runningTerminalIds: ReadonlyArray<string>;
  readonly activeServerOrderedTerminalIds: ReadonlyArray<string>;
  readonly activeTerminalLabelsById: ReadonlyMap<string, string>;
  readonly panelTerminalIds: ReadonlySet<string>;
  readonly canReuseTerminal: boolean;
  readonly setTerminalUiLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
}

/**
 * The thread's terminals: the drawer's and the right panel's, and project scripts and chat
 * code blocks, which run in a reused or new drawer terminal.
 */
export function useChatTerminalActions(input: ChatTerminalActionsInput) {
  const {
    environmentId,
    composerRef,
    terminalUiState,
    activeThread,
    activeThreadId,
    activeThreadRef,
    defaultCwd,
    activeRightPanelSurface,
    runningTerminalIds,
    activeServerOrderedTerminalIds,
    activeTerminalLabelsById,
    panelTerminalIds,
    canReuseTerminal,
    setTerminalUiLaunchContext,
    setThreadError,
  } = input;

  const hasTerminalWriteAccess = () =>
    readEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const storeSetTerminalOpen = useTerminalUiStateStore((s) => s.setTerminalOpen);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeSplitTerminal = useTerminalUiStateStore((s) => s.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore((s) => s.splitTerminalVertical);
  const storeNewTerminal = useTerminalUiStateStore((s) => s.newTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((s) => s.closeTerminal);
  const terminalActions = useThreadTerminalActions(activeThreadRef);

  const activeTerminalGroup =
    terminalUiState.terminalGroups.find(
      (group) => group.id === terminalUiState.activeTerminalGroupId,
    ) ??
    terminalUiState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalUiState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  /*__HOOK__*/
  const addTerminalContextToDraft = (selection: TerminalContextSelection) => {
    composerRef.current?.addTerminalContext(selection);
  };
  const addTerminalContextToDraftStable = useStableCallback(addTerminalContextToDraft);
  const setTerminalOpen = (open: boolean) => {
    if (!activeThreadRef) return;
    storeSetTerminalOpen(activeThreadRef, open);
    focusActiveDrawerTerminal(activeThreadRef);
  };
  const setTerminalOpenStable = useStableCallback(setTerminalOpen);
  const toggleTerminalVisibility = () => {
    if (!activeThreadRef) return;
    const nextOpen = !terminalUiState.terminalOpen;
    if (
      nextOpen &&
      !readEnvironmentScope(environmentId, AuthTerminalReadScope) &&
      !hasTerminalWriteAccess()
    )
      return;
    if (nextOpen && hasTerminalWriteAccess() && terminalUiState.terminalIds.length === 0) {
      // Server-created setup terminals exist before this client's drawer mounts.
      // Reuse them before allocating a shell from the still-empty UI state.
      const existingTerminalId =
        runningTerminalIds.find((id) => !panelTerminalIds.has(id)) ??
        activeServerOrderedTerminalIds.find((id) => !panelTerminalIds.has(id));
      if (existingTerminalId !== undefined) {
        storeEnsureTerminal(activeThreadRef, existingTerminalId, { open: true, active: true });
        focusActiveDrawerTerminal(activeThreadRef);
        return;
      }
      void terminalActions.launchTerminal({
        place: (terminalId) => storeEnsureTerminal(activeThreadRef, terminalId, { open: true }),
      })?.result;
      focusActiveDrawerTerminal(activeThreadRef);
      return;
    }
    setTerminalOpen(nextOpen);
  };
  const toggleTerminalVisibilityStable = useStableCallback(toggleTerminalVisibility);
  const splitTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (!activeThreadRef || hasReachedSplitLimit) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        direction === "vertical"
          ? storeSplitTerminalVertical(activeThreadRef, terminalId)
          : storeSplitTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    focusTerminal(activeThreadRef, launched.terminalId);
    void launched.result;
  };
  const splitTerminalStable = useStableCallback(splitTerminal);
  const createNewTerminal = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) => storeNewTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    focusTerminal(activeThreadRef, launched.terminalId);
    void launched.result;
  };
  const createNewTerminalStable = useStableCallback(createNewTerminal);
  const closeTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess() || !activeThreadRef) return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    focusActiveDrawerTerminal(activeThreadRef);
  };
  const runShellCommand = async (command: string) => {
    if (!hasTerminalWriteAccess() || !activeThreadId || !activeThread) return;
    const targetCwd = activeThread.workingDirectory ?? defaultCwd;
    if (!targetCwd) return;
    const targetWorkingDirectory = activeThread.workingDirectory;
    const reusableTerminalId =
      !canReuseTerminal || !readEnvironmentScope(environmentId, AuthTerminalReadScope)
        ? null
        : findReusableShellTerminal({
            // Server sessions cover drawer terminals this client has not opened yet, such as a
            // worktree setup shell; the helper drops the panel-owned ones.
            drawerTerminalIds: [
              ...new Set([...terminalUiState.terminalIds, ...activeServerOrderedTerminalIds]),
            ],
            activeTerminalId: terminalUiState.activeTerminalId,
            panelTerminalIds,
            runningTerminalIds,
          });

    setTerminalUiLaunchContext({
      threadId: activeThreadId,
      cwd: targetCwd,
      workingDirectory: targetWorkingDirectory,
    });
    if (!activeThreadRef) {
      return;
    }

    const launched = terminalActions.launchTerminal({
      // The drawer opens with the target already placed: opening it empty would claim
      // DEFAULT_THREAD_TERMINAL_ID, which a right-panel terminal may already own.
      place: (terminalId) =>
        reusableTerminalId === null
          ? storeNewTerminal(activeThreadRef, terminalId)
          : storeEnsureTerminal(activeThreadRef, terminalId, { open: true }),
      ...(reusableTerminalId === null
        ? { size: { cols: SHELL_TERMINAL_COLS, rows: SHELL_TERMINAL_ROWS } }
        : { terminalId: reusableTerminalId }),
      location: { cwd: targetCwd, workingDirectory: targetWorkingDirectory },
    });
    if (!launched) return;
    const targetTerminalId = launched.terminalId;
    focusTerminal(activeThreadRef, targetTerminalId);
    const openResult = await launched.result;
    if (openResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(openResult)) {
        const error = squashAtomCommandFailure(openResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to run command.",
        );
      }
      return;
    }

    const writeResult = await terminalActions.writeToTerminal(targetTerminalId, `${command}\r`);
    if (!writeResult) return;
    if (writeResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(writeResult)) {
        const error = squashAtomCommandFailure(writeResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to run command.",
        );
      }
      return;
    }
  };
  const runShellCommandStable = useStableCallback(runShellCommand);
  const addTerminalSurface = () => {
    if (!activeThreadRef) return;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore.getState().openTerminal(activeThreadRef, terminalId),
    });
    if (!launched) return;
    focusTerminal(activeThreadRef, launched.terminalId);
    void launched.result;
  };
  const addTerminalSurfaceStable = useStableCallback(addTerminalSurface);
  const splitPanelTerminal = (direction: "horizontal" | "vertical" = "horizontal") => {
    if (
      !activeThreadRef ||
      activeRightPanelSurface?.kind !== "terminal" ||
      activeRightPanelSurface.terminalIds.length >= MAX_TERMINALS_PER_GROUP
    ) {
      return;
    }
    const surfaceId = activeRightPanelSurface.id;
    const launched = terminalActions.launchTerminal({
      place: (terminalId) =>
        useRightPanelStore
          .getState()
          .splitTerminal(activeThreadRef, surfaceId, terminalId, direction),
    });
    if (!launched) return;
    focusTerminal(activeThreadRef, launched.terminalId);
    void launched.result;
  };
  const splitPanelTerminalStable = useStableCallback(splitPanelTerminal);
  const splitPanelTerminalVertical = () => {
    splitPanelTerminal("vertical");
  };
  const splitPanelTerminalVerticalStable = useStableCallback(splitPanelTerminalVertical);
  const activatePanelTerminal = (terminalId: string) => {
    if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
    useRightPanelStore
      .getState()
      .activateTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
    focusTerminal(activeThreadRef, terminalId);
  };
  const activatePanelTerminalStable = useStableCallback(activatePanelTerminal);
  const closePanelTerminal = (terminalId: string) => {
    if (
      !hasTerminalWriteAccess() ||
      !activeThreadRef ||
      activeRightPanelSurface?.kind !== "terminal"
    )
      return;
    terminalActions.closeTerminalSession(terminalId);
    storeCloseTerminal(activeThreadRef, terminalId);
    useRightPanelStore
      .getState()
      .closeTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
    // Closing a surface's last terminal falls back to a neighbouring surface,
    // which can be another terminal surface.
    focusActivePanelTerminal(activeThreadRef);
  };
  const closePanelTerminalStable = useStableCallback(closePanelTerminal);
  const requestCloseTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
    void confirmTerminalClose([label]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        closeTerminal(terminalId);
      }
    });
  };
  const requestCloseTerminalStable = useStableCallback(requestCloseTerminal);
  const requestClosePanelTerminal = (terminalId: string) => {
    if (!hasTerminalWriteAccess()) return;
    const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
    void confirmTerminalClose([label]).then((confirmed) => {
      if (confirmed && readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        closePanelTerminal(terminalId);
      }
    });
  };
  const requestClosePanelTerminalStable = useStableCallback(requestClosePanelTerminal);
  const openTerminalIfClosed = () => {
    if (!terminalUiState.terminalOpen) setTerminalOpen(true);
  };
  // A focused right-panel terminal takes the split/new/close chords; otherwise they act on the drawer.
  const shortcuts = {
    "terminal.toggle": () => {
      if (
        !terminalUiState.terminalOpen &&
        !readEnvironmentScope(environmentId, AuthTerminalReadScope) &&
        !hasTerminalWriteAccess()
      )
        return false;
      toggleTerminalVisibility();
    },
    "terminal.split": ({ terminalFocusOwner }) => {
      if (!hasTerminalWriteAccess()) return false;
      if (terminalFocusOwner === "right-panel") return void splitPanelTerminal();
      openTerminalIfClosed();
      splitTerminal();
    },
    "terminal.splitVertical": ({ terminalFocusOwner }) => {
      if (!hasTerminalWriteAccess()) return false;
      if (terminalFocusOwner === "right-panel") return void splitPanelTerminal("vertical");
      openTerminalIfClosed();
      splitTerminal("vertical");
    },
    "terminal.close": ({ terminalFocusOwner }) => {
      if (!hasTerminalWriteAccess()) return false;
      if (terminalFocusOwner === "right-panel" && activeRightPanelSurface?.kind === "terminal") {
        requestClosePanelTerminal(activeRightPanelSurface.activeTerminalId);
        return;
      }
      if (terminalUiState.terminalOpen) requestCloseTerminal(terminalUiState.activeTerminalId);
    },
    "terminal.new": ({ terminalFocusOwner }) => {
      if (!hasTerminalWriteAccess()) return false;
      if (terminalFocusOwner === "right-panel") return void addTerminalSurface();
      openTerminalIfClosed();
      createNewTerminal();
    },
  } satisfies ChatShortcutCommands;
  return {
    shortcuts,
    activatePanelTerminalStable,
    addTerminalContextToDraftStable,
    addTerminalSurfaceStable,
    closePanelTerminalStable,
    createNewTerminalStable,
    requestClosePanelTerminalStable,
    requestCloseTerminalStable,
    runShellCommandStable,
    setTerminalOpenStable,
    splitPanelTerminalStable,
    splitPanelTerminalVerticalStable,
    splitTerminalStable,
    toggleTerminalVisibilityStable,
  };
}
