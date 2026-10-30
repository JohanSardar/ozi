import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useStableCallback } from "~/hooks/useStableCallback";
import { resolveEnvironmentMachineKind, type ScopedThreadRef } from "@t3tools/contracts";
import { TerminalIcon } from "lucide-react";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { type AnimationEvent } from "react";
import { cn } from "../lib/utils";
import { revealThreadTerminal } from "../lib/revealThreadTerminal";
import { useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveThreadLastVisitedAt,
  resolveThreadStatusPill,
  type ThreadStatusPill,
  useSidebarRowSubscriptionLease,
} from "./Sidebar.logic";

import type { SidebarThreadSummary } from "../types";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

export function terminalStatusFromRunningIds(
  runningTerminalIds: ReadonlyArray<string>,
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function synchronizeTerminalPulse(event: AnimationEvent<SVGSVGElement>) {
  if (event.animationName !== "status-pulse") return;

  for (const animation of event.currentTarget.getAnimations()) {
    if ("animationName" in animation && animation.animationName === "status-pulse") {
      animation.startTime = 0;
    }
  }
}

export function ThreadTerminalStatusButton({
  threadRef,
  terminalIds,
  onThreadActivate,
}: {
  threadRef: ScopedThreadRef;
  terminalIds: readonly string[];
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
}) {
  const terminalId = terminalIds[0];
  if (terminalId === undefined) return null;
  const status = terminalStatusFromRunningIds(terminalIds);
  const label =
    terminalIds.length === 1
      ? "1 terminal process running. Open terminal"
      : `${terminalIds.length} terminal processes running. Open terminal`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid={`sidebar-terminal-status-${threadRef.threadId}`}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              status?.colorClass,
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              revealThreadTerminal(threadRef, terminalId);
              onThreadActivate(threadRef);
            }}
          />
        }
      >
        <TerminalIcon
          className="size-3.5 motion-safe:animate-status-pulse"
          onAnimationStart={synchronizeTerminalPulse}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function ThreadStatusLabel({ status }: { status: ThreadStatusPill }) {
  if (status.spinner) {
    return <Spinner aria-label={status.label} size="xs" tone="muted" />;
  }
  return <span className="text-3xs text-muted-foreground">{status.label}</span>;
}

export function ThreadRowLeadingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const { rowRef } = useSidebarRowSubscriptionLease(false);
  // A new ref callback would detach and reattach the row, and each reattach sets lease state.
  const statusRef = useStableCallback((node: HTMLSpanElement | null) =>
    rowRef(node?.parentElement ?? null),
  );
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const localLastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });

  return (
    <span
      ref={statusRef}
      className={threadStatus ? "inline-flex shrink-0 items-center gap-1.5" : "contents"}
    >
      {threadStatus ? <ThreadStatusLabel status={threadStatus} /> : null}
    </span>
  );
}

export function ThreadRowTrailingStatus({ thread }: { thread: SidebarThreadSummary }) {
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const environment = useEnvironment(thread.environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const isRemoteThread = thread.environmentId !== primaryEnvironmentId;
  const remoteEnvLabel = environment?.label ?? null;
  const threadEnvironmentLabel = isRemoteThread ? (remoteEnvLabel ?? "Remote") : null;
  const remoteMachine = resolveEnvironmentMachineKind(environment?.serverConfig ?? null);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);

  if (!terminalStatus && !isRemoteThread) {
    return null;
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {terminalStatus ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                aria-label={terminalStatus.label}
                className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
              />
            }
          >
            <TerminalIcon
              className={`size-3 ${terminalStatus.pulse ? "motion-safe:animate-status-pulse" : ""}`}
              onAnimationStart={synchronizeTerminalPulse}
            />
          </TooltipTrigger>
          <TooltipPopup side="top">{terminalStatus.label}</TooltipPopup>
        </Tooltip>
      ) : null}
      {isRemoteThread ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={threadEnvironmentLabel ?? "Remote"}
                className="inline-flex items-center justify-center"
              />
            }
          >
            <EnvironmentMachineIcon
              kind={remoteMachine}
              className="size-3 text-muted-foreground/60"
            />
          </TooltipTrigger>
          <TooltipPopup side="top">{threadEnvironmentLabel}</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
}
