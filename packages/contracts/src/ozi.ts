import * as Schema from "effect/Schema";
import { ProviderOptionSelections } from "./model.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ThreadId } from "./baseSchemas.ts";

export const OZI_MAIN_THREAD_ID = ThreadId.make("ozi-main");
export const OziThreadRole = Schema.Literals(["main", "main-fork", "worker"]);
export type OziThreadRole = typeof OziThreadRole.Type;

export const OziEffectiveLoadout = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  options: ProviderOptionSelections,
  toolNames: Schema.Array(Schema.String),
  systemPromptSha256: Schema.String,
});
export type OziEffectiveLoadout = typeof OziEffectiveLoadout.Type;

export const OZI_MAIN_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("pi"),
  model: "anthropic/claude-opus-5-5",
  options: [
    { id: "thinking", value: "high" },
    { id: "fastMode", value: false },
  ],
};

export const OZI_WORKER_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.1-sol",
  options: [
    { id: "reasoningEffort", value: "xhigh" },
    { id: "serviceTier", value: "priority" },
  ],
};

export const isOziMain = (thread: {
  readonly id: ThreadId;
  readonly role?: OziThreadRole | undefined;
}) => thread.id === OZI_MAIN_THREAD_ID || thread.role === "main" || thread.role === "main-fork";

export const isOziMainSelection = (selection: ModelSelection) =>
  selection.instanceId === OZI_MAIN_SELECTION.instanceId &&
  selection.model === OZI_MAIN_SELECTION.model &&
  selection.options?.length === OZI_MAIN_SELECTION.options?.length &&
  OZI_MAIN_SELECTION.options?.every((option) =>
    selection.options?.some(
      (candidate) => candidate.id === option.id && candidate.value === option.value,
    ),
  ) === true;

export const OZI_MAIN_TOOL_NAMES = [
  "orchestrator_capabilities",
  "delegate_task",
  "task_status",
  "task_cancel",
  "t3_thread_read",
  "t3_thread_send",
  "t3_thread_interrupt",
  "t3_workflow_stop",
  "t3_queue_list",
  "t3_queue_read",
  "t3_queue_edit",
  "t3_queue_cancel",
  "t3_queue_reorder",
  "t3_queue_promote_to_steer",
  "t3_pending_request_list",
  "t3_pending_request_read",
  "t3_pending_request_respond",
  "schedule_task",
  "list_scheduled_tasks",
  "update_scheduled_task",
  "delete_scheduled_task",
  "run_scheduled_task_now",
  "request_secret",
  "read_skill",
] as const;
