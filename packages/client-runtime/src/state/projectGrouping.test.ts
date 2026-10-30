import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProject } from "./models.ts";
import { chooseLoadBalancedEnvironment } from "../load-balancing.ts";
import {
  buildProjectGroups,
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  resolveScratchProjectScopeKey,
  sortProjectsByGroupOrder,
  type ProjectGroupingSettings,
} from "./projectGrouping.ts";

const environmentId = EnvironmentId.make("environment");

describe("load balancing shared project machines", () => {
  const now = 100_000;
  const resources = {
    sampledAt: now,
    cpuUtilization: 0.2,
    cpuCount: 8,
    availableMemoryBytes: 8_000,
    totalMemoryBytes: 16_000,
  };

  it("compares three machines using free capacity and preference", () => {
    const candidates = [
      { environmentId: "busy", resources: { ...resources, cpuUtilization: 0.9 }, weight: 1 },
      { environmentId: "idle", resources, weight: 1 },
      { environmentId: "preferred", resources: { ...resources, cpuCount: 4 }, weight: 3 },
    ];
    expect(chooseLoadBalancedEnvironment(candidates, now)).toBe("preferred");
    expect(chooseLoadBalancedEnvironment(candidates.slice(0, 2), now)).toBe("idle");
  });

  it("rejects stale, unknown, excluded and saturated machines", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          {
            environmentId: "stale",
            resources: { ...resources, sampledAt: now - 15_001 },
            weight: 1,
          },
          { environmentId: "unknown", resources: null, weight: 1 },
          {
            environmentId: "no-cpu-sample",
            resources: { ...resources, cpuUtilization: null },
            weight: 1,
          },
          { environmentId: "excluded", resources, weight: 0 },
          {
            environmentId: "cpu-full",
            resources: { ...resources, cpuUtilization: 0.95 },
            weight: 1,
          },
          {
            environmentId: "memory-full",
            resources: { ...resources, availableMemoryBytes: 100 },
            weight: 1,
          },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("uses client receipt time when host clocks differ", () => {
    const candidate = {
      environmentId: "different-clock",
      resources: { ...resources, sampledAt: now + 60_000 },
      receivedAt: now,
      weight: 1,
    };
    expect(chooseLoadBalancedEnvironment([candidate], now)).toBe("different-clock");
    expect(chooseLoadBalancedEnvironment([candidate], now + 15_001)).toBeNull();
  });
});

function makeProject(
  id: string,
  workspaceRoot: string,
  overrides: Partial<EnvironmentProject> = {},
): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function settings(
  mode: ProjectGroupingSettings["sidebarProjectGroupingMode"],
  overrides: ProjectGroupingSettings["sidebarProjectGroupingOverrides"] = {},
): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: mode,
    sidebarProjectGroupingOverrides: overrides,
  };
}

describe("buildProjectGroups", () => {
  it("retains a repository filter that still belongs to an ordinary project", () => {
    const scratch = makeProject("scratch", "/scratch", { isScratch: true });
    const ordinary = makeProject("ordinary", "/ordinary");
    const key = deriveLogicalProjectKeyFromSettings(ordinary, settings("repository"));
    expect(resolveScratchProjectScopeKey(key, [scratch, ordinary])).toBe(key);
  });

  it("preserves every physical clone as a selectable member in repository modes", () => {
    const projects = [
      makeProject("ozi", "/work/t3code"),
      makeProject("ozi-2", "/work/t3code-2"),
      makeProject("ozi-3", "/work/t3code-3"),
    ];

    for (const mode of ["repository", "repository_path"] as const) {
      const groups = buildProjectGroups({ projects, settings: settings(mode) });
      expect(groups).toHaveLength(1);
      expect(groups[0]?.members.map((member) => member.project.id)).toEqual([
        "ozi",
        "ozi-2",
        "ozi-3",
      ]);
      expect(groups[0]?.memberProjectRefs).toHaveLength(3);
    }
  });

  it("applies a physical-project override without dropping its siblings", () => {
    const first = makeProject("ozi", "/work/t3code");
    const second = makeProject("ozi-2", "/work/t3code-2");
    const third = makeProject("ozi-3", "/work/t3code-3");
    const groups = buildProjectGroups({
      projects: [first, second, third],
      settings: settings("repository", {
        [derivePhysicalProjectKey(second)]: "separate",
      }),
    });

    expect(groups).toHaveLength(2);
    expect(groups.flatMap((group) => group.members.map((member) => member.project.id))).toEqual([
      "ozi",
      "ozi-3",
      "ozi-2",
    ]);
  });
});

describe("sortProjectsByGroupOrder", () => {
  const remote = EnvironmentId.make("remote");
  const ref = (projectId: string, env = environmentId) => ({
    environmentId: env,
    projectId: ProjectId.make(projectId),
  });
  const project = (id: string, env: string = environmentId) => ({ id, environmentId: env });

  it("tells the same project id on two environments apart", () => {
    const sorted = sortProjectsByGroupOrder(
      [project("shared"), project("shared", remote)],
      [{ memberProjectRefs: [ref("shared", remote)] }, { memberProjectRefs: [ref("shared")] }],
    );
    expect(sorted.map((entry) => entry.environmentId)).toEqual([remote, environmentId]);
  });
});
