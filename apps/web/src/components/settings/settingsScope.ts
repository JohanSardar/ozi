import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentPresentation } from "../../state/environments";
export interface SettingsScopeSearch {
  machine?: string | undefined;
}
export type ResolvedSettingsScope = { label: string; environmentIds: readonly EnvironmentId[] } & (
  | { kind: "all" }
  | { kind: "environment"; environmentId: EnvironmentId }
  | { kind: "unavailable"; reason: "environment-missing"; message: string }
);
export function validateSettingsScopeSearch(raw: Record<string, unknown>): SettingsScopeSearch {
  return typeof raw.machine === "string" && raw.machine.trim() ? { machine: raw.machine } : {};
}
export function resolveSettingsScope(
  search: SettingsScopeSearch,
  environments: readonly Pick<EnvironmentPresentation, "environmentId" | "label">[],
): ResolvedSettingsScope {
  const environment = environments.find((candidate) => candidate.environmentId === search.machine);
  if (search.machine && !environment)
    return {
      kind: "unavailable",
      reason: "environment-missing",
      label: "Unavailable selection",
      message: "This environment is no longer available.",
      environmentIds: [],
    };
  return environment
    ? {
        kind: "environment",
        environmentId: environment.environmentId,
        label: environment.label,
        environmentIds: [environment.environmentId],
      }
    : {
        kind: "all",
        label: "All environments",
        environmentIds: environments.map((environment) => environment.environmentId),
      };
}
