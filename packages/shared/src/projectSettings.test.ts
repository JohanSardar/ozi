import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createModelSelection } from "./model.ts";
import { hasProjectSettingsOverrides, resolveProjectSettings } from "./projectSettings.ts";
import { applyServerSettingsPatch } from "./serverSettings.ts";

const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");

describe("resolveSendEnvMode", () => {});

describe("resolveProjectSettings", () => {
  it("ignores an override left undefined by a forward-compatible decode", () => {
    const resolved = resolveProjectSettings(
      {
        ...DEFAULT_SERVER_SETTINGS,
        defaultRuntimeMode: "full-access",
        projectSettingsOverrides: { [projectId]: { defaultRuntimeMode: undefined } as never },
      },
      projectId,
    );
    expect(resolved.settings.defaultRuntimeMode).toBe("full-access");
    expect(resolved.sources.defaultRuntimeMode).toBe("environment");
    expect(
      hasProjectSettingsOverrides({
        projectSettingsOverrides: { [projectId]: { defaultRuntimeMode: undefined } as never },
      }),
    ).toBe(false);
  });

  it("keeps the environment default model when the override's provider is disabled", () => {
    const disabledSelection = createModelSelection(ProviderInstanceId.make("claudeAgent"), "opus");
    const settings = applyServerSettingsPatch(DEFAULT_SERVER_SETTINGS, {
      providerInstances: {
        [ProviderInstanceId.make("claudeAgent")]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: false,
        },
      },
      projectSettingsOverrides: { [projectId]: { defaultModelSelection: disabledSelection } },
    });
    const resolved = resolveProjectSettings(settings, projectId);
    expect(resolved.settings.defaultModelSelection).toBeNull();
    expect(resolved.sources.defaultModelSelection).toBe("environment");
  });

  it("moves text generation off an instance the project turned off", () => {
    const codex = ProviderInstanceId.make("codex");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(codex, "gpt-5"),
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [codex]: { enabled: false } } },
      },
    };
    expect(
      resolveProjectSettings(settings, projectId).settings.textGenerationModelSelection.instanceId,
    ).toBe(ProviderInstanceId.make("claudeAgent"));
    expect(
      resolveProjectSettings(settings, otherProjectId).settings.textGenerationModelSelection,
    ).toEqual(settings.textGenerationModelSelection);
  });

  it("falls back to a configured instance when every built-in one is off for the project", () => {
    const codex = ProviderInstanceId.make("codex");
    const codexWork = ProviderInstanceId.make("codex_work");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: createModelSelection(codex, "gpt-5"),
      providerInstances: { [codexWork]: { driver: ProviderDriverKind.make("codex"), config: {} } },
      projectSettingsOverrides: {
        [projectId]: {
          providerInstances: {
            [codex]: { enabled: false },
            [ProviderInstanceId.make("claudeAgent")]: { enabled: false },
          },
        },
      },
    };
    expect(
      resolveProjectSettings(settings, projectId).settings.textGenerationModelSelection.instanceId,
    ).toBe(codexWork);
  });
});

describe("resolveProjectSettings with a t3.json", () => {});

describe("projectSettingsOverrides patches", () => {});
