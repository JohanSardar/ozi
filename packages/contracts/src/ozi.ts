import * as Schema from "effect/Schema";
import { ProviderOptionSelections } from "./model.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  CommandId,
  EventId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  RunId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const OZI_MAIN_THREAD_ID = ThreadId.make("ozi-main");
export const OziThreadRole = Schema.Literals(["main", "main-fork", "worker", "checker"]);
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
  model: "claude-bridge/claude-opus-5-5",
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
  (selection.options ?? []).every((option) => option.id !== "fastMode" || option.value === false);

export const PI_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

export const OziCheckState = Schema.Literals([
  "checking",
  "continued",
  "checked",
  "needs_user",
  "blocked",
  "superseded",
]);
export type OziCheckState = typeof OziCheckState.Type;

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
  checkState: Schema.optional(OziCheckState),
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
  sessionNew: "ozi.session.new",
  sessionList: "ozi.session.list",
  sessionImport: "ozi.session.import",
  sessionReload: "ozi.session.reload",
  mainPi: "ozi.main.pi",
  todosGet: "ozi.todos.get",
  clockAdvance: "ozi.test.clock.advance",
  jobsGet: "ozi.jobs.get",
  checksList: "ozi.checks.list",
  checksSubscribe: "ozi.checks.subscribe",
  jobsSubscribe: "ozi.jobs.subscribe",
  jobsHandle: "ozi.jobs.handle",
} as const;

export const OziSessionCreateInput = Schema.Struct({
  title: Schema.optional(TrimmedNonEmptyString),
});
export type OziSessionCreateInput = typeof OziSessionCreateInput.Type;

export const OziSessionImportInput = Schema.Struct({
  content: Schema.String,
  title: Schema.optional(TrimmedNonEmptyString),
});
export type OziSessionImportInput = typeof OziSessionImportInput.Type;

export const OziSessionResult = Schema.Struct({ threadId: ThreadId });
export type OziSessionResult = typeof OziSessionResult.Type;

export const OziSession = Schema.Struct({
  id: ThreadId,
  title: Schema.String,
  forkedFrom: Schema.NullOr(ThreadId),
  updatedAt: Schema.DateTimeUtc,
  messageCount: Schema.Int,
});
export type OziSession = typeof OziSession.Type;

export class OziSessionError extends Schema.TaggedError<OziSessionError>()("OziSessionError", {
  message: Schema.String,
}) {}

export const OziMainPiCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literals([
      "get_commands",
      "get_state",
      "get_session_stats",
      "get_available_models",
      "get_available_thinking_levels",
      "get_last_assistant_text",
      "abort_bash",
    ]),
  }),
  Schema.Struct({
    type: Schema.Literal("compact"),
    customInstructions: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("bash"),
    command: Schema.String,
    excludeFromContext: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("export_html"),
    outputPath: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("set_session_name"), name: Schema.String }),
]);
export type OziMainPiCommand = typeof OziMainPiCommand.Type;

export class OziMainPiError extends Schema.TaggedError<OziMainPiError>()("OziMainPiError", {
  message: Schema.String,
}) {}

export const OZI_CHECK_TOOL_NAMES = ["t3_thread_read", "completion_evidence"] as const;

export const OziCheckVerdict = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal("done"), useful: Schema.Boolean }),
  Schema.Struct({
    verdict: Schema.Literal("continue"),
    missing: Schema.String,
    evidence: Schema.Array(Schema.String),
    useful: Schema.Boolean,
  }),
  Schema.Struct({
    verdict: Schema.Literal("needs_user"),
    reason: Schema.String,
    useful: Schema.Boolean,
  }),
]);
export type OziCheckVerdict = typeof OziCheckVerdict.Type;

export const OziCheckRound = Schema.Struct({
  round: Schema.Number,
  checkerThreadId: ThreadId,
  verdict: Schema.NullOr(OziCheckVerdict),
  error: Schema.NullOr(Schema.String),
  misses: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
  tokens: Schema.NullOr(Schema.Number),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
export type OziCheckRound = typeof OziCheckRound.Type;

export const OziCheck = Schema.Struct({
  id: EventId,
  eventId: EventId,
  threadId: ThreadId,
  runId: RunId,
  requestEventId: EventId,
  reportItemId: Schema.NullOr(TurnItemId),
  report: Schema.String,
  state: OziCheckState,
  sourceCaptured: Schema.Boolean,
  unsuccessfulRounds: Schema.Number,
  evidence: Schema.Array(Schema.String),
  rounds: Schema.Array(OziCheckRound),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type OziCheck = typeof OziCheck.Type;

export class OziCheckError extends Schema.TaggedError<OziCheckError>()("OziCheckError", {
  detail: Schema.String,
}) {}
export class OziClockError extends Schema.TaggedError<OziClockError>()("OziClockError", {
  detail: Schema.String,
}) {}

const TodoField = Schema.String.check(Schema.isMinLength(1));
const TodoUrl = Schema.String.check(Schema.isPattern(/^https?:\/\//));

export const OziTodoSettings = Schema.Struct({
  source: TodoField,
  server: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("stdio"),
      command: TodoField,
      args: Schema.optional(Schema.Array(Schema.String)),
      env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
    Schema.Struct({
      type: Schema.Literal("http"),
      url: TodoUrl,
      headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ]),
  tool: TodoField,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
  itemsPath: Schema.String,
  fields: Schema.Struct({
    id: TodoField,
    title: TodoField,
    link: TodoField,
    status: TodoField,
    due: Schema.optional(TodoField),
  }),
});
export type OziTodoSettings = typeof OziTodoSettings.Type;

export const OziTodo = Schema.Struct({
  id: TodoField,
  title: TodoField,
  link: Schema.NullOr(TodoUrl),
  status: Schema.String,
  due: Schema.NullOr(Schema.String),
});
export type OziTodo = typeof OziTodo.Type;

export const OziTodos = Schema.NullOr(
  Schema.Struct({
    source: Schema.String,
    state: Schema.Literals(["available", "stale", "unavailable"]),
    items: Schema.NullOr(Schema.Array(OziTodo)),
    fetchedAt: Schema.NullOr(Schema.String),
    attemptedAt: Schema.String,
  }),
);
export type OziTodos = typeof OziTodos.Type;
