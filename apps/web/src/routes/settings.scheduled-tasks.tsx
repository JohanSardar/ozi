import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, ScheduledTaskId } from "@t3tools/contracts";

import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";

function SettingsScheduledTasksRoute() {
  const target = Route.useSearch();
  return <ScheduledTasksSettings {...target} />;
}

export const Route = createFileRoute("/settings/scheduled-tasks")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string"
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.taskId === "string" ? { taskId: ScheduledTaskId.make(raw.taskId) } : {}),
  }),
  component: SettingsScheduledTasksRoute,
});
