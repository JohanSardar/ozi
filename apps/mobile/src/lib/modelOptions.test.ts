import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerConfig,
} from "@t3tools/contracts";

import {
  buildModelOptions,
  isModelSelectionUnavailable,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
  type ModelOption,
} from "./modelOptions";

describe("mobile model options", () => {
  it("does not materialize catalog defaults for missing stored options", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-test",
              name: "GPT Test",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [
                      { id: "default", label: "Standard", isDefault: true },
                      { id: "priority", label: "Fast" },
                    ],
                    currentValue: "default",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [option] = buildModelOptions(
      config,
      {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-test",
      },
      undefined,
    );

    expect(option?.capabilities?.optionDescriptors?.[0]?.id).toBe("serviceTier");
    expect(option?.selection.options).toBeUndefined();

    const [emptyOption] = buildModelOptions(
      config,
      {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-test",
        options: [],
      },
      undefined,
    );
    expect(emptyOption?.selection).toEqual(option?.selection);

    const [explicitOption] = buildModelOptions(
      config,
      {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-test",
        options: [{ id: "serviceTier", value: "priority" }],
      },
      undefined,
    );
    expect(explicitOption?.selection.options).toEqual([{ id: "serviceTier", value: "priority" }]);
  });

  it("limits existing threads to their provider while new tasks keep every provider", () => {
    const providers = ["codex", "claudeAgent"].map((instanceId) => ({
      instanceId,
      driver: instanceId,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "test", name: instanceId, capabilities: null }],
    }));
    const config = { providers } as unknown as ServerConfig;
    const selection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };

    expect(
      buildModelOptions(config, selection, undefined).map((option) => option.providerKey),
    ).toEqual(["codex", "claudeAgent"]);
    expect(buildModelOptions(config, selection, selection.instanceId)).toEqual(
      buildModelOptions(config, selection, undefined).filter(
        (option) => option.providerKey === "codex",
      ),
    );
  });

  it("keeps accounts in the continuation group and excludes other providers", () => {
    const config = {
      providers: [
        { instanceId: "codex", driver: "codex", continuation: { groupKey: "shared" } },
        { instanceId: "codex_work", driver: "codex", continuation: { groupKey: "shared" } },
        { instanceId: "codex_other", driver: "codex", continuation: { groupKey: "other" } },
        { instanceId: "claude", driver: "claudeAgent", continuation: { groupKey: "shared" } },
      ].map((provider) => ({
        ...provider,
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        models: [{ slug: "test", name: "Test", capabilities: null }],
      })),
    } as unknown as ServerConfig;
    expect(
      buildModelOptions(config, null, ProviderInstanceId.make("codex")).map(
        (option) => option.providerKey,
      ),
    ).toEqual(["codex", "codex_work"]);
  });

  it("matches the web driver fallback without moving unknown Antigravity history", () => {
    const config = {
      providers: [
        { instanceId: "codex", driver: "codex" },
        { instanceId: "codex_work", driver: "codex" },
        { instanceId: "google", driver: "antigravity" },
        { instanceId: "google_work", driver: "antigravity" },
      ].map((provider) => ({
        ...provider,
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        models: [{ slug: "test", name: "Test", capabilities: null }],
      })),
    } as unknown as ServerConfig;
    expect(
      buildModelOptions(config, null, ProviderInstanceId.make("codex")).map(
        (option) => option.providerKey,
      ),
    ).toEqual(["codex", "codex_work"]);
    expect(
      buildModelOptions(config, null, ProviderInstanceId.make("google")).map(
        (option) => option.providerKey,
      ),
    ).toEqual(["google"]);
  });

  it("carries account badges into catalog and saved fallback models", () => {
    const config = {
      providers: [
        { instanceId: "codex", driver: "codex", displayName: "Personal" },
        { instanceId: "codex_work", driver: "codex", displayName: "Work", accentColor: "#123456" },
      ].map((provider) => ({
        ...provider,
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        models: [{ slug: "test", name: "Test", capabilities: null }],
      })),
    } as unknown as ServerConfig;
    const selection = { instanceId: ProviderInstanceId.make("codex_work"), model: "saved" };
    const options = buildModelOptions(config, selection, undefined);
    expect(options[0]?.providerBadge).toEqual({ displayName: "Personal", showBadge: true });
    expect(options[1]?.providerBadge).toEqual({
      displayName: "Work",
      accentColor: "#123456",
      showBadge: true,
    });
    expect(options[2]?.providerBadge).toEqual(options[1]?.providerBadge);
    expect(
      buildModelOptions({ ...config, providers: config.providers.slice(0, 1) }, null, undefined)[0]
        ?.providerBadge?.showBadge,
    ).toBe(false);
  });

  it("only badges ACP accounts that share the same agent", () => {
    const config = {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          acp_one: { driver: "acpRegistry", enabled: true, config: { agentId: "one" } },
          acp_two: { driver: "acpRegistry", enabled: true, config: { agentId: "two" } },
        },
      },
      providers: ["acp_one", "acp_two"].map((instanceId) => ({
        instanceId,
        driver: "acpRegistry",
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        models: [{ slug: "test", name: "Test", capabilities: null }],
      })),
    } as unknown as ServerConfig;
    expect(
      buildModelOptions(config, null, undefined).map((option) => option.providerBadge?.showBadge),
    ).toEqual([false, false]);
    const shared = {
      ...config,
      settings: {
        ...config.settings,
        providerInstances: {
          ...config.settings.providerInstances,
          acp_two: config.settings.providerInstances[ProviderInstanceId.make("acp_one")]!,
        },
      },
    };
    expect(
      buildModelOptions(shared, null, undefined).map((option) => option.providerBadge?.showBadge),
    ).toEqual([true, true]);
  });

  it.each(["disabled", "unavailable", "missing"] as const)(
    "retains the selected %s provider's fallback in a filtered catalog",
    (state) => {
      const selection = {
        instanceId: ProviderInstanceId.make("google_work"),
        model: "saved-model",
        options: [{ id: "native-option", value: "saved-choice" }],
      };
      const provider = {
        instanceId: selection.instanceId,
        driver: "antigravity",
        displayName: "Google Work",
        enabled: state !== "disabled",
        installed: true,
        availability: state === "unavailable" ? "unavailable" : "available",
        auth: { status: "authenticated" },
        models: [{ slug: selection.model, name: "Saved model", capabilities: null }],
      };
      const config = {
        providers: state === "missing" ? [] : [provider],
        settings: { providerInstances: { google_work: { driver: "antigravity" } } },
      } as unknown as ServerConfig;
      const options = buildModelOptions(config, selection, selection.instanceId);
      expect(options).toEqual(buildModelOptions(config, selection, undefined));
      expect(options).toHaveLength(1);
      expect(options[0]).toMatchObject({ selection, isUnavailable: true });
    },
  );

  it("rejects stored selections whose provider is not usable", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          enabled: false,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
      ],
    } as unknown as ServerConfig;

    const usable = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    };
    const disabled = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    };
    const removed = {
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-5.6-sol",
    };

    expect(resolveSelectableModelSelection(config, usable)).toBe(usable);
    expect(resolveSelectableModelSelection(config, disabled)).toBeNull();
    expect(resolveSelectableModelSelection(config, removed)).toBeNull();
    expect(isModelSelectionUnavailable(config, disabled)).toBe(true);
    expect(isModelSelectionUnavailable(config, removed)).toBe(false);
    expect(resolveSelectableModelSelection(null, disabled)).toBe(disabled);
  });

  describe("Antigravity selections", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("google_work"),
      model: "gemini-3.1-pro-high",
      options: [{ id: "native-option", value: "saved/opaque-choice" }],
    };
    const model = {
      slug: selection.model,
      name: "Gemini 3.1 Pro High",
      subProvider: "Google",
      isCustom: false,
      isDefault: true,
      isLegacy: true,
      capabilities: {
        optionDescriptors: [
          {
            id: "native-option",
            label: "Native option",
            type: "select",
            options: [{ id: "current/default", label: "Default", isDefault: true }],
            currentValue: "current/default",
          },
        ],
      },
    };
    const config = {
      providers: [
        {
          instanceId: selection.instanceId,
          driver: "antigravity",
          displayName: "Google Work",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [model],
        },
      ],
    } as unknown as ServerConfig;

    it.each([
      ["disabled", { enabled: false }],
      ["signed out", { auth: { status: "unauthenticated" } }],
    ] as const)("keeps a %s provider's selection and known model details", (_state, update) => {
      const unavailableConfig = {
        ...config,
        providers: config.providers.map((provider) => ({ ...provider, ...update })),
      };

      expect(resolveSelectableModelSelection(unavailableConfig, selection)).toBe(selection);
      expect(resolveDefaultableModelSelection(unavailableConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(unavailableConfig, selection)).toBe(true);
      expect(buildModelOptions(unavailableConfig, null, undefined)).toEqual([]);
      const [option] = buildModelOptions(unavailableConfig, selection, undefined);
      expect(option).toMatchObject({
        key: `google_work:${selection.model}`,
        label: model.name,
        subtitle: "Google",
        providerKey: "google_work",
        providerLabel: "Google Work",
        providerDriver: "antigravity",
        isDefault: false,
        isLegacy: true,
        isUnavailable: true,
        capabilities: model.capabilities,
      });
      expect(option?.selection).toBe(selection);
    });

    it("keeps an exact selection when its model leaves and returns to the catalog", () => {
      const changedConfig = {
        ...config,
        providers: config.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({ ...model, slug: "gemini-3.1-pro-low" })),
        })),
      };

      expect(resolveDefaultableModelSelection(changedConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(changedConfig, selection)).toBe(true);
      const options = buildModelOptions(changedConfig, selection, undefined);
      const missing = options.find((option) => option.selection.model === selection.model);
      expect(missing).toMatchObject({
        label: selection.model,
        providerLabel: "Google Work",
        providerDriver: "antigravity",
        isUnavailable: true,
        capabilities: null,
      });
      expect(missing?.selection).toBe(selection);
      expect(
        resolveNewTaskModelSelection({
          draftSelection: null,
          defaultSelection: resolveDefaultableModelSelection(changedConfig, selection),
          stickySelection: null,
          modelOptions: options,
        }),
      ).toBe(selection);

      const [restored] = buildModelOptions(config, selection, undefined);
      expect(isModelSelectionUnavailable(config, selection)).toBe(false);
      expect(restored?.isUnavailable).not.toBe(true);
      expect(restored?.selection).toBe(selection);
      expect(resolveDefaultableModelSelection(config, selection)).toBe(selection);
      expect(buildModelOptions(config, null, undefined)[0]?.selection.options).toBeUndefined();
    });

    it("uses configured instance metadata when provider status is missing", () => {
      const missingStatusConfig = {
        providers: [],
        settings: {
          providerInstances: {
            [selection.instanceId]: { driver: "antigravity", displayName: "Google Work" },
          },
        },
      } as unknown as ServerConfig;

      expect(resolveDefaultableModelSelection(missingStatusConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(missingStatusConfig, selection)).toBe(true);
      expect(buildModelOptions(missingStatusConfig, selection, undefined)).toMatchObject([
        {
          providerDriver: "antigravity",
          providerLabel: "Google Work",
          isUnavailable: true,
          selection,
        },
      ]);
    });

    it("keeps offline selections without assuming that an unknown instance is Antigravity", () => {
      const unknownConfig = { ...config, providers: [] };

      expect(resolveDefaultableModelSelection(null, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(null, selection)).toBe(false);
      expect(buildModelOptions(null, selection, undefined)[0]?.selection).toBe(selection);
      expect(buildModelOptions(null, selection, undefined)[0]?.isUnavailable).not.toBe(true);
      expect(isModelSelectionUnavailable(unknownConfig, selection)).toBe(false);
      expect(resolveSelectableModelSelection(unknownConfig, selection)).toBeNull();
    });
  });

  it("keeps legacy models out of implicit defaults", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isCustom: false, capabilities: null },
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isLegacy: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const current = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" };
    const legacy = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

    expect(resolveDefaultableModelSelection(config, current)).toBe(current);
    expect(resolveDefaultableModelSelection(config, legacy)).toBeNull();
    expect(resolveDefaultableModelSelection(null, legacy)).toBe(legacy);
  });

  it("resolves new tasks from draft, project, sticky, then provider defaults", () => {
    const draft = { instanceId: ProviderInstanceId.make("codex"), model: "draft" };
    const project = { instanceId: ProviderInstanceId.make("codex"), model: "project" };
    const sticky = { instanceId: ProviderInstanceId.make("codex"), model: "sticky" };
    const providerDefault = {
      selection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
      isDefault: true,
    } as ModelOption;
    const resolve = (
      draftSelection: ModelSelection | null,
      defaultSelection: ModelSelection | null,
      stickySelection: ModelSelection | null,
    ) =>
      resolveNewTaskModelSelection({
        draftSelection,
        defaultSelection,
        stickySelection,
        modelOptions: [providerDefault],
      });

    expect(resolve(draft, project, sticky)).toBe(draft);
    expect(resolve(null, project, sticky)).toBe(project);
    expect(resolve(null, null, sticky)).toBe(sticky);
    expect(resolve(null, null, null)).toBe(providerDefault.selection);

    const unavailable = { ...providerDefault, isUnavailable: true };
    expect(
      resolveNewTaskModelSelection({
        draftSelection: null,
        defaultSelection: null,
        stickySelection: null,
        modelOptions: [unavailable],
      }),
    ).toBeNull();
  });
});

describe("synchronized mobile model visibility", () => {
  const provider = ProviderInstanceId.make("codex_work");
  const other = ProviderInstanceId.make("codex_personal");
  const models = [
    { slug: "hidden", name: "Hidden", isCustom: false, capabilities: null },
    { slug: "first", name: "First", isCustom: false, capabilities: null },
    { slug: "second", name: "Second", isCustom: false, capabilities: null },
    { slug: "custom", name: "Custom", isCustom: true, capabilities: null },
  ];
  const config = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [provider]: { driver: ProviderDriverKind.make("codex"), enabled: true },
        [other]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      providerModelPreferences: {
        [provider]: {
          hiddenModels: ["hidden", "custom", "missing"],
          modelOrder: ["second", "first"],
        },
      },
    },
    providers: [provider, other].map((instanceId) => ({
      instanceId,
      continuation: { groupKey: instanceId },
      driver: "codex",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models,
    })),
  } as unknown as ServerConfig;

  it("applies server visibility and ordering independently to each provider instance", () => {
    const options = buildModelOptions(config, null, undefined);
    expect(
      options
        .filter((option) => option.providerKey === provider)
        .map((option) => option.selection.model),
    ).toEqual(["second", "first", "custom"]);
    expect(
      options
        .filter((option) => option.providerKey === other)
        .map((option) => option.selection.model),
    ).toEqual(["hidden", "first", "second", "custom"]);
  });

  it("exposes hidden built-ins for management without offering custom visibility controls", () => {
    const options = buildModelOptions(
      config,
      { instanceId: provider, model: "hidden" },
      provider,
      true,
    );
    expect(options.map((option) => option.selection.model)).toEqual([
      "second",
      "first",
      "hidden",
      "custom",
    ]);
    expect(options.find((option) => option.selection.model === "hidden")).toMatchObject({
      isHidden: true,
      canHide: true,
    });
    expect(options.find((option) => option.selection.model === "custom")).toMatchObject({
      isHidden: false,
      canHide: false,
    });
  });

  it.each(["hidden", "missing"])("does not resurrect the hidden fallback %s", (model) => {
    expect(
      buildModelOptions(config, { instanceId: provider, model }, provider).map(
        (option) => option.selection.model,
      ),
    ).toEqual(["second", "first", "custom"]);
  });

  // regression: #16816 sync model favorites and visibility across clients
  it("keeps custom models visible and restores built-in models when the server clears hidden models", () => {
    expect(
      buildModelOptions(config, { instanceId: provider, model: "custom" }, provider).map(
        (option) => option.selection.model,
      ),
    ).toContain("custom");
    const cleared = { ...config, settings: { ...config.settings, providerModelPreferences: {} } };
    expect(
      buildModelOptions(cleared, null, provider).map((option) => option.selection.model),
    ).toEqual(["hidden", "first", "second", "custom"]);
  });
});
