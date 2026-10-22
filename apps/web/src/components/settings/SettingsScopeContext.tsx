import { createContext, type ReactNode, useContext } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import type { SettingsScopeSearch } from "./settingsScope";

function useResolvedSettingsScope(search: SettingsScopeSearch) {
  const { environments: available } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const selected =
    available.find((environment) => environment.environmentId === (search.machine ?? primary)) ??
    (search.machine ? null : (available[0] ?? null));
  const environments = selected ? [selected] : [];
  const connectedEnvironments = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const scope = selected
    ? { kind: "environment" as const, label: selected.label }
    : { kind: "unavailable" as const, label: "Connection unavailable" };
  return {
    scope,
    search: { machine: selected?.environmentId ?? search.machine },
    environments,
    connectedEnvironments,
    environment: connectedEnvironments[0] ?? null,
  };
}

const SettingsScopeContext = createContext<
  | (ReturnType<typeof useResolvedSettingsScope> & {
      selectScope: (next: SettingsScopeSearch) => void;
    })
  | null
>(null);

export function SettingsScopeProvider({
  search,
  onChange,
  children,
}: {
  search: SettingsScopeSearch;
  onChange: (next: SettingsScopeSearch) => void;
  children: ReactNode;
}) {
  const resolved = useResolvedSettingsScope(search);
  return (
    <SettingsScopeContext value={{ ...resolved, selectScope: onChange }}>
      {children}
    </SettingsScopeContext>
  );
}

export function useOptionalSettingsScope() {
  return useContext(SettingsScopeContext);
}

export function useSettingsScope() {
  const scope = useOptionalSettingsScope();
  if (scope === null) throw new Error("Settings must be read inside SettingsScopeProvider.");
  return scope;
}
