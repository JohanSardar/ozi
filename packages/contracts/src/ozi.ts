import * as Schema from "effect/Schema";
import { ProviderOptionSelections } from "./model.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { CommandId, EventId, RuntimeRequestId, ThreadId, TurnItemId } from "./baseSchemas.ts";

export const OZI_MAIN_THREAD_ID = ThreadId.make("ozi-main");
export const OziThreadRole = Schema.Literals(["main", "main-fork", "worker"]);
export type OziThreadRole = typeof OziThreadRole.Type;
export const OziThreadVisibility = Schema.Literals(["user", "quiet", "internal"]);

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
  "handle_job",
] as const;

export const OziJobColumn = Schema.Literals(["needs_you", "running", "ready", "done"]);
export type OziJobColumn = typeof OziJobColumn.Type;

export const OziJobRequest = Schema.Struct({
  id: RuntimeRequestId,
  threadId: ThreadId,
  kind: Schema.Literals(["question", "approval", "secret", "login", "blocked"]),
  prompt: Schema.String,
  options: Schema.Array(Schema.String),
});
export type OziJobRequest = typeof OziJobRequest.Type;

export const OziJobReport = Schema.Struct({
  eventId: EventId,
  text: Schema.String,
  useful: Schema.Boolean,
});
export type OziJobReport = typeof OziJobReport.Type;

export const OziJobCard = Schema.Struct({
  jobId: ThreadId,
  eventId: EventId,
  title: Schema.String,
  column: OziJobColumn,
  agent: Schema.Struct({ provider: Schema.String, model: Schema.String }),
  status: Schema.String,
  checking: Schema.Boolean,
  requestEventId: Schema.NullOr(EventId),
  report: Schema.NullOr(OziJobReport),
  requests: Schema.Array(OziJobRequest),
  handledEventId: Schema.NullOr(EventId),
  updatedAt: Schema.DateTimeUtc,
});
export type OziJobCard = typeof OziJobCard.Type;

export const OziJobEvidence = Schema.Union([
  Schema.Struct({ type: Schema.Literal("close") }),
  Schema.Struct({ type: Schema.Literal("accepted"), userMessageId: TurnItemId }),
  Schema.Struct({ type: Schema.Literal("verified"), checkEventId: EventId }),
]);
export type OziJobEvidence = typeof OziJobEvidence.Type;

export const OziJobHandleInput = Schema.Struct({
  commandId: CommandId,
  jobId: ThreadId,
  eventId: EventId,
  evidence: OziJobEvidence,
});
export type OziJobHandleInput = typeof OziJobHandleInput.Type;

export class OziJobError extends Schema.TaggedError<OziJobError>()("OziJobError", {
  reason: Schema.Literals(["UnknownJob", "WrongJob", "StaleEvent", "InvalidEvidence"]),
  detail: Schema.String,
}) {
  override get message() {
    return `${this.reason}: ${this.detail}`;
  }
}

export const OZI_WS_METHODS = {
  jobsGet: "ozi.jobs.get",
  jobsSubscribe: "ozi.jobs.subscribe",
  jobsHandle: "ozi.jobs.handle",
} as const;
