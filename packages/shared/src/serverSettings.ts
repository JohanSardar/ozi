import type { ModelPreferences } from "@t3tools/contracts/settings";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  globalIdleCompaction,
  type IdleCompactionMode,
  isUnconfiguredDefaultInstanceEnabled,
  resolveProviderInstanceEnabled,
  type ModelSelection,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerSettings,
  type ServerSettingsPatch,
  withIdleCompaction,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection, readCustomModelEntries } from "./model.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return isUnconfiguredDefaultInstanceEnabled(selection.instanceId);
}

const TEXT_GENERATION_FALLBACK_DRIVERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "muse",
  "pi",
  "opencode",
  "antigravity",
].map((driver) => ProviderDriverKind.make(driver));

/** Only project-scoped callers may include configured instances when falling back; machine-level callers leave it unset. */
export function fallbackTextGenerationModelSelection(
  providerInstances: ServerSettings["providerInstances"],
  isEnabled: (instanceId: ProviderInstanceId, driver: ProviderDriverKind) => boolean,
  options?: {
    readonly includeConfiguredInstances?: boolean;
    readonly defaultModelSelection?: ModelSelection | null;
  },
): ModelSelection | null {
  const candidates = [
    ...TEXT_GENERATION_FALLBACK_DRIVERS.map(
      (driver) => [defaultInstanceIdForDriver(driver), driver] as const,
    ),
    ...(options?.includeConfiguredInstances === true
      ? Object.entries(providerInstances).flatMap(([instanceId, instance]) =>
          TEXT_GENERATION_FALLBACK_DRIVERS.includes(instance.driver)
            ? [[ProviderInstanceId.make(instanceId), instance.driver] as const]
            : [],
        )
      : []),
  ];
  const match = candidates.find(([instanceId, driver]) => isEnabled(instanceId, driver));
  if (match === undefined) return null;
  const [instanceId, driver] = match;
  const threadDefault = options?.defaultModelSelection;
  const config = providerInstances[instanceId]?.config as { customModels?: unknown } | undefined;
  if (
    threadDefault?.instanceId === instanceId &&
    readCustomModelEntries(config?.customModels).some((entry) => entry.slug === threadDefault.model)
  ) {
    return threadDefault;
  }
  return { instanceId, model: defaultTextGenerationModel(driver) };
}

export function defaultTextGenerationModel(driver: ProviderDriverKind): string {
  return (
    DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_TEXT_GENERATION_MODEL
  );
}

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
  readonly otlpLogsUrl: string | undefined;
}

function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
    readonly otlpLogsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
    otlpLogsUrl: normalizePersistedServerSettingString(input.observability?.otlpLogsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined, otlpLogsUrl: undefined };
}

function shouldReplaceTextGenerationModelSelection(
  patch: ServerSettingsPatch["textGenerationModelSelection"] | undefined,
): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

function mergeSettingsEntries<Value>(
  current: Readonly<Record<string, Value>>,
  patch: Readonly<Record<string, Value | null>>,
): Record<string, Value> {
  const next = new Map(Object.entries(current));
  for (const [id, config] of Object.entries(patch)) {
    if (config === null) {
      next.delete(id);
    } else {
      next.set(id, config);
    }
  }
  return Object.fromEntries(next);
}

// Older clients omit providerInstances during whole-entry replacement; preserve it to avoid wiping overrides.
function mergeProjectSettingsOverridesPatch(
  current: Readonly<Record<string, ProjectSettingsOverrides>>,
  patch: Readonly<Record<string, ProjectSettingsOverrides | null>>,
): Record<string, ProjectSettingsOverrides> {
  const next = new Map(Object.entries(current));
  for (const [projectId, entry] of Object.entries(patch)) {
    if (entry === null) {
      next.delete(projectId);
      continue;
    }
    const storedProviderInstances = current[projectId]?.providerInstances;
    next.set(projectId, {
      ...entry,
      ...(Object.hasOwn(entry, "providerInstances") || storedProviderInstances === undefined
        ? {}
        : { providerInstances: storedProviderInstances }),
    });
  }
  return Object.fromEntries(next);
}

export function deriveLegacyProjectOverrides(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
): Pick<ServerSettings, "projectAgentBrowserAccessOverrides" | "projectScriptOverrides"> {
  const projectAgentBrowserAccessOverrides: Record<string, boolean> = {};
  const projectScriptOverrides: Record<string, ServerSettings["defaultProjectScripts"] | null> = {};
  for (const [projectId, entry] of Object.entries(settings.projectSettingsOverrides)) {
    if (entry.enableAgentBrowserAccess !== undefined) {
      projectAgentBrowserAccessOverrides[projectId] = entry.enableAgentBrowserAccess;
    }
    if (entry.defaultProjectScripts !== undefined) {
      projectScriptOverrides[projectId] = entry.defaultProjectScripts;
    }
  }
  return { projectAgentBrowserAccessOverrides, projectScriptOverrides };
}

function translateLegacyProjectOverridePatch(
  current: Pick<ServerSettings, "projectSettingsOverrides">,
  patch: ServerSettingsPatch,
): ServerSettingsPatch {
  const { projectAgentBrowserAccessOverrides, projectScriptOverrides, ...rest } = patch;
  if (projectAgentBrowserAccessOverrides === undefined && projectScriptOverrides === undefined) {
    return patch;
  }
  const currentEntries: Readonly<Record<string, ProjectSettingsOverrides>> =
    current.projectSettingsOverrides;
  const entries = new Map<string, ProjectSettingsOverrides | null>(
    Object.entries(rest.projectSettingsOverrides ?? {}),
  );
  // Canonical entries outrank legacy maps, including deliberately omitted keys.
  const canonicalProjectIds = new Set(Object.keys(rest.projectSettingsOverrides ?? {}));
  const applyKey = <K extends ProjectScopedServerSettingKey>(
    map: Readonly<Record<string, ProjectSettingsOverrides[K] | null>> | undefined,
    key: K,
  ) => {
    if (map === undefined) return;
    for (const [projectId, value] of Object.entries(map)) {
      if (canonicalProjectIds.has(projectId)) continue;
      const entry: ProjectSettingsOverrides = {
        ...(entries.get(projectId) ?? currentEntries[projectId]),
      };
      if (value === null || value === undefined) {
        delete entry[key];
      } else {
        entry[key] = value;
      }
      entries.set(projectId, Object.keys(entry).length === 0 ? null : entry);
    }
  };
  applyKey(projectAgentBrowserAccessOverrides, "enableAgentBrowserAccess");
  applyKey(projectScriptOverrides, "defaultProjectScripts");
  return {
    ...rest,
    projectSettingsOverrides: Object.fromEntries(entries),
  } as ServerSettingsPatch;
}

/**
 * A client from before `idleCompaction` patches the old boolean switch. Turning
 * it off keeps "Never" rather than reverting to the default.
 */
function patchedIdleCompaction(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): IdleCompactionMode {
  if (patch.idleCompaction !== undefined) return patch.idleCompaction;
  const legacy = patch.compactIdleThreads;
  if (legacy === undefined) return globalIdleCompaction(current);
  if (typeof legacy === "string") return legacy;
  if (legacy) return "beforeCacheExpires";
  return globalIdleCompaction(current) === "off" ? "off" : "onReturn";
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  rawPatch: ServerSettingsPatch,
): ServerSettings {
  const patch = translateLegacyProjectOverridePatch(current, rawPatch);
  const selectionPatch = patch.textGenerationModelSelection;
  const {
    migrateModelPreferences,
    setModelFavorites,
    setModelsHidden,
    setProviderModelOrder,
    providerModelPreferences,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    // Merged per entry below; its `null` removals must not reach deepMerge.
    usageLimitSources: usageLimitSourcesPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    usageModelAliases: usageModelAliasesPatch,
    // Entry replacement: deepMerge would keep keys the client meant to clear.
    projectSettingsOverrides: projectSettingsOverridesPatch,
    projectAgentBrowserAccessOverrides: _legacyBrowserAccess,
    projectScriptOverrides: _legacyScripts,
    ...patchForMerge
  } = patch;
  const currentBackgroundActivity = normalizeServerBackgroundActivitySettings(current);
  const backgroundActivityPatch =
    backgroundActivityProfile !== undefined
      ? {
          schemaVersion: 1 as const,
          profile:
            providerHealthRefreshInterval !== undefined
              ? ("custom" as const)
              : backgroundActivityProfile,
          ...(providerHealthRefreshInterval !== undefined
            ? { baseProfile: backgroundActivityProfile }
            : {}),
          overrides:
            providerHealthRefreshInterval !== undefined ? { providerHealthRefreshInterval } : {},
        }
      : providerHealthRefreshInterval !== undefined
        ? {
            schemaVersion: 1 as const,
            profile: "custom" as const,
            baseProfile: getBackgroundActivityBaseProfile(currentBackgroundActivity),
            overrides: {
              ...(currentBackgroundActivity.profile === "custom"
                ? currentBackgroundActivity.overrides
                : {}),
              ...(providerHealthRefreshInterval !== undefined
                ? { providerHealthRefreshInterval }
                : {}),
            },
          }
        : undefined;
  const initialFavorites =
    patch.favorites ?? current.favorites ?? migrateModelPreferences?.favorites ?? null;
  const favorites =
    setModelFavorites?.reduce(
      (current, change) => {
        const exists = current.some(
          (favorite) => favorite.provider === change.provider && favorite.model === change.model,
        );
        if (change.favorite) {
          if (!exists) current.push({ provider: change.provider, model: change.model });
          return current;
        }
        return current.filter(
          (favorite) => favorite.provider !== change.provider || favorite.model !== change.model,
        );
      },
      [...(initialFavorites ?? [])],
    ) ?? initialFavorites;
  const initialModelPreferences =
    providerModelPreferences ??
    current.providerModelPreferences ??
    migrateModelPreferences?.providerModelPreferences ??
    null;
  let nextModelPreferences = initialModelPreferences;
  if (setModelsHidden?.length) {
    const updated = { ...initialModelPreferences };
    for (const change of setModelsHidden) {
      const preferences = (Object.hasOwn(updated, change.provider)
        ? updated[change.provider]
        : undefined) ?? {
        hiddenModels: [],
        modelOrder: [],
      };
      const hiddenModels = preferences.hiddenModels.filter((model) => model !== change.model);
      if (change.hidden) hiddenModels.push(change.model);
      updated[change.provider] = { ...preferences, hiddenModels };
    }
    nextModelPreferences = updated;
  }
  if (setProviderModelOrder) {
    const preferences = nextModelPreferences?.[setProviderModelOrder.provider] ?? {
      hiddenModels: [],
      modelOrder: [],
    };
    nextModelPreferences = {
      ...nextModelPreferences,
      [setProviderModelOrder.provider]: {
        ...preferences,
        modelOrder: [...setProviderModelOrder.modelOrder],
      },
    };
  }
  const next = deepMerge(current, patchForMerge);
  const nextWithReplacementsBase = {
    ...next,
    favorites,
    providerModelPreferences: nextModelPreferences,
    ...(backgroundActivity !== undefined
      ? {
          backgroundActivity: {
            ...deepMerge(currentBackgroundActivity, backgroundActivity),
            ...(backgroundActivity.overrides !== undefined
              ? { overrides: backgroundActivity.overrides }
              : {}),
          },
        }
      : { backgroundActivity: currentBackgroundActivity }),
    ...(backgroundActivity === undefined && backgroundActivityPatch !== undefined
      ? { backgroundActivity: backgroundActivityPatch }
      : {}),
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(projectSettingsOverridesPatch !== undefined
      ? {
          projectSettingsOverrides: Object.fromEntries(
            Object.entries(
              mergeProjectSettingsOverridesPatch(
                current.projectSettingsOverrides,
                projectSettingsOverridesPatch,
              ),
            ).filter(([, entry]) => Object.keys(entry).length > 0),
          ),
        }
      : {}),
    ...(patch.defaultModelSelection !== undefined
      ? { defaultModelSelection: patch.defaultModelSelection }
      : {}),
    ...(patch.fallbackModelSelection !== undefined
      ? { fallbackModelSelection: patch.fallbackModelSelection }
      : {}),
    ...(patch.defaultProjectScripts !== undefined
      ? { defaultProjectScripts: patch.defaultProjectScripts }
      : {}),
    ...(usageLimitSourcesPatch !== undefined
      ? {
          usageLimitSources: mergeSettingsEntries(
            current.usageLimitSources,
            usageLimitSourcesPatch,
          ),
        }
      : {}),
    ...(usagePriceOverridesPatch !== undefined
      ? {
          usagePriceOverrides: mergeSettingsEntries(
            current.usagePriceOverrides,
            usagePriceOverridesPatch,
          ),
        }
      : {}),
    ...(usageModelAliasesPatch !== undefined
      ? {
          usageModelAliases: mergeSettingsEntries(
            current.usageModelAliases,
            usageModelAliasesPatch,
          ),
        }
      : {}),
    ...(providerHealthRefreshInterval !== undefined ? { providerHealthRefreshInterval } : {}),
  };
  const normalizedBackgroundActivity = normalizeBackgroundActivitySettings(
    nextWithReplacementsBase.backgroundActivity,
  );
  const resolvedBackgroundActivity = resolveBackgroundActivitySettings(
    normalizedBackgroundActivity,
  );
  const nextWithReplacements = {
    ...withIdleCompaction(nextWithReplacementsBase, patchedIdleCompaction(current, patch)),
    ...deriveLegacyProjectOverrides(nextWithReplacementsBase),
    backgroundActivity: normalizedBackgroundActivity,
    providerHealthRefreshInterval: resolvedBackgroundActivity.providerHealthRefreshInterval,
    backgroundActivityProfile: resolvedBackgroundActivity.profile,
  };
  if (!selectionPatch) {
    return nextWithReplacements;
  }

  const instanceId = selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const options = shouldReplaceTextGenerationModelSelection(selectionPatch)
    ? selectionPatch.options
    : mergeModelSelectionOptionsById({
        current: current.textGenerationModelSelection.options,
        patch: selectionPatch.options,
      });

  return {
    ...nextWithReplacements,
    textGenerationModelSelection: createModelSelection(instanceId, model, options),
  };
}

export function resolveModelPreferences(
  settings: Pick<ServerSettings, "favorites" | "providerModelPreferences">,
  legacy: Partial<ModelPreferences> = {},
): ModelPreferences {
  return {
    favorites: settings.favorites ?? legacy.favorites ?? [],
    providerModelPreferences:
      settings.providerModelPreferences ?? legacy.providerModelPreferences ?? {},
  };
}

/** Empty legacy values do not claim ownership before another client can migrate its saved list. */
export function modelPreferencesMigrationPatch(
  settings: Pick<ServerSettings, "favorites" | "providerModelPreferences">,
  legacy: Partial<ModelPreferences>,
): ServerSettingsPatch | null {
  const favorites =
    settings.favorites === null && (legacy.favorites?.length ?? 0) > 0
      ? legacy.favorites
      : undefined;
  const providerModelPreferences =
    settings.providerModelPreferences === null &&
    Object.keys(legacy.providerModelPreferences ?? {}).length > 0
      ? legacy.providerModelPreferences
      : undefined;
  return favorites === undefined && providerModelPreferences === undefined
    ? null
    : {
        migrateModelPreferences: {
          ...(favorites === undefined ? {} : { favorites }),
          ...(providerModelPreferences === undefined ? {} : { providerModelPreferences }),
        },
      };
}
