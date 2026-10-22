import { useEnvironments } from "../../state/environments";
import { useOptionalSettingsScope } from "./SettingsScopeContext";

export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/appearance",
  "/settings/connections",
]);

export function SettingsScopeSentence() {
  const scope = useOptionalSettingsScope();
  const { environments } = useEnvironments();
  if (!scope || environments.length < 2) return null;
  return (
    <label className="flex items-center gap-2 px-4 text-sm">
      Connection
      <select
        value={scope.search.machine ?? ""}
        onChange={(event) => scope.selectScope({ machine: event.target.value || undefined })}
      >
        {environments.map((environment) => (
          <option key={environment.environmentId} value={environment.environmentId}>
            {environment.label}
          </option>
        ))}
      </select>
    </label>
  );
}
