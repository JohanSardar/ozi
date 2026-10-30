import * as Schema from "effect/Schema";
import { MessageId, RunId, RuntimeRequestId, ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderApprovalDecision, ProviderUserInputAnswers } from "./providerPolicy.ts";

export const PiRpcCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literals([
      "get_commands",
      "get_session_stats",
      "get_last_assistant_text",
      "get_available_models",
      "get_available_thinking_levels",
      "get_state",
      "abort_bash",
    ]),
  }),
  Schema.Struct({ type: Schema.Literal("set_session_name"), name: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("set_model"),
    provider: Schema.String,
    modelId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("set_thinking_level"),
    level: Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  }),
  Schema.Struct({
    type: Schema.Literal("export_html"),
    outputPath: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("bash"),
    command: Schema.String,
    excludeFromContext: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("compact"),
    customInstructions: Schema.optional(Schema.String),
  }),
]);
export type PiRpcCommand = typeof PiRpcCommand.Type;

export const ChatSessionInput = Schema.Union([
  Schema.Struct({ action: Schema.Literal("pi-rpc"), threadId: ThreadId, command: PiRpcCommand }),
  Schema.Struct({
    action: Schema.Literal("pi-cli"),
    threadId: ThreadId,
    args: Schema.Array(Schema.String),
  }),

  Schema.Struct({ action: Schema.Literal("list") }),
  Schema.Struct({
    action: Schema.Literal("new"),
    threadId: Schema.optional(ThreadId),
    title: Schema.optional(Schema.String),
    modelSelection: Schema.optional(ModelSelection),
  }),
  Schema.Struct({
    action: Schema.Literals(["resume", "reload", "clone", "inspect"]),
    threadId: ThreadId,
  }),
  Schema.Struct({ action: Schema.Literal("fork"), threadId: ThreadId, messageId: MessageId }),
  Schema.Struct({
    action: Schema.Literal("import"),
    threadId: Schema.optional(ThreadId),
    content: Schema.String.check(Schema.isMaxLength(32 * 1024 * 1024)),
    modelSelection: Schema.optional(ModelSelection),
  }),
  Schema.Struct({
    action: Schema.Literal("export"),
    threadId: ThreadId,
    format: Schema.Literals(["jsonl", "html"]),
  }),
]);
export type ChatSessionInput = typeof ChatSessionInput.Type;

export const ChatSessionResult = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  modelSelection: Schema.optional(ModelSelection),
  workingDirectory: Schema.optional(Schema.NullOr(Schema.String)),
  data: Schema.optional(Schema.Unknown),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  editorText: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  sessions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        title: Schema.String,
        parentThreadId: Schema.NullOr(ThreadId),
        updatedAt: Schema.String,
        archived: Schema.Boolean,
      }),
    ),
  ),
  messages: Schema.optional(Schema.Array(Schema.Struct({ id: MessageId, text: Schema.String }))),
});
export type ChatSessionResult = typeof ChatSessionResult.Type;

export const ChatSessionAnswerInput = Schema.Struct({
  threadId: ThreadId,
  requestId: RuntimeRequestId,
  decision: Schema.optional(ProviderApprovalDecision),
  answers: Schema.optional(ProviderUserInputAnswers),
});
export type ChatSessionAnswerInput = typeof ChatSessionAnswerInput.Type;

export class ChatSessionError extends Schema.TaggedError<ChatSessionError>()("ChatSessionError", {
  reason: Schema.Literals([
    "invalid_session",
    "busy",
    "pi_required",
    "missing_history",
    "operation_failed",
    "model_required",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "invalid_session":
        return "Invalid Pi session file.";
      case "busy":
        return "Wait for this chat to finish before changing its session.";
      case "pi_required":
        return "Pi session import and export require a Pi chat.";
      case "missing_history":
        return "This chat has no persisted Pi session yet.";
      case "operation_failed":
        return "The session operation failed.";
      case "model_required":
        return "Choose a default model or pass --provider and --model.";
    }
  }
}

export const ChatPrintInput = Schema.Struct({
  threadId: ThreadId,
  text: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(Schema.isMaxLength(255)),
      mimeType: Schema.String,
      base64: Schema.String.check(Schema.isMaxLength(32 * 1024 * 1024)),
    }),
  ).check(Schema.isMaxLength(20)),
});
export type ChatPrintInput = typeof ChatPrintInput.Type;

export const ChatPrintEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("event"), json: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("result"),
    threadId: ThreadId,
    runId: RunId,
    status: Schema.String,
    text: Schema.String,
    answer: Schema.optional(Schema.String),
  }),
]);
export type ChatPrintEvent = typeof ChatPrintEvent.Type;
