import { useAtomRefresh } from "@effect/atom-react";
import { type EnvironmentId, type ProviderInstanceId } from "@t3tools/contracts";
import { createProviderWorkspaceSnapshotRefreshAtomFamily } from "@t3tools/client-runtime/providerSkills";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "../../state/server";

const providerWorkspaceSnapshotRefresh = createProviderWorkspaceSnapshotRefreshAtomFamily({
  providers: serverEnvironment.providersValueAtom,
  refreshProviders: serverEnvironment.refreshProviders,
});

const idleRefreshAtom: Atom.Atom<unknown> = Atom.make<void>(undefined).pipe(
  Atom.withLabel("provider-workspace-snapshot-refresh:idle"),
);

/**
 * Keeps the selected provider's workspace snapshot fresh for the composer's
 * cwd while mounted. Returns a check to run when the user types.
 */
export function useProviderWorkspaceSnapshotRefresh(input: {
  readonly environmentId: EnvironmentId;
  readonly workingDirectory: string | null;
  readonly instanceId: ProviderInstanceId | undefined;
}): () => void {
  const { environmentId, instanceId, workingDirectory } = input;
  const atom =
    workingDirectory && instanceId
      ? providerWorkspaceSnapshotRefresh({ environmentId, instanceId, cwd: workingDirectory })
      : idleRefreshAtom;
  return useAtomRefresh(atom);
}
