import {
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  type ServerSettings,
} from "@t3tools/contracts";

export type ProjectSettingSource = "environment" | "project";

export type ProjectSettingSources = Readonly<
  Record<ProjectScopedServerSettingKey, ProjectSettingSource>
>;

const ENVIRONMENT_SOURCES = Object.fromEntries(
  PROJECT_SCOPED_SERVER_SETTING_KEYS.map((key) => [key, "environment"]),
) as Record<ProjectScopedServerSettingKey, ProjectSettingSource>;

export function resolveProjectSettings(
  settings: ServerSettings,
  projectId: string | null,
): { readonly settings: ServerSettings; readonly sources: ProjectSettingSources } {
  const stored = projectId === null ? undefined : settings.projectSettingsOverrides[projectId];
  if (stored === undefined) return { settings, sources: ENVIRONMENT_SOURCES };
  const sources = { ...ENVIRONMENT_SOURCES };
  const effective: Record<string, unknown> = { ...settings };
  for (const key of PROJECT_SCOPED_SERVER_SETTING_KEYS) {
    const value = stored[key];
    if (value === undefined) continue;
    effective[key] = value;
    sources[key] = "project";
  }
  return { settings: effective as ServerSettings, sources };
}

export function clearProjectSettingsOverrides(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectId: string,
  keys: readonly ProjectScopedServerSettingKey[],
): ProjectSettingsOverrides | null {
  const current = settings.projectSettingsOverrides[projectId];
  if (current === undefined) return null;
  const next: Record<string, unknown> = { ...current };
  for (const key of keys) delete next[key];
  return Object.keys(next).length === 0 ? null : (next as ProjectSettingsOverrides);
}
