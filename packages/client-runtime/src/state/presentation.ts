import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";
export interface EnvironmentConnectionSummary {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly displayUrl: string;
  readonly isEnabled: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
}
import { type EnvironmentId, type ServerConfig, type ServerProvider } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE, type SupervisorConnectionState } from "../connection/model.ts";
import {
  presentEnvironmentConnection,
  type EnvironmentConnectionPresentation,
  type EnvironmentPresentation,
  type EnvironmentServerConfig,
} from "../connection/presentation.ts";
import { type EnvironmentCatalogState, enabledEnvironmentIds } from "./connections.ts";

function mapsEqual<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function sameConnection(
  left: EnvironmentConnectionPresentation,
  right: EnvironmentConnectionPresentation,
): boolean {
  return left.phase === right.phase && left.error === right.error && left.traceId === right.traceId;
}

function withoutProviders(
  config: ServerConfig | null,
  previous: EnvironmentServerConfig | null,
): EnvironmentServerConfig | null {
  if (config === null) {
    return null;
  }
  const { providers: _providers, ...next } = config;
  if (previous === null) {
    return next;
  }
  const keys = Object.keys(next) as Array<keyof EnvironmentServerConfig>;
  return keys.length === Object.keys(previous).length &&
    keys.every((key) => key in previous && previous[key] === next[key])
    ? previous
    : next;
}

export interface EnvironmentPresentationWithProviders extends Omit<
  EnvironmentPresentation,
  "serverConfig"
> {
  readonly serverConfig: ServerConfig | null;
}

export function createEnvironmentPresentationAtoms<E>(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly stateAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<SupervisorConnectionState, E>>;
  readonly serverConfigValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
}) {
  const presentationAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      const entry = get(input.catalogValueAtom).entries.get(environmentId);
      if (entry === undefined) {
        return null;
      }
      const state = Option.getOrElse(
        AsyncResult.value(get(input.stateAtom(environmentId))),
        () => AVAILABLE_CONNECTION_STATE,
      );
      const previous = Option.getOrNull(get.self<EnvironmentPresentation | null>());
      const connection: EnvironmentConnectionPresentation =
        entry.unsupportedReason === undefined
          ? presentEnvironmentConnection(state)
          : { phase: "unsupported", error: entry.unsupportedReason, traceId: null };
      const next = {
        entry,
        connection:
          previous !== null && sameConnection(previous.connection, connection)
            ? previous.connection
            : connection,
        serverConfig: withoutProviders(
          get(input.serverConfigValueAtom(environmentId)),
          previous?.serverConfig ?? null,
        ),
      } satisfies EnvironmentPresentation;
      return previous !== null &&
        previous.entry === next.entry &&
        previous.connection === next.connection &&
        previous.serverConfig === next.serverConfig
        ? previous
        : next;
    }).pipe(Atom.withLabel(`environment-presentation:${environmentId}`)),
  );

  let previous: ReadonlyMap<EnvironmentId, EnvironmentPresentation> = new Map();
  const presentationsAtom = Atom.make((get) => {
    const next = new Map<EnvironmentId, EnvironmentPresentation>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const presentation = get(presentationAtom(environmentId));
      if (presentation !== null) {
        next.set(environmentId, presentation);
      }
    }
    if (mapsEqual(previous, next)) {
      return previous;
    }
    previous = next;
    return previous;
  }).pipe(Atom.withLabel("environment-presentations"));

  // Enabled environments only, like the full server-configs map, but without providers, so
  // capability checks on every sidebar row and markdown link skip provider status pushes.
  const serverConfigsAtom = Atom.make((get) => {
    const next = new Map<EnvironmentId, EnvironmentServerConfig>();
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      const serverConfig = get(presentationAtom(environmentId))?.serverConfig;
      if (serverConfig != null) {
        next.set(environmentId, serverConfig);
      }
    }
    const previous = Option.getOrNull(
      get.self<ReadonlyMap<EnvironmentId, EnvironmentServerConfig>>(),
    );
    return previous !== null && mapsEqual(previous, next) ? previous : next;
  }).pipe(Atom.withLabel("environment-server-configs-without-providers"));

  const providersByEnvironmentAtom = Atom.make((get) => {
    const next = new Map<EnvironmentId, ReadonlyArray<ServerProvider>>();
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      const providers = get(input.serverConfigValueAtom(environmentId))?.providers;
      if (providers !== undefined) {
        next.set(environmentId, providers);
      }
    }
    const previous = Option.getOrNull(
      get.self<ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>>(),
    );
    return previous !== null && mapsEqual(previous, next) ? previous : next;
  }).pipe(Atom.withLabel("environment-providers"));

  // Usage limits ride on provider statuses, so these surfaces rebuild on every push by design.
  const presentationsWithProvidersAtom = Atom.make((get) => {
    const previous = Option.getOrNull(
      get.self<ReadonlyMap<EnvironmentId, EnvironmentPresentationWithProviders>>(),
    );
    const next = new Map<EnvironmentId, EnvironmentPresentationWithProviders>();
    for (const [environmentId, presentation] of get(presentationsAtom)) {
      const serverConfig = get(input.serverConfigValueAtom(environmentId));
      const prior = previous?.get(environmentId);
      next.set(
        environmentId,
        prior !== undefined &&
          prior.entry === presentation.entry &&
          prior.connection === presentation.connection &&
          prior.serverConfig === serverConfig
          ? prior
          : { ...presentation, serverConfig },
      );
    }
    return previous !== null && mapsEqual(previous, next) ? previous : next;
  }).pipe(Atom.withLabel("environment-presentations-with-providers"));

  return {
    presentationAtom,
    presentationsAtom,
    serverConfigsAtom,
    providersByEnvironmentAtom,
    presentationsWithProvidersAtom,
  };
}
