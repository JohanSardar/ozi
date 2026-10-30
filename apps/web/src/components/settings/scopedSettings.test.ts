import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  EnvironmentId,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import * as Cause from "effect/Cause";
import {
  persistScopedSettingsPatch,
  planScopedSettingsPatch,
  scopedIdleCompaction,
  selectScopedSettingsEnvironments,
} from "./scopedSettings";
import { resolveSettingsScope } from "./settingsScope";

function environment(
  id: string,
  options: {
    connected?: boolean;
    loaded?: boolean;
    settings?: Partial<ServerSettings>;
  } = {},
) {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    connection: {
      phase: options.connected === false ? ("offline" as const) : ("connected" as const),
    },
    serverConfig:
      options.loaded === false
        ? null
        : {
            settings: { ...DEFAULT_SERVER_SETTINGS, ...options.settings },
          },
  };
}

const laptop = environment("Laptop");
const server = environment("Server");
const offline = environment("Offline", { connected: false });
const loading = environment("Loading", { loaded: false });
const environments = [laptop, server, offline, loading];
const all = resolveSettingsScope({}, environments);
const named = resolveSettingsScope({ machine: server.environmentId }, environments);

describe("scoped settings targets", () => {
  it("uses the named environment even when a different primary is available", () => {
    const selected = selectScopedSettingsEnvironments(named, environments, laptop.environmentId);
    expect(selected.environments).toEqual([server]);
    expect(selected.environment).toBe(server);
  });

  it("keeps an offline named environment selected without falling back to primary", () => {
    const scope = resolveSettingsScope({ machine: offline.environmentId }, environments);
    const selected = selectScopedSettingsEnvironments(scope, environments, laptop.environmentId);
    expect(selected.environments).toEqual([offline]);
    expect(selected.connectedEnvironments).toEqual([]);
    expect(selected.environment).toBeNull();
    expect(
      planScopedSettingsPatch(scope, environments, { enableProviderUpdateChecks: false }),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: "Connect Offline to save this setting.",
    });
  });
});

describe("scoped settings writes", () => {
  it("compares idle compaction by mode, and offers Never only where every server stores it", () => {
    const fixed = {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        compactIdleThreads: false,
        idleCompaction: "onReturn" as const,
      },
    };
    const modes = {
      settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: "onReturn" as const },
    };
    const legacy = { settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: false } };
    expect(scopedIdleCompaction([fixed, modes])).toEqual({ mixed: false, neverAvailable: true });
    expect(scopedIdleCompaction([fixed, legacy])).toEqual({ mixed: false, neverAvailable: false });
    expect(
      scopedIdleCompaction([fixed, { settings: { ...fixed.settings, idleCompaction: "off" } }])
        .mixed,
    ).toBe(true);
  });

  it("sends an idle compaction mode in the form each environment's server reads", () => {
    const targets = [
      environment("Fixed", { settings: { compactIdleThreads: false, idleCompaction: "onReturn" } }),
      environment("Modes", { settings: { compactIdleThreads: "onReturn" } }),
      environment("Switch", { settings: { compactIdleThreads: false } }),
    ];
    const plan = planScopedSettingsPatch(resolveSettingsScope({}, targets), targets, {
      idleCompaction: "beforeCacheExpires",
    });
    expect(plan.serverWrites.map((write) => write.patch)).toEqual([
      { idleCompaction: "beforeCacheExpires" },
      { compactIdleThreads: "beforeCacheExpires" },
      { compactIdleThreads: true },
    ]);
  });

  it("writes an aggregate preference only to connected environments with loaded configuration", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(all, environments, { enableProviderUpdateChecks: false }),
      persistServer,
      persistClient,
    );
    expect(persistServer.mock.calls.map(([input]) => input.environmentId)).toEqual([
      laptop.environmentId,
      server.environmentId,
    ]);
    expect(persistClient).not.toHaveBeenCalled();
  });

  describe("an environment that saves but drops keys it does not know", () => {});

  it("persists client keys locally at any scope alongside server keys", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(named, environments, {
        enableProviderUpdateChecks: false,
      }),
      persistServer,
      persistClient,
    );
    expect(persistClient).toHaveBeenCalledExactlyOnceWith({});
    expect(persistServer).toHaveBeenCalledExactlyOnceWith({
      environmentId: server.environmentId,
      input: { patch: { enableProviderUpdateChecks: false } },
    });
  });

  it("never substitutes an environment-default write for an invalid scope", () => {
    const scope = resolveSettingsScope({ machine: "removed" }, environments);
    const plan = planScopedSettingsPatch(scope, environments, { enableAgentBrowserAccess: false });
    expect(plan.serverWrites).toEqual([]);
    expect(plan.hasClientWrite).toBe(false);
    expect(plan.unavailableReason).not.toBeNull();
  });

  it("waits for every target and identifies both RPC failures and rejected writes", async () => {
    const third = environment("Third");
    const fourth = environment("Fourth");
    const selected = [...environments, third, fourth];
    const scope = resolveSettingsScope({}, selected);
    const persistServer = vi
      .fn()
      .mockResolvedValueOnce({ _tag: "Success" })
      .mockResolvedValueOnce({
        _tag: "Failure",
        cause: Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: "settings:write",
            message: "This connection lacks permission to change settings.",
          }),
        ),
      })
      .mockRejectedValueOnce(new Error("Disconnected during save"))
      .mockResolvedValueOnce({ _tag: "Success" });
    const result = await persistScopedSettingsPatch(
      planScopedSettingsPatch(scope, selected, { enableAgentBrowserAccess: false }),
      persistServer,
      vi.fn(),
    );
    expect(result.savedEnvironmentCount).toBe(2);
    expect(result.savedEnvironments.map(({ label }) => label)).toEqual([
      laptop.label,
      fourth.label,
    ]);
    expect(result.failedEnvironments.map(({ message }) => message)).toEqual([
      "This connection lacks permission to change settings.",
      "Disconnected during save",
    ]);
    expect(result.failedEnvironments.map(({ label }) => label)).toEqual([
      server.label,
      third.label,
    ]);
    expect(persistServer).toHaveBeenCalledTimes(4);
  });
});

describe("scoped settings mixed values", () => {});

describe("project overrides at environment scope", () => {});

describe("null patches at project scope", () => {});

describe("partial object patches at project scope", () => {});

it("routes legacy model preference keys exclusively to the selected environment", () => {
  const patch = {
    favorites: [{ provider: ProviderInstanceId.make("codex"), model: "sol" }],
    providerModelPreferences: {},
  };
  const plan = planScopedSettingsPatch(named, environments, patch);
  expect(plan.clientPatch).toEqual({});
  expect(plan.hasClientWrite).toBe(false);
  expect(plan.serverWrites).toEqual([
    {
      environmentId: server.environmentId,
      label: server.label,
      previous: expect.anything(),
      patch,
    },
  ]);
});
