import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildSidebarProjectSnapshots,
  getSidebarProjectSettingsKey,
} from "./sidebarProjectGrouping";
import type { Project } from "./types";

const primaryEnvironmentId = EnvironmentId.make("env-primary");
const remoteEnvironmentId = EnvironmentId.make("env-remote");
const defaultGroupingSettings = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-1"),
    environmentId: primaryEnvironmentId,
    title: "shared-repo",
    workspaceRoot: "/tmp/shared-repo",
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

describe("environment grouping", () => {
  it("opens physical scratch settings from the merged filter, including a remote thread target", () => {
    const local = makeProject({
      title: "No project",
      workspaceRoot: "/local/scratch",
      isScratch: true,
    });
    const remote = makeProject({
      title: "No project",
      id: ProjectId.make("remote-scratch"),
      environmentId: remoteEnvironmentId,
      workspaceRoot: "/remote/scratch",
      isScratch: true,
    });
    const input = {
      projects: [local, remote],
      settings: defaultGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: () => null,
    };
    const filters = buildSidebarProjectSnapshots({ ...input, groupScratchProjects: true });
    const settingsGroups = buildSidebarProjectSnapshots(input);
    expect(filters).toHaveLength(1);
    expect(settingsGroups).toHaveLength(2);
    expect(settingsGroups.map((group) => group.memberProjectRefs)).toEqual([
      [{ environmentId: local.environmentId, projectId: local.id }],
      [{ environmentId: remote.environmentId, projectId: remote.id }],
    ]);
    expect(getSidebarProjectSettingsKey(filters[0]!, defaultGroupingSettings, input.projects)).toBe(
      settingsGroups[0]?.projectKey,
    );
    expect(
      getSidebarProjectSettingsKey(filters[0]!, defaultGroupingSettings, input.projects, {
        environmentId: remote.environmentId,
        projectId: remote.id,
      }),
    ).toBe(settingsGroups[1]?.projectKey);
  });
});
