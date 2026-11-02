import type { EnvironmentId, OrchestrationV2ProjectLabel } from "@t3tools/contracts";
import type { EnvironmentPresentation } from "../../state/environments";
export interface SettingsScopeSearch {
  project?: string | undefined;
  machine?: string | undefined;
}
export type ResolvedSettingsScope = { label: string; environmentIds: readonly EnvironmentId[] } & (
  | { kind: "all" }
  | { kind: "environment"; environmentId: EnvironmentId }
  | { kind: "project"; environmentId: EnvironmentId; projectId: string }
  | {
      kind: "unavailable";
      reason: "project-required" | "project-missing" | "environment-missing";
      message: string;
    }
);
export function validateSettingsScopeSearch(raw: Record<string, unknown>): SettingsScopeSearch {
  const stringValue = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : undefined;
  const project = stringValue(raw.project);
  const machine = stringValue(raw.machine);
  return {
    ...(project === undefined ? {} : { project }),
    ...(machine === undefined ? {} : { machine }),
  };
}
export function resolveSettingsScope(
  search: SettingsScopeSearch,
  environments: readonly Pick<EnvironmentPresentation, "environmentId" | "label">[],
  projects: readonly OrchestrationV2ProjectLabel[] = [],
): ResolvedSettingsScope {
  const unavailable = (
    reason: Extract<ResolvedSettingsScope, { kind: "unavailable" }>["reason"],
    message: string,
  ): ResolvedSettingsScope => ({
    kind: "unavailable",
    reason,
    label: "Unavailable selection",
    message,
    environmentIds: [],
  });
  const environment = environments.find((candidate) => candidate.environmentId === search.machine);
  if (search.machine && !environment)
    return unavailable("environment-missing", "This environment is no longer available.");
  if (search.project) {
    if (!environment)
      return unavailable(
        "project-required",
        "Select an environment to choose one of its projects.",
      );
    const project = projects.find((candidate) => candidate.id === search.project);
    if (!project) return unavailable("project-missing", "This project is no longer available.");
    return {
      kind: "project",
      environmentId: environment.environmentId,
      projectId: project.id,
      label: `${project.title} / ${environment.label}`,
      environmentIds: [environment.environmentId],
    };
  }
  return environment
    ? {
        kind: "environment",
        environmentId: environment.environmentId,
        label: environment.label,
        environmentIds: [environment.environmentId],
      }
    : {
        kind: "all",
        label: "All environments",
        environmentIds: environments.map((environment) => environment.environmentId),
      };
}
