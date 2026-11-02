import {
  DEFAULT_SERVER_SETTINGS,
  resolveEnvironmentMachineKind,
  type ServerSettings,
} from "@t3tools/contracts";
import { CheckIcon, LayersIcon } from "lucide-react";
import * as Equal from "effect/Equal";

import { cn } from "../../lib/utils";
import type { EnvironmentPresentation } from "../../state/environments";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ScopedSettingsTarget } from "./scopedSettings";
import { isProjectScopedSettingKey } from "./scopedSettings";

interface InheritanceLayer {
  readonly key: "project" | "environment" | "built-in";
  readonly label: string;
  readonly value: string;
  readonly effective: boolean;
  readonly set: boolean;
}

function formatValue(key: keyof ServerSettings, value: unknown): string {
  if (value === null || value === undefined) {
    return key === "sidebarAutoSettleAfterDays"
      ? "Never"
      : key === "defaultModelSelection"
        ? "Automatic"
        : "Not set";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    return key === "sidebarAutoSettleAfterDays"
      ? `${value} ${value === 1 ? "day" : "days"}`
      : String(value);
  }
  if (typeof value === "string") return value === "" ? "Empty" : value;
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object" && "model" in value && typeof value.model === "string") {
    return value.model;
  }
  return "Custom";
}

function settingInheritanceLayers(
  target: ScopedSettingsTarget,
  environmentSettings: ServerSettings,
  key: keyof ServerSettings,
): readonly InheritanceLayer[] {
  const environmentValue = environmentSettings[key];
  const source = isProjectScopedSettingKey(key) ? target.sources[key] : "environment";
  const environmentSet = !Equal.equals(environmentValue, DEFAULT_SERVER_SETTINGS[key]);
  const layers: InheritanceLayer[] = [];
  if (target.projectId !== null && isProjectScopedSettingKey(key)) {
    layers.push({
      key: "project",
      label: "Project",
      value: source === "project" ? formatValue(key, target.settings[key]) : "Inherits",
      effective: source === "project",
      set: source === "project",
    });
  }
  layers.push({
    key: "environment",
    label: target.label,
    value: environmentSet ? formatValue(key, environmentValue) : "Inherits",
    effective: source === "environment" && environmentSet,
    set: environmentSet,
  });
  layers.push({
    key: "built-in",
    label: "Default",
    value: formatValue(key, DEFAULT_SERVER_SETTINGS[key]),
    effective: source === "environment" && !environmentSet,
    set: true,
  });
  return layers;
}

export type SettingInheritanceState =
  | "default"
  | "environment"
  | "inherited"
  | "overridden"
  | "mixed";

export function SettingInheritance({
  state,
  summary,
  targets,
  environments,
  keys,
}: {
  state: SettingInheritanceState;
  summary: string;
  targets: readonly ScopedSettingsTarget[];
  environments: readonly Pick<EnvironmentPresentation, "environmentId" | "serverConfig">[];
  keys: readonly (keyof ServerSettings)[];
}) {
  const key = keys[0];
  if (!key || targets.length === 0) return null;
  const chains = targets.flatMap((target) => {
    const environment = environments.find(
      (candidate) => candidate.environmentId === target.environmentId,
    );
    if (!environment?.serverConfig) return [];
    return [
      {
        target,
        machine: resolveEnvironmentMachineKind(environment.serverConfig),
        layers: settingInheritanceLayers(target, environment.serverConfig.settings, key),
      },
    ];
  });
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={`${summary}. Show where this value comes from`}
                />
              }
            />
          }
        >
          <LayersIcon
            className={cn(
              "size-3",
              state === "overridden" && "text-primary",
              state === "mixed" && "text-warning",
            )}
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{summary}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" width="md" padding="none">
        <div className="divide-y divide-border/60">
          {chains.map(({ target, machine, layers }) => (
            <section
              key={`${target.environmentId}:${target.projectId ?? ""}`}
              className="px-3 py-2.5"
            >
              <h4 className="flex items-center gap-1.5 pb-1.5 text-xs font-medium text-muted-foreground">
                <EnvironmentMachineIcon aria-hidden kind={machine} className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{target.label}</span>
              </h4>
              <ol role="list" className="text-sm">
                {layers.map((layer) => (
                  <li
                    key={layer.key}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1",
                      layer.effective && "bg-foreground/[0.06]",
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        layer.effective ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {layer.key === "environment" ? "Environment" : layer.label}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 tabular-nums",
                        layer.effective
                          ? "text-foreground"
                          : layer.set
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60",
                      )}
                    >
                      <span className="max-w-32 truncate">{layer.value}</span>
                      {layer.effective ? (
                        <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <span aria-hidden className="size-3.5 shrink-0" />
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
