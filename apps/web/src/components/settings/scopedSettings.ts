import {
  ClientSettingsSchema,
  type ClientSettingsPatch,
  type EnvironmentId,
  globalIdleCompaction,
  idleCompactionPatch,
  readsIdleCompactionModes,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import * as Equal from "effect/Equal";
import * as Cause from "effect/Cause";

import type { ResolvedSettingsScope } from "./settingsScope";

export type ScopedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

interface ScopedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly settings: ServerSettings;
  } | null;
}

const SERVER_KEYS = new Set<string>(Object.keys(ServerSettings.fields));
const CLIENT_KEYS = new Set<string>(Object.keys(ClientSettingsSchema.fields));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConnectedWithConfig(
  environment: Pick<ScopedSettingsEnvironment, "connection" | "serverConfig">,
) {
  return environment.connection.phase === "connected" && environment.serverConfig !== null;
}

/** The representative supplies display values, never the set of write targets. */
export function selectScopedSettingsEnvironments<T extends ScopedSettingsEnvironment>(
  scope: ResolvedSettingsScope,
  available: readonly T[],
  primaryEnvironmentId: EnvironmentId | null,
) {
  const selectedIds = new Set(scope.environmentIds);
  const environments = available.filter((environment) =>
    selectedIds.has(environment.environmentId),
  );
  const connectedEnvironments = environments.filter(isConnectedWithConfig);
  const environment =
    connectedEnvironments.find((candidate) => candidate.environmentId === primaryEnvironmentId) ??
    connectedEnvironments[0] ??
    null;
  return { environments, connectedEnvironments, environment };
}

export interface ScopedSettingsTarget {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly settings: ServerSettings;
}

export function resolveScopedSettingsTargets(
  connectedEnvironments: readonly ScopedSettingsEnvironment[],
): readonly ScopedSettingsTarget[] {
  return connectedEnvironments.flatMap((environment) =>
    environment.serverConfig
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            settings: environment.serverConfig.settings,
          },
        ]
      : [],
  );
}

export function scopedSettingsAreMixed(
  targets: readonly Pick<ScopedSettingsTarget, "settings">[],
  keys: readonly (keyof ServerSettings)[],
): boolean {
  const first = targets[0];
  return (
    first !== undefined &&
    targets.some((candidate) =>
      keys.some((key) => !Equal.equals(first.settings[key], candidate.settings[key])),
    )
  );
}

/**
 * Servers store the idle compaction mode differently by version, so selected
 * environments are compared by the mode each resolves to, and "Never" is offered
 * only when every one of them can store it.
 */
export function scopedIdleCompaction(targets: readonly Pick<ScopedSettingsTarget, "settings">[]) {
  const modes = targets.map((candidate) => globalIdleCompaction(candidate.settings));
  return {
    mixed: modes.some((mode) => mode !== modes[0]),
    neverAvailable: targets.every((candidate) => readsIdleCompactionModes(candidate.settings)),
  };
}

interface ScopedServerWrite {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly patch: ServerSettingsPatch;
  readonly previous: ServerSettings;
}

/** Puts an idle compaction mode in the form each destination server reads. */
function forDestination(previous: ServerSettings, patch: ServerSettingsPatch): ServerSettingsPatch {
  if (patch.idleCompaction === undefined) return patch;
  const { idleCompaction, compactIdleThreads: _legacy, ...rest } = patch;
  return { ...rest, ...idleCompactionPatch(previous, idleCompaction) };
}

export function planScopedSettingsPatch(
  scope: ResolvedSettingsScope,
  environments: readonly ScopedSettingsEnvironment[],
  patch: ScopedSettingsPatch,
) {
  const clientPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => CLIENT_KEYS.has(key) && !SERVER_KEYS.has(key)),
  ) as ClientSettingsPatch;
  const serverPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => SERVER_KEYS.has(key)),
  ) as ServerSettingsPatch;
  const serverKeys = Object.keys(serverPatch);
  const { connectedEnvironments } = selectScopedSettingsEnvironments(scope, environments, null);
  const serverWrites: ScopedServerWrite[] =
    serverKeys.length === 0
      ? []
      : connectedEnvironments.flatMap((environment) => {
          const previous = environment.serverConfig?.settings;
          return previous
            ? [
                {
                  environmentId: environment.environmentId,
                  label: environment.label,
                  previous,
                  patch: forDestination(previous, serverPatch),
                },
              ]
            : [];
        });
  const hasClientWrite = Object.keys(clientPatch).length > 0;
  const hasWrite = hasClientWrite || serverWrites.length > 0;
  const unavailableReason =
    hasWrite || Object.keys(patch).length === 0
      ? null
      : scope.kind === "unavailable"
        ? scope.message
        : "Connect an environment to save this setting.";
  return { clientPatch, hasClientWrite, serverWrites, unavailableReason };
}

function writeWasDropped(value: unknown, before: unknown, saved: unknown): boolean {
  if (value === null) return before != null && Equal.equals(saved, before);
  if (isPlainObject(value) && !Array.isArray(before) && !Array.isArray(saved)) {
    const field = (source: unknown, key: string) =>
      isPlainObject(source) ? source[key] : undefined;
    return Object.entries(value).some(([key, next]) =>
      writeWasDropped(next, field(before, key), field(saved, key)),
    );
  }
  const unchanged =
    typeof value === "string" && typeof before === "string"
      ? value.trim() === before
      : Equal.equals(value, before);
  return !unchanged && Equal.equals(saved, before);
}

/** Older servers silently drop unknown keys; report them so rows cannot stay mixed forever. */
function droppedSettingKeys(write: ScopedServerWrite, saved: ServerSettings | undefined) {
  if (saved === undefined) return [];
  return Object.entries(write.patch).flatMap(([key, value]) =>
    writeWasDropped(
      value,
      write.previous[key as keyof ServerSettings],
      saved[key as keyof ServerSettings],
    )
      ? [key]
      : [],
  );
}

export async function persistScopedSettingsPatch(
  plan: ReturnType<typeof planScopedSettingsPatch>,
  persistServer: (input: {
    environmentId: EnvironmentId;
    input: { patch: ServerSettingsPatch };
  }) => Promise<{
    readonly _tag: "Success" | "Failure";
    readonly cause?: Cause.Cause<unknown>;
    readonly value?: ServerSettings;
  }>,
  persistClient: (patch: ClientSettingsPatch) => void,
) {
  if (plan.hasClientWrite) persistClient(plan.clientPatch);
  const results = await Promise.allSettled(
    plan.serverWrites.map(({ environmentId, patch }) =>
      persistServer({ environmentId, input: { patch } }),
    ),
  );
  const saved = (index: number) => {
    const result = results[index];
    return (
      result?.status === "fulfilled" &&
      result.value._tag === "Success" &&
      droppedSettingKeys(plan.serverWrites[index]!, result.value.value).length === 0
    );
  };
  const failedEnvironments = plan.serverWrites.flatMap((environment, index) => {
    if (saved(index)) return [];
    const result = results[index];
    if (result?.status === "fulfilled" && result.value._tag === "Success") {
      return [
        {
          ...environment,
          message: "This environment does not support this setting. Update Ozi on it.",
        },
      ];
    }
    const error: unknown =
      result?.status === "rejected"
        ? result.reason
        : result?.status === "fulfilled" && result.value.cause
          ? Cause.squash(result.value.cause)
          : undefined;
    return [
      {
        ...environment,
        message:
          error instanceof Error
            ? error.message
            : "The save failed. Try reconnecting and saving again.",
      },
    ];
  });
  const savedEnvironments = plan.serverWrites.filter((_, index) => saved(index));
  return {
    failedEnvironments,
    savedEnvironments,
    savedEnvironmentCount: savedEnvironments.length,
  };
}
