import { resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import type { EnvironmentOption } from "../components/environmentOptions";
export function useDraftEnvironments(): readonly EnvironmentOption[] {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  return environments
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      isPrimary: environment.environmentId === primary,
      machine: resolveEnvironmentMachineKind(environment.serverConfig),
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.label.localeCompare(b.label));
}
