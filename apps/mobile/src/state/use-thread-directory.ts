import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEnvironmentServerConfig, useQuietThreadShell } from "./entities";
import { useEnvironmentThread } from "./threads";
import { useThreadSelection } from "./use-thread-selection";

export function useSelectedThreadDirectory() {
  const { selectedThread, selectedThreadRef } = useThreadSelection();
  const config = useEnvironmentServerConfig(selectedThreadRef?.environmentId ?? null);
  return {
    selectedThreadCwd: selectedThread?.workingDirectory ?? config?.cwd ?? null,
  };
}

export function useThreadCwd(ref: ScopedThreadRef | null): string | null {
  const shell = useQuietThreadShell(ref);
  const detail = useEnvironmentThread(
    shell === null ? (ref?.environmentId ?? null) : null,
    shell === null ? (ref?.threadId ?? null) : null,
  );
  const thread = shell ?? Option.getOrNull(detail.data)?.thread;
  const config = useEnvironmentServerConfig(ref?.environmentId ?? null);
  return thread?.workingDirectory ?? config?.cwd ?? null;
}
