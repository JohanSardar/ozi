import type { EnvironmentId } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEnvironments } from "../../state/environments";
import { Button } from "../ui/button";
import { SettingsPageContainer } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import type { SettingsScopeSearch } from "./settingsScope";
export function SettingsScopeNotice({
  children,
  target,
  targetId,
  eligibleEnvironmentIds,
  inline = false,
}: {
  children: string;
  target: "environment" | "all";
  targetId?: string;
  eligibleEnvironmentIds?: readonly EnvironmentId[];
  inline?: boolean;
}) {
  const { selectScope } = useSettingsScope();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  const choices =
    target === "all"
      ? [{ label: "All environments", search: {} as SettingsScopeSearch }]
      : environments
          .filter(
            (environment) =>
              !eligibleEnvironmentIds || eligibleEnvironmentIds.includes(environment.environmentId),
          )
          .map((environment) => ({
            label: environment.label,
            search: { machine: environment.environmentId },
          }));
  const notice = (
    <div className="space-y-3">
      <p role="status">{children}</p>
      {choices.map((choice) => (
        <Button
          key={choice.label}
          variant="outline"
          onClick={() => {
            if (targetId)
              void navigate({ to: pathname, search: () => choice.search, hash: targetId });
            else selectScope(choice.search);
          }}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
  return inline ? notice : <SettingsPageContainer>{notice}</SettingsPageContainer>;
}
