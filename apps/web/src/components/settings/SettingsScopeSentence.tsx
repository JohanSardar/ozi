import { useLocation } from "@tanstack/react-router";
import { useEnvironments } from "../../state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useOptionalSettingsScope } from "./SettingsScopeContext";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
export const SETTINGS_DEVICE_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/settings/general",
  "/settings/appearance",
  "/settings/connections",
  "/settings/access",
  "/settings/about",
]);
export function SettingsScopeSentence() {
  const scope = useOptionalSettingsScope();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  if (!scope || SETTINGS_DEVICE_ONLY_PATHS.has(pathname)) return null;
  return (
    <div className="flex items-center gap-2 px-3 text-sm text-muted-foreground">
      <span>Applying settings to</span>
      <Select
        value={scope.search.machine ?? "all"}
        onValueChange={(value) => {
          if (value !== null) scope.selectScope(value === "all" ? {} : { machine: value });
        }}
      >
        <SelectTrigger aria-label="Settings environment">
          <SelectValue>{scope.scope.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {scope.singleEnvironment ? null : <SelectItem value="all">All environments</SelectItem>}
          {environments.map((environment) => (
            <SelectItem key={environment.environmentId} value={environment.environmentId}>
              {settingsScopeEnvironmentLabel(environment, environments)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
