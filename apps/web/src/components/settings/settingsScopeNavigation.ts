import { validateSettingsScopeSearch } from "./settingsScope";

export function validateSettingsRouteSearch(raw: Record<string, unknown>) {
  return validateSettingsScopeSearch({ machine: raw.machine ?? raw.environmentId });
}
