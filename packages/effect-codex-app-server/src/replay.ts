import * as Effect from "effect/Effect";

import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export const CodexAppServerReplayEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("expect_outbound"),
    label: Schema.optional(Schema.String),
    frame: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("emit_inbound"),
    label: Schema.optional(Schema.String),
    frame: Schema.Unknown,
    afterMs: Schema.optional(Schema.Number),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime_exit"),
    status: Schema.Literals(["success", "error", "cancelled"]),
    error: Schema.optional(Schema.Unknown),
  }),
]);
export type CodexAppServerReplayEntry = typeof CodexAppServerReplayEntry.Type;

export const CodexAppServerReplayTranscript = Schema.Struct({
  provider: Schema.Literal("codex"),
  protocol: Schema.Literal("codex.app-server"),
  version: Schema.String,
  scenario: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  entries: Schema.Array(CodexAppServerReplayEntry),
});
export type CodexAppServerReplayTranscript = typeof CodexAppServerReplayTranscript.Type;

export class CodexAppServerReplayJsonParseError extends Schema.TaggedError<CodexAppServerReplayJsonParseError>()(
  "CodexAppServerReplayJsonParseError",
  {
    scenario: Schema.String,
    line: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to parse outbound Codex app-server replay frame for scenario ${this.scenario}.`;
  }
}

export class CodexAppServerReplayExhaustedError extends Schema.TaggedError<CodexAppServerReplayExhaustedError>()(
  "CodexAppServerReplayExhaustedError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    actual: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Codex app-server replay transcript exhausted before outbound frame ${this.cursor} in scenario ${this.scenario}.`;
  }
}

export class CodexAppServerReplayUnexpectedOutboundError extends Schema.TaggedError<CodexAppServerReplayUnexpectedOutboundError>()(
  "CodexAppServerReplayUnexpectedOutboundError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    expectedType: Schema.String,
    actual: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Unexpected outbound Codex app-server frame at replay cursor ${this.cursor} in scenario ${this.scenario}.`;
  }
}

export class CodexAppServerReplayFrameMismatchError extends Schema.TaggedError<CodexAppServerReplayFrameMismatchError>()(
  "CodexAppServerReplayFrameMismatchError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    label: Schema.optional(Schema.String),
    expected: Schema.Unknown,
    actual: Schema.Unknown,
  },
) {
  override get message(): string {
    return `Outbound Codex app-server frame did not match replay cursor ${this.cursor} in scenario ${this.scenario}. Expected ${JSON.stringify(this.expected)}, received ${JSON.stringify(this.actual)}.`;
  }
}

export class CodexAppServerReplayRuntimeExitError extends Schema.TaggedError<CodexAppServerReplayRuntimeExitError>()(
  "CodexAppServerReplayRuntimeExitError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    status: Schema.Literals(["error", "cancelled"]),
    error: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Codex app-server replay exited with status ${this.status} at cursor ${this.cursor} in scenario ${this.scenario}.`;
  }
}

export class CodexAppServerReplayIncompleteError extends Schema.TaggedError<CodexAppServerReplayIncompleteError>()(
  "CodexAppServerReplayIncompleteError",
  {
    scenario: Schema.String,
    cursor: Schema.Number,
    remaining: Schema.Number,
  },
) {
  override get message(): string {
    return `Codex app-server replay ended with ${this.remaining} unconsumed entries in scenario ${this.scenario}.`;
  }
}

export const CodexAppServerReplayError = Schema.Union([
  CodexAppServerReplayJsonParseError,
  CodexAppServerReplayExhaustedError,
  CodexAppServerReplayUnexpectedOutboundError,
  CodexAppServerReplayFrameMismatchError,
  CodexAppServerReplayRuntimeExitError,
  CodexAppServerReplayIncompleteError,
]);
export type CodexAppServerReplayError = typeof CodexAppServerReplayError.Type;

export interface CodexAppServerReplayState {
  readonly cursor: number;
  readonly failure: CodexAppServerReplayError | null;
}

export interface CodexAppServerReplayDriver {
  readonly transcript: CodexAppServerReplayTranscript;
  readonly state: Ref.Ref<CodexAppServerReplayState>;
  readonly beforeEmitInbound?: (
    entry: Extract<CodexAppServerReplayEntry, { readonly type: "emit_inbound" }>,
  ) => Effect.Effect<void>;
}
