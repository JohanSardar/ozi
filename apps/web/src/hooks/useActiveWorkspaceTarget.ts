import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useServerConfigs } from "../state/entities";
import { useHandleNewThread } from "./useHandleNewThread";
export interface ActiveWorkspaceTarget {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly workspaceName: string;
  readonly threadRef: ScopedThreadRef;
}
export function useActiveWorkspaceTarget(): ActiveWorkspaceTarget | null {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const configs = useServerConfigs();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId;
  const cwd = thread?.workingDirectory ?? (thread ? configs.get(thread.environmentId)?.cwd : null);
  return thread && threadId && cwd
    ? {
        environmentId: thread.environmentId,
        cwd,
        workspaceName: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
        threadRef: scopeThreadRef(thread.environmentId, threadId),
      }
    : null;
}
