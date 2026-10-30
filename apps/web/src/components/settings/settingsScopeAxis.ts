import type { EnvironmentPresentation } from "../../state/environments";
import type { ResolvedSettingsScope, SettingsScopeSearch } from "./settingsScope";

type ScopeEnvironment = Pick<EnvironmentPresentation, "environmentId" | "label" | "displayUrl">;
function settingsScopeEnvironmentAddress(environment: ScopeEnvironment) {
  if (!environment.displayUrl) return environment.environmentId;
  try {
    return new URL(environment.displayUrl).host || environment.displayUrl;
  } catch {
    return environment.displayUrl;
  }
}

export function settingsScopeEnvironmentLabels(
  environment: ScopeEnvironment,
  environments: readonly ScopeEnvironment[],
) {
  const duplicates = environments.filter(
    (other) =>
      other.environmentId !== environment.environmentId && other.label === environment.label,
  );
  const address = settingsScopeEnvironmentAddress(environment);
  const secondary = duplicates.some((other) => settingsScopeEnvironmentAddress(other) === address)
    ? environment.displayUrl || environment.environmentId
    : address;
  return {
    primary: environment.label,
    secondary: duplicates.length ? secondary : "",
  };
}

export function settingsScopeEnvironmentLabel(
  environment: ScopeEnvironment,
  environments: readonly ScopeEnvironment[],
) {
  const { primary, secondary } = settingsScopeEnvironmentLabels(environment, environments);
  return secondary ? `${primary} · ${secondary}` : primary;
}

export function selectSingleEnvironmentScope(
  search: SettingsScopeSearch,
  scope: ResolvedSettingsScope,
  environments: readonly {
    readonly environmentId: EnvironmentPresentation["environmentId"];
    readonly connection: Pick<EnvironmentPresentation["connection"], "phase">;
  }[],
  primaryEnvironmentId: string | null,
): SettingsScopeSearch {
  if (search.machine || scope.kind === "unavailable") return search;
  const selectedIds = new Set(scope.environmentIds);
  const candidates = environments.filter((environment) =>
    selectedIds.has(environment.environmentId),
  );
  const selected =
    candidates.find((environment) => environment.environmentId === primaryEnvironmentId) ??
    candidates.find((environment) => environment.connection.phase === "connected") ??
    candidates[0];
  return selected ? { ...search, machine: selected.environmentId } : search;
}
