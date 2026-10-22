import {
  type ModelSelection,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  resolveProjectProviderInstanceEnabled,
  type ServerSettings,
} from "@t3tools/contracts";
import { fallbackTextGenerationModelSelection } from "./serverSettings.ts";

export type ProjectSettingSource = "environment" | "project" | "t3.json";

export type ProjectSettingSources = Readonly<
  Record<ProjectScopedServerSettingKey, ProjectSettingSource>
>;

export interface ResolvedProjectSettings<Settings extends ServerSettings = ServerSettings> {
  readonly settings: Settings;
  readonly sources: ProjectSettingSources;
  readonly overrides: ProjectSettingsOverrides;
}

const EMPTY_OVERRIDES: ProjectSettingsOverrides = {};

const ENVIRONMENT_SOURCES: ProjectSettingSources = Object.fromEntries(
  PROJECT_SCOPED_SERVER_SETTING_KEYS.map((key) => [key, "environment"]),
) as Record<ProjectScopedServerSettingKey, ProjectSettingSource>;

/**
 * The project aggregate's own model and workspace fields. They remain the
 * source of truth until the server has folded them into the override record;
 * after the fold the record alone decides, so a reset there cannot be undone
 * by a stale aggregate value.
 */
export interface LegacyProjectSettingsFields {
  readonly defaultModelSelection?: ModelSelection | null | undefined;
}

function resolveProjectOverrides(
  settings: ServerSettings,
  projectId: ProjectId | null,
  project?: LegacyProjectSettingsFields | null,
): ResolvedProjectSettings {
  const stored = projectId === null ? undefined : settings.projectSettingsOverrides[projectId];
  const overrides: ProjectSettingsOverrides =
    project == null || settings.projectSettingsFolded
      ? (stored ?? EMPTY_OVERRIDES)
      : {
          ...(project.defaultModelSelection != null
            ? { defaultModelSelection: project.defaultModelSelection }
            : {}),
          ...stored,
        };
  if (Object.keys(overrides).length === 0) {
    return { settings, sources: ENVIRONMENT_SOURCES, overrides: EMPTY_OVERRIDES };
  }
  const sources: Record<ProjectScopedServerSettingKey, ProjectSettingSource> = {
    ...ENVIRONMENT_SOURCES,
  };
  const effective: Record<string, unknown> = { ...settings };
  for (const key of PROJECT_SCOPED_SERVER_SETTING_KEYS) {
    if (!Object.hasOwn(overrides, key)) continue;
    const value = overrides[key];
    // A forward-compatible decode leaves an unknown value as a present
    // undefined; that is not an override.
    if (value === undefined) continue;
    if (
      (key === "textGenerationModelSelection" || key === "defaultModelSelection") &&
      value !== undefined &&
      value !== null &&
      !resolveProjectProviderInstanceEnabled(
        settings,
        projectId,
        (value as ModelSelection).instanceId,
      )
    ) {
      continue;
    }
    effective[key] = value;
    sources[key] = "project";
  }
  const textGeneration = effective.textGenerationModelSelection as ModelSelection;
  if (!resolveProjectProviderInstanceEnabled(settings, projectId, textGeneration.instanceId)) {
    const fallback = fallbackTextGenerationModelSelection(
      settings.providerInstances,
      (instanceId) => resolveProjectProviderInstanceEnabled(settings, projectId, instanceId),
      {
        includeConfiguredInstances: true,
        defaultModelSelection: effective.defaultModelSelection as ModelSelection | null,
      },
    );
    if (fallback !== null) effective.textGenerationModelSelection = fallback;
  }
  return { settings: effective as ServerSettings, sources, overrides };
}

export const resolveProjectSettings = resolveProjectOverrides;
