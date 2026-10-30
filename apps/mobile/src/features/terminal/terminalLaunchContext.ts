import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

interface TerminalLocationLike {
  readonly cwd: string;
  readonly workingDirectory: string | null;
}

interface PendingTerminalLaunchTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}

export interface PendingTerminalLaunch {
  readonly cwd: string;
  readonly workingDirectory: string | null;
  readonly env?: Record<string, string>;
  readonly initialInput?: string;
}

const pendingTerminalLaunches = new Map<string, PendingTerminalLaunch>();

function pendingTerminalLaunchKey(input: PendingTerminalLaunchTarget): string {
  return `${input.environmentId}:${input.threadId}:${input.terminalId}`;
}

export function stagePendingTerminalLaunch(input: {
  readonly target: PendingTerminalLaunchTarget;
  readonly launch: PendingTerminalLaunch;
}) {
  pendingTerminalLaunches.set(pendingTerminalLaunchKey(input.target), {
    cwd: input.launch.cwd,
    workingDirectory: input.launch.workingDirectory,
    env: input.launch.env ? { ...input.launch.env } : undefined,
    initialInput: input.launch.initialInput,
  });
}

export function takePendingTerminalLaunch(
  target: PendingTerminalLaunchTarget,
): PendingTerminalLaunch | null {
  const key = pendingTerminalLaunchKey(target);
  const launch = pendingTerminalLaunches.get(key) ?? null;
  if (launch) {
    pendingTerminalLaunches.delete(key);
  }

  return launch;
}

export function resolveTerminalOpenLocation(input: {
  readonly terminalLocation: TerminalLocationLike | null;
  readonly activeSessionLocation: TerminalLocationLike | null;
  readonly workspaceRoot: string;
  readonly workingDirectory: string | null;
}): {
  readonly cwd: string;
  readonly workingDirectory: string | null;
} {
  const sessionLocation = input.terminalLocation ?? input.activeSessionLocation;

  // Keep cwd paired with its identity; null identifies the project checkout.
  if (sessionLocation !== null) {
    return { cwd: sessionLocation.cwd, workingDirectory: sessionLocation.workingDirectory };
  }
  return {
    cwd: input.workingDirectory ?? input.workspaceRoot,
    workingDirectory: input.workingDirectory,
  };
}

/** The first location resolved for a terminal target stays fixed for that target. */
export function useInitialTerminalLaunchLocation(input: {
  readonly targetKey: string;
  readonly pendingLaunch: PendingTerminalLaunch | null;
  readonly isAuthenticated: boolean;
  readonly canRead: boolean;
  readonly canOperate: boolean;
  readonly hasLoadedSessions: boolean;
  readonly location: Parameters<typeof resolveTerminalOpenLocation>[0] | null;
}) {
  let candidate: TerminalLocationLike | null = null;
  if (input.location !== null && input.isAuthenticated && (input.canRead || input.canOperate)) {
    if (input.pendingLaunch !== null) {
      candidate = {
        cwd: input.pendingLaunch.cwd,
        workingDirectory: input.pendingLaunch.workingDirectory,
      };
    } else if (!input.canRead || input.hasLoadedSessions) {
      // Metadata must establish whether this target has a location before we retain a fallback.
      candidate = resolveTerminalOpenLocation(input.location);
    }
  }
  const [entry, setEntry] = useState(() => ({ key: input.targetKey, location: candidate }));
  if (entry.key !== input.targetKey || (entry.location === null && candidate !== null)) {
    setEntry({ key: input.targetKey, location: candidate });
    return candidate;
  }
  return entry.location;
}
