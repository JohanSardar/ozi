import {
  EnvironmentId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import type { QueuedThreadMessage } from "../../state/thread-outbox-model";

export const SHOWCASE_PENDING_TASK_DEFINITIONS = [
  {
    id: "offline-launch-checklist",
    text: "Ship the offline launch checklist before touchdown ✈️",
    minutesAgo: 8,
  },
  {
    id: "train-tunnel-suspense",
    text: "Polish the Suspense handoff for the train tunnel 🚇",
    minutesAgo: 27,
  },
] as const;

const FALLBACK_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} as const;

export function buildShowcasePendingTasks(
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  now: number,
): ReadonlyArray<QueuedThreadMessage> {
  return SHOWCASE_PENDING_TASK_DEFINITIONS.flatMap((definition) => {
    const environment = environments[0];
    if (!environment) return [];

    return [
      {
        environmentId: environment.environmentId,
        threadId: ThreadId.make(`showcase-pending-${definition.id}`),
        messageId: MessageId.make(`showcase-pending-message-${definition.id}`),
        commandId: CommandId.make(`showcase-pending-command-${definition.id}`),
        text: definition.text,
        attachments: [],
        modelSelection: FALLBACK_MODEL_SELECTION,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        creation: {
          defaultCwd: "",
          workspaceMode: "local" as const,
          workingDirectory: null,
        },
        createdAt: new Date(now - definition.minutesAgo * 60_000).toISOString(),
      },
    ];
  });
}
