import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useProject, useQuietThreadShell } from "./entities";
import { useEnvironmentThread } from "./threads";
import { useThreadSelection } from "./use-thread-selection";

export function useSelectedThreadDirectory() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  return {
    selectedThreadCwd:
      selectedThread?.workingDirectory ?? selectedThreadProject?.workspaceRoot ?? null,
  };
}

export function useThreadCwd(ref: ScopedThreadRef | null): string | null {
  const shell = useQuietThreadShell(ref);
  const detail = useEnvironmentThread(
    shell === null ? (ref?.environmentId ?? null) : null,
    shell === null ? (ref?.threadId ?? null) : null,
  );
  const thread = shell ?? Option.getOrNull(detail.data)?.thread;
  const project = useProject(
    ref && thread ? { environmentId: ref.environmentId, projectId: thread.projectId } : null,
  );
  return thread?.workingDirectory ?? project?.workspaceRoot ?? null;
}
