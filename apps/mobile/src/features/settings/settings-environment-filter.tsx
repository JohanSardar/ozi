import type { EnvironmentId } from "@t3tools/contracts";
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { toggleSettingsEnvironment } from "./settings-environment-filter.logic";

export type SettingsTarget = EnvironmentPresentation & {
  readonly serverConfig: NonNullable<EnvironmentPresentation["serverConfig"]>;
};

// Several mounted Settings components read the scope at once (the list, its header, a page and
// its editor), so share the derived lists across them for the same inputs.
const targetsCache = new WeakMap<readonly EnvironmentPresentation[], readonly SettingsTarget[]>();
function connectedSettingsTargets(environments: readonly EnvironmentPresentation[]) {
  let targets = targetsCache.get(environments);
  if (!targets) {
    targets = environments.filter(
      (entry): entry is SettingsTarget =>
        entry.connection.phase === "connected" && entry.serverConfig !== null,
    );
    targetsCache.set(environments, targets);
  }
  return targets;
}

interface SettingsEnvironmentSelection {
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly setSelectedIds: Dispatch<SetStateAction<ReadonlySet<EnvironmentId> | null>>;
}

const SettingsEnvironmentSelectionContext = createContext<SettingsEnvironmentSelection | null>(
  null,
);

/**
 * Holds the Settings scope selection across Settings pages, which are separate root routes.
 * It stays mounted for the whole app, so it keeps only the selection; the environment and
 * project data is derived in the hook, by the Settings pages that are mounted. The selection
 * resets when Settings closes.
 */
export function SettingsEnvironmentFilterProvider(props: {
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId> | null>(null);
  if (!props.open && selectedIds !== null) setSelectedIds(null);
  const value = { selectedIds, setSelectedIds };
  return (
    <SettingsEnvironmentSelectionContext value={value}>
      {props.children}
    </SettingsEnvironmentSelectionContext>
  );
}

export function useSettingsEnvironmentFilter() {
  const selection = useContext(SettingsEnvironmentSelectionContext);
  if (selection === null) throw new Error("Settings environment filter provider is missing.");
  const { selectedIds, setSelectedIds } = selection;
  const { environments } = useEnvironments();
  const availableTargets = connectedSettingsTargets(environments);
  const selectedTargets = availableTargets.filter(
    (entry) => selectedIds === null || selectedIds.has(entry.environmentId),
  );
  return {
    availableTargets,
    selectedTargets,
    selectedIds,
    selectAll: () => setSelectedIds(null),
    toggleEnvironment: (environmentId: EnvironmentId) =>
      setSelectedIds((current) =>
        toggleSettingsEnvironment(current, availableTargets, environmentId),
      ),
  };
}
