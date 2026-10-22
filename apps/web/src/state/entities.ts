import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import type { ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";

import { environmentPresentations } from "./presentation";
import { environmentServerConfigsAtom } from "./server";

import { environmentThreadShells } from "./threads";

const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);

/** Providers are left out; read them with `useEnvironmentProviders()`. */
export function useServerConfigs() {
  return useAtomValue(environmentPresentations.serverConfigsAtom);
}

/** The shell without its streaming timestamps; see quietThreadShellAtom. */
export function useQuietThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.quietThreadShellAtom(ref),
  );
}

export function useEnvironmentSupportsServerBrowser(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.serverBrowser === true
  );
}

export function readEnvironmentSupportsServerBrowser(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .serverBrowser === true
  );
}
