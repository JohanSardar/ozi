import { EnvironmentId, ProviderInstanceId, ScheduledTaskId } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { resolveSettingsScope } from "./settingsScope";
import { retainSettingsScope, validateSettingsRouteSearch } from "./settingsScopeNavigation";

import { validateScheduledTasksSearch } from "./scheduledTasksSettings.logic";

const checkoutSearch = {
  machine: "remote-server",
};

function createSettingsRouter(initialEntry = "/settings/general") {
  const root = createRootRoute();
  const settings = createRoute({
    getParentRoute: () => root,
    path: "settings",
    validateSearch: validateSettingsRouteSearch,
    search: { middlewares: [retainSettingsScope] },
    beforeLoad: ({ location }) => {
      if (location.pathname === "/settings") {
        throw redirect({ to: "/settings/general", replace: true });
      }
    },
  });
  const general = createRoute({ getParentRoute: () => settings, path: "general" });
  const integrations = createRoute({ getParentRoute: () => settings, path: "integrations" });
  const providers = createRoute({
    getParentRoute: () => settings,
    path: "providers",
    validateSearch: (raw: Record<string, unknown>) => ({
      ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
        ? { environmentId: EnvironmentId.make(raw.environmentId) }
        : {}),
      ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
        ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
        : {}),
    }),
  });
  const scheduledTasks = createRoute({
    getParentRoute: () => settings,
    path: "scheduled-tasks",
    validateSearch: validateScheduledTasksSearch,
  });
  return createRouter({
    routeTree: root.addChildren([
      settings.addChildren([general, integrations, providers, scheduledTasks]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("settings scope navigation", () => {
  it("honors an explicit provider environment and drops its instance on category navigation", async () => {
    const router = createSettingsRouter();
    await router.navigate({ to: "/settings/general", search: checkoutSearch });
    await router.navigate({
      to: "/settings/providers",
      search: {
        environmentId: EnvironmentId.make("provider-server"),
        instanceId: ProviderInstanceId.make("codex-work"),
      },
    });
    expect(router.state.location.search).toEqual({
      machine: "provider-server",
      environmentId: "provider-server",
      instanceId: "codex-work",
    });
    await router.navigate({ to: "/settings/general", hash: "" });
    expect(router.state.location.search).toEqual({ machine: "provider-server" });
  });

  it("preserves the environment from an initially loaded legacy provider URL", async () => {
    const router = createSettingsRouter(
      "/settings/providers?environmentId=provider-server&instanceId=codex-work",
    );
    await router.load();
    await router.navigate({ to: "/settings/general" });
    expect(router.state.location.search).toEqual({ machine: "provider-server" });
  });

  it("retains an explicit unavailable target rather than reviving the previous environment", async () => {
    const router = createSettingsRouter();
    await router.navigate({ to: "/settings/general", search: { machine: "online" } });
    await router.navigate({ to: "/settings/general", search: { machine: "removed" } });
    expect(router.state.location.search).toEqual({ machine: "removed" });
    expect(
      resolveSettingsScope(router.state.location.search, [
        { environmentId: EnvironmentId.make("online"), label: "Online" },
      ]),
    ).toMatchObject({
      kind: "unavailable",
      reason: "environment-missing",
      environmentIds: [],
    });
  });

  it("keeps scope through the settings index redirect", async () => {
    const router = createSettingsRouter();
    await router.navigate({ to: "/settings", search: { machine: "remote-server" } });
    expect(router.state.redirect).not.toBeUndefined();
    await router.navigate(router.state.redirect!.options);
    expect(router.state.location.pathname).toBe("/settings/general");
    expect(router.state.location.search).toEqual({ machine: "remote-server" });
  });
});

describe("scheduled task scope navigation", () => {
  it("opens a task link on its owning environment, then clears the task when changing filters", async () => {
    const router = createSettingsRouter();
    await router.navigate({
      to: "/settings/scheduled-tasks",
      search: {
        environmentId: EnvironmentId.make("remote-server"),
        taskId: ScheduledTaskId.make("task-1"),
      },
    });
    expect(router.state.matches.at(-1)?.search).toEqual({
      machine: "remote-server",
      environmentId: "remote-server",
      taskId: "task-1",
    });
    await router.navigate({
      from: "/settings",
      to: router.state.location.pathname,
      search: () => ({ machine: undefined }),
    });
    expect(router.state.matches.at(-1)?.search).toEqual({});
  });
});
