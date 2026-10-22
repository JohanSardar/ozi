import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

export type ProviderUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly status: "behind_latest";
    readonly latestVersion: string;
  };
};

export type ProviderSettingsUpdateCandidate = ServerProvider & {
  readonly versionAdvisory: NonNullable<ServerProvider["versionAdvisory"]> & {
    readonly canUpdate: true;
    readonly updateCommand: string;
  };
};

export type ProviderUpdateToastType = "warning" | "loading" | "error" | "success";
export type ProviderUpdateToastPhase = "initial" | "running" | "failed" | "unchanged" | "succeeded";

export interface ProviderUpdateToastView {
  readonly phase: ProviderUpdateToastPhase;
  readonly type: ProviderUpdateToastType;
  readonly title: string;
  readonly description: string;
  readonly dismissAfterVisibleMs?: number;
}

export type ProviderUpdateSidebarPillTone = "loading" | "warning" | "error" | "success";

export interface ProviderUpdateSidebarPillView {
  readonly key: string;
  readonly tone: ProviderUpdateSidebarPillTone;
  readonly title: string;
  readonly description: string;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

function chooseRepresentativeProvider(
  current: ServerProvider | undefined,
  candidate: ServerProvider,
): ServerProvider {
  if (!current) {
    return candidate;
  }
  const defaultInstanceId = defaultInstanceIdForDriver(candidate.driver);
  if (candidate.instanceId === defaultInstanceId) {
    return candidate;
  }
  if (current.instanceId === defaultInstanceId) {
    return current;
  }
  return candidate.checkedAt.localeCompare(current.checkedAt) >= 0 ? candidate : current;
}

function dedupeProvidersByDriver<T extends ServerProvider>(providers: ReadonlyArray<T>): T[] {
  const latestProviderByDriver = new Map<ProviderDriverKind, T>();

  for (const provider of providers) {
    latestProviderByDriver.set(
      provider.driver,
      chooseRepresentativeProvider(latestProviderByDriver.get(provider.driver), provider) as T,
    );
  }

  return [...latestProviderByDriver.values()];
}

function getProviderUpdatedDescription(providerCount: number): string {
  return providerCount === 1
    ? "New sessions will use the updated provider."
    : "New sessions will use the updated providers.";
}

function isProviderUpdateCandidate(provider: ServerProvider): provider is ProviderUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.latestVersion !== null
  );
}

export function isProviderUpdateActive(provider: Pick<ServerProvider, "updateState">): boolean {
  return provider.updateState?.status === "queued" || provider.updateState?.status === "running";
}

export function collectProviderUpdateCandidates(
  providers: ReadonlyArray<ServerProvider>,
): ProviderUpdateCandidate[] {
  return dedupeProvidersByDriver(providers.filter(isProviderUpdateCandidate));
}

export function isProviderSettingsUpdateCandidate(
  provider: ServerProvider,
): provider is ProviderSettingsUpdateCandidate {
  return (
    provider.enabled &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "broken" &&
    provider.compatibilityAdvisory?.latestVersionStatus !== "unsupported" &&
    provider.versionAdvisory?.status === "behind_latest" &&
    provider.versionAdvisory.canUpdate === true &&
    provider.versionAdvisory.updateCommand !== null
  );
}

function hasOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  if (
    candidate.versionAdvisory.canUpdate !== true ||
    candidate.versionAdvisory.updateCommand === null
  ) {
    return false;
  }

  const driverProviders = providers.filter((provider) => provider.driver === candidate.driver);
  if (driverProviders.length === 0) {
    return false;
  }

  const updateCommands = new Set<string>();
  for (const provider of driverProviders) {
    if (!isProviderUpdateCandidate(provider)) {
      continue;
    }
    const advisory = provider.versionAdvisory;
    if (!advisory || advisory.canUpdate !== true || advisory.updateCommand === null) {
      return false;
    }
    updateCommands.add(advisory.updateCommand);
  }

  return updateCommands.size === 1;
}

export function canOneClickUpdateProviderCandidate(
  candidate: ProviderUpdateCandidate,
  providers: ReadonlyArray<ServerProvider>,
): boolean {
  return (
    !isProviderUpdateActive(candidate) && hasOneClickUpdateProviderCandidate(candidate, providers)
  );
}

export interface ProviderUpdateRun {
  readonly environmentId: EnvironmentId;
  readonly machineLabel: string;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly result: AtomCommandResult<
    { readonly providers: ReadonlyArray<ServerProvider> },
    unknown
  >;
}

function getProviderUpdateRunOutcome(
  run: ProviderUpdateRun,
):
  | { readonly status: "interrupted" | "updated" }
  | { readonly status: "failed"; readonly line: string } {
  if (isAtomCommandInterrupted(run.result)) return { status: "interrupted" };
  const label = `${run.machineLabel} · ${PROVIDER_DISPLAY_NAMES[run.driver] ?? run.driver}`;
  if (run.result._tag === "Failure") {
    const error = squashAtomCommandFailure(run.result);
    return {
      status: "failed",
      line: `${label}: ${error instanceof Error ? error.message : "Provider update failed."}`,
    };
  }
  const updateState = run.result.value.providers.find(
    (provider) => provider.instanceId === run.instanceId,
  )?.updateState;
  return updateState?.status === "succeeded"
    ? { status: "updated" }
    : {
        status: "failed",
        line: `${label}: ${updateState?.message ?? "Provider update did not finish."}`,
      };
}

export function getProviderUpdateRunToastView(
  runs: ReadonlyArray<ProviderUpdateRun>,
): Pick<ProviderUpdateToastView, "type" | "title" | "description"> | null {
  const settled = runs
    .map(getProviderUpdateRunOutcome)
    .filter((outcome) => outcome.status !== "interrupted");
  if (settled.length === 0) {
    return null;
  }
  const failureLines = settled.flatMap((outcome) =>
    outcome.status === "failed" ? [outcome.line] : [],
  );
  if (failureLines.length === 0) {
    return {
      type: "success",
      title: settled.length === 1 ? "Provider updated" : `${settled.length} providers updated`,
      description: getProviderUpdatedDescription(settled.length),
    };
  }
  return {
    type: "error",
    title:
      failureLines.length < settled.length
        ? `${failureLines.length} of ${settled.length} provider updates failed`
        : settled.length === 1
          ? "Provider update failed"
          : "Provider updates failed",
    description: failureLines.join("\n"),
  };
}

export interface LocalProviderUpdateOutcome {
  readonly environmentId: EnvironmentId;
  readonly isPrimary: boolean;
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | null;
}

export type EnvironmentUpdateConnectionState = "connecting" | "ready" | "disconnected" | "error";

export interface LocalEnvironmentProvidersInput {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly connectionState: EnvironmentUpdateConnectionState;
  readonly providers: ReadonlyArray<ServerProvider>;
}

export interface LocalEnvironmentUpdateGroup {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly isSettling: boolean;
  readonly candidates: ProviderUpdateCandidate[];
  readonly providers: ReadonlyArray<ServerProvider>;
}

export type ProviderUpdateRowStatusKind = "idle" | "loading" | "success" | "failed" | "unchanged";

export interface ProviderUpdateRowStatus {
  readonly kind: ProviderUpdateRowStatusKind;
  readonly text: string;
}
