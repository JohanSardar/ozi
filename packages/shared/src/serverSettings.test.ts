import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "./model.ts";
import {
  applyServerSettingsPatch,
  fallbackTextGenerationModelSelection,
  modelPreferencesMigrationPatch,
  resolveModelPreferences,
  parsePersistedServerObservabilitySettings,
} from "./serverSettings.ts";

describe("fallbackTextGenerationModelSelection", () => {
  it("replaces and clears the fallback without carrying model options", () => {
    const fallbackModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "new" };
    const settings = applyServerSettingsPatch(
      {
        ...DEFAULT_SERVER_SETTINGS,
        fallbackModelSelection: {
          ...fallbackModelSelection,
          model: "old",
          options: [{ id: "effort", value: "high" }],
        },
      },
      { fallbackModelSelection },
    );
    expect(settings.fallbackModelSelection).toEqual(fallbackModelSelection);
    expect(
      applyServerSettingsPatch(settings, { fallbackModelSelection: null }).fallbackModelSelection,
    ).toBeNull();
  });
  it("ignores a configured non-default instance at machine scope, matching no fallback", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
    );
    expect(fallback).toBeNull();
  });

  it("considers a configured non-default instance only when asked to", () => {
    const configured = ProviderInstanceId.make("codex_work");
    const providerInstances = {
      [configured]: { driver: ProviderDriverKind.make("codex"), config: {} },
    };
    const fallback = fallbackTextGenerationModelSelection(
      providerInstances,
      (instanceId) => instanceId === configured,
      { includeConfiguredInstances: true },
    );
    expect(fallback?.instanceId).toBe(configured);
  });
});

describe("serverSettings helpers", () => {
  it("translates a shipped client's idle compaction switch into a mode", () => {
    const off = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { idleCompaction: "off" });
    expect([off.idleCompaction, off.compactIdleThreads]).toEqual(["off", false]);
    // Turning the old switch off keeps "Never" instead of reverting to the default.
    const stillOff = applyServerSettingsPatch(off, { compactIdleThreads: false });
    expect(stillOff.idleCompaction).toBe("off");
    const on = applyServerSettingsPatch(off, { compactIdleThreads: true });
    expect([on.idleCompaction, on.compactIdleThreads]).toEqual(["beforeCacheExpires", true]);
  });

  it("parses lenient persisted settings JSON and trims observability URLs", () => {
    expect(
      parsePersistedServerObservabilitySettings(
        JSON.stringify({
          observability: {
            otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
            otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
            otlpLogsUrl: "  http://localhost:4318/v1/logs  ",
          },
        }),
      ),
    ).toEqual({
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      otlpLogsUrl: "http://localhost:4318/v1/logs",
    });
  });

  it("falls back cleanly when persisted settings are invalid", () => {
    expect(parsePersistedServerObservabilitySettings("{")).toEqual({
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
    });
  });

  it("still deep merges text generation selection when only options are provided", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4-mini",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: false },
      ],
    });
  });

  it("replaces text generation selection across providers without leaking stale options", () => {
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(
        ProviderInstanceId.make("codex"),
        "gpt-5.4-mini",
        [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      ),
    };

    expect(
      applyServerSettingsPatch(current, {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("opencode"),
          model: "openai/gpt-5",
        },
      }).textGenerationModelSelection,
    ).toEqual({
      instanceId: "opencode",
      model: "openai/gpt-5",
    });
  });

  it("replaces providerInstances maps so omitted instance fields are cleared", () => {
    const codexId = ProviderInstanceId.make("codex");
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [codexId]: {
          driver: ProviderDriverKind.make("codex"),
          displayName: "Codex Work",
          accentColor: "#7c3aed",
          enabled: true,
          config: { homePath: "~/.codex" },
        },
      },
    };

    expect(
      applyServerSettingsPatch(current, {
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      }).providerInstances[codexId],
    ).toEqual({
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex Work",
      enabled: true,
      config: { homePath: "~/.codex" },
    });
  });

  it("upserts and removes usageLimitSources per entry so concurrent edits cannot clobber", () => {
    const hubA = UsageLimitSourceId.make("cliproxy-a");
    const hubB = UsageLimitSourceId.make("cliproxy-b");
    const source = (url: string) => ({
      kind: "cliproxy" as const,
      url,
      managementKey: "secret",
      enabled: true,
    });
    const current = {
      ...DEFAULT_SERVER_SETTINGS,
      usageLimitSources: { [hubA]: source("http://a:8318") },
    };

    const added = applyServerSettingsPatch(current, {
      usageLimitSources: { [hubB]: source("http://b:8318") },
    });
    expect(Object.keys(added.usageLimitSources)).toEqual([hubA, hubB]);

    const removed = applyServerSettingsPatch(added, { usageLimitSources: { [hubA]: null } });
    expect(Object.keys(removed.usageLimitSources)).toEqual([hubB]);
  });

  it("replaces and removes individual usage prices without clobbering other models", () => {
    const prices = { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 };
    const current = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      usagePriceOverrides: { "example-model": { ...prices, cacheReadCostPerMillionTokens: 0.5 } },
    });
    const added = applyServerSettingsPatch(current, {
      usagePriceOverrides: { "other-model": prices },
    });
    const replaced = applyServerSettingsPatch(added, {
      usagePriceOverrides: { "example-model": prices },
    });
    expect(replaced.usagePriceOverrides).toEqual({
      "example-model": prices,
      "other-model": prices,
    });
    const removed = applyServerSettingsPatch(replaced, {
      usagePriceOverrides: { "example-model": null },
    });
    expect(removed.usagePriceOverrides).toEqual({ "other-model": prices });
    expect(current.usagePriceOverrides["example-model"]?.cacheReadCostPerMillionTokens).toBe(0.5);
  });
});

describe("synchronized model preferences", () => {
  it("supports provider identifiers that match inherited object keys", () => {
    const provider = ProviderInstanceId.make("toString");
    const next = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelsHidden: [{ provider, model: "example", hidden: true }],
    });
    expect(next.providerModelPreferences?.[provider]?.hiddenModels).toEqual(["example"]);
  });
  const provider = ProviderInstanceId.make("codex_work");
  const legacy = {
    favorites: [{ provider, model: "sol" }],
    providerModelPreferences: { [provider]: { hiddenModels: ["astra"], modelOrder: ["sol"] } },
  };

  it("keeps concurrent adds and removes of the same favorite idempotent", () => {
    const add = { setModelFavorites: [{ provider, model: "sol", favorite: true }] };
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, add);
    expect(applyServerSettingsPatch(first, add).favorites).toEqual([{ provider, model: "sol" }]);
    const remove = { setModelFavorites: [{ provider, model: "sol", favorite: false }] };
    const removed = applyServerSettingsPatch(first, remove);
    expect(applyServerSettingsPatch(removed, remove).favorites).toEqual([]);
    expect(first.favorites).toEqual([{ provider, model: "sol" }]);
  });

  it("preserves unrelated models and providers during bulk visibility and order edits", () => {
    const otherProvider = ProviderInstanceId.make("claude_work");
    const initial = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerModelPreferences: {
        ...legacy.providerModelPreferences,
        [otherProvider]: { hiddenModels: ["opus"], modelOrder: ["sonnet", "opus"] },
      },
    });
    const mobile = applyServerSettingsPatch(initial, {
      setModelsHidden: [{ provider, model: "luna", hidden: true }],
    });
    const web = applyServerSettingsPatch(mobile, {
      setModelsHidden: [
        { provider, model: "astra", hidden: false },
        { provider, model: "sol", hidden: true },
      ],
      setProviderModelOrder: { provider, modelOrder: ["sol", "luna", "astra"] },
    });
    expect(initial.providerModelPreferences?.[provider]).toEqual(
      legacy.providerModelPreferences[provider],
    );
    expect(web.providerModelPreferences?.[provider]).toEqual({
      hiddenModels: ["luna", "sol"],
      modelOrder: ["sol", "luna", "astra"],
    });
    expect(web.providerModelPreferences?.[otherProvider]).toEqual(
      initial.providerModelPreferences?.[otherProvider],
    );
    expect(
      applyServerSettingsPatch(web, {
        setProviderModelOrder: { provider, modelOrder: [] },
      }).providerModelPreferences?.[provider],
    ).toEqual({ hiddenModels: ["luna", "sol"], modelOrder: [] });
  });

  it("migrates saved lists independently without claiming empty legacy lists", () => {
    expect(modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, {})).toBeNull();
    const patch = modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!;
    const migrated = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, patch);
    expect(resolveModelPreferences(migrated)).toEqual(legacy);
    expect(modelPreferencesMigrationPatch(migrated, legacy)).toBeNull();
    const favoritesOnly = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, { favorites: [] });
    expect(modelPreferencesMigrationPatch(favoritesOnly, legacy)).toEqual({
      migrateModelPreferences: { providerModelPreferences: legacy.providerModelPreferences },
    });
  });

  it("keeps explicit clears when a delayed migration arrives from another device", () => {
    const staleMigration = modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!;
    const cleared = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      favorites: [],
      providerModelPreferences: {},
    });
    expect(
      resolveModelPreferences(applyServerSettingsPatch(cleared, staleMigration), legacy),
    ).toEqual({
      favorites: [],
      providerModelPreferences: {},
    });
  });

  it("replaces visibility records so showing every model clears removed entries", () => {
    const migrated = applyServerSettingsPatch(
      DEFAULT_SERVER_SETTINGS,
      modelPreferencesMigrationPatch(DEFAULT_SERVER_SETTINGS, legacy)!,
    );
    const cleared = applyServerSettingsPatch(migrated, { providerModelPreferences: {} });
    expect(cleared.providerModelPreferences).toEqual({});
    expect(cleared.favorites).toEqual(legacy.favorites);
  });

  it("sets favorites without losing changes from other clients", () => {
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider, model: "astra", favorite: true }],
      migrateModelPreferences: { favorites: [] },
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider, model: "astra" },
    ]);
    const removed = applyServerSettingsPatch(second, {
      setModelFavorites: [{ provider, model: "sol", favorite: false }],
    });
    expect(removed.favorites).toEqual([{ provider, model: "astra" }]);
    expect(
      applyServerSettingsPatch(removed, {
        setModelFavorites: [{ provider, model: "astra", favorite: false }],
      }).favorites,
    ).toEqual([]);
  });

  it("keeps the same model on different provider instances as separate favorites", () => {
    const otherProvider = ProviderInstanceId.make("codex_personal");
    const first = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      setModelFavorites: [{ provider, model: "sol", favorite: true }],
    });
    const second = applyServerSettingsPatch(first, {
      setModelFavorites: [{ provider: otherProvider, model: "sol", favorite: true }],
    });
    expect(second.favorites).toEqual([
      { provider, model: "sol" },
      { provider: otherProvider, model: "sol" },
    ]);
    expect(
      applyServerSettingsPatch(second, {
        setModelFavorites: [{ provider, model: "sol", favorite: false }],
      }).favorites,
    ).toEqual([{ provider: otherProvider, model: "sol" }]);
  });
});
