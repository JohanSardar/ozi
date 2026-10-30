import type { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import type { SettingsTarget } from "./settings-environment-filter";
export interface ScopedMobileSettingsTarget {
  readonly environment: SettingsTarget;
  readonly settings: ServerSettings;
}
export function resolveMobileSettingsTargets(
  environments: readonly SettingsTarget[],
): readonly ScopedMobileSettingsTarget[] {
  return environments.map((environment) => ({
    environment,
    settings: environment.serverConfig.settings,
  }));
}
export function planMobileScopedSettingsPatch(
  targets: readonly ScopedMobileSettingsTarget[],
  patch: ServerSettingsPatch,
) {
  return targets.map((target) => ({ environmentId: target.environment.environmentId, patch }));
}
export function uniformMobileSetting<K extends keyof ServerSettings>(
  targets: readonly Pick<ScopedMobileSettingsTarget, "settings">[],
  key: K,
): ServerSettings[K] | null {
  const first = targets[0];
  if (!first) return null;
  return targets.every((target) => target.settings[key] === first.settings[key])
    ? first.settings[key]
    : null;
}
