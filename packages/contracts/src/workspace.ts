import * as Schema from "effect/Schema";
import {
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

const WORKSPACE_SEARCH_ENTRIES_MAX_LIMIT = 200;
const WORKSPACE_SEARCH_CONTENTS_MAX_LIMIT = 500;
const WORKSPACE_WRITE_FILE_PATH_MAX_LENGTH = 512;
const WORKSPACE_READ_FILE_PATH_MAX_LENGTH = 512;

export const WorkspaceEntryKind = Schema.Literals(["file", "directory"]);
export type WorkspaceEntryKind = typeof WorkspaceEntryKind.Type;

export const WorkspaceSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(WORKSPACE_SEARCH_ENTRIES_MAX_LIMIT)),
  kind: Schema.optional(WorkspaceEntryKind),
  imageOnly: Schema.optional(Schema.Boolean),
});
export type WorkspaceSearchEntriesInput = typeof WorkspaceSearchEntriesInput.Type;

export const WorkspaceEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: WorkspaceEntryKind,
  ignored: Schema.optional(Schema.Boolean),
});
export type WorkspaceEntry = typeof WorkspaceEntry.Type;

export const WorkspaceSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(WorkspaceEntry),
  truncated: Schema.Boolean,
});
export type WorkspaceSearchEntriesResult = typeof WorkspaceSearchEntriesResult.Type;

export const WorkspaceSearchContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Preserve whitespace because it is significant in content queries.
  query: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(WORKSPACE_SEARCH_CONTENTS_MAX_LIMIT)),
  caseSensitive: Schema.Boolean,
  wholeWord: Schema.Boolean,
  useRegex: Schema.Boolean,
});
export type WorkspaceSearchContentsInput = typeof WorkspaceSearchContentsInput.Type;

export const WorkspaceContentMatchRange = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
});
export type WorkspaceContentMatchRange = typeof WorkspaceContentMatchRange.Type;

export const WorkspaceContentMatch = Schema.Struct({
  path: TrimmedNonEmptyString,
  lineNumber: PositiveInt,
  lineContent: Schema.String,
  matchRanges: Schema.Array(WorkspaceContentMatchRange),
});
export type WorkspaceContentMatch = typeof WorkspaceContentMatch.Type;

export const WorkspaceSearchContentsResult = Schema.Struct({
  matches: Schema.Array(WorkspaceContentMatch),
  truncated: Schema.Boolean,
  regexFallbackError: Schema.optional(Schema.String),
});
export type WorkspaceSearchContentsResult = typeof WorkspaceSearchContentsResult.Type;

export const WorkspaceListEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  directoryPath: Schema.optional(TrimmedString),
});
export type WorkspaceListEntriesInput = typeof WorkspaceListEntriesInput.Type;

export const WorkspaceListEntriesResult = Schema.Struct({
  entries: Schema.Array(WorkspaceEntry),
  truncated: Schema.Boolean,
});
export type WorkspaceListEntriesResult = typeof WorkspaceListEntriesResult.Type;

export const WorkspaceIgnoredFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  byteLength: NonNegativeInt,
});
export type WorkspaceIgnoredFile = typeof WorkspaceIgnoredFile.Type;

export const WorkspaceEntriesFailure = Schema.Literals([
  "workspace_root_not_found",
  "workspace_root_create_failed",
  "workspace_root_stat_failed",
  "workspace_root_not_directory",
  "search_index_create_failed",
  "search_index_scan_timed_out",
  "search_index_search_failed",
  "directory_list_failed",
]);
export type WorkspaceEntriesFailure = typeof WorkspaceEntriesFailure.Type;

type WorkspaceEntriesFailureContext = {
  readonly failure: WorkspaceEntriesFailure;
  readonly normalizedCwd?: string;
  readonly timeout?: string;
  readonly detail?: string;
  readonly cause?: unknown;
};

function decodedWorkspaceErrorMessage(props: object): string | undefined {
  if (!("message" in props)) return undefined;
  return typeof props.message === "string" ? props.message : undefined;
}

export class WorkspaceSearchEntriesError extends Schema.TaggedError<WorkspaceSearchEntriesError>()(
  "WorkspaceSearchEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(WorkspaceEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: WorkspaceEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedWorkspaceErrorMessage(props) ??
        `Failed to search workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export class WorkspaceSearchContentsError extends Schema.TaggedError<WorkspaceSearchContentsError>()(
  "WorkspaceSearchContentsError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    queryLength: Schema.optional(NonNegativeInt),
    limit: Schema.optional(PositiveInt),
    failure: Schema.optional(WorkspaceEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(
    props: WorkspaceEntriesFailureContext & {
      readonly cwd: string;
      readonly queryLength: number;
      readonly limit: number;
    },
  ) {
    super({
      ...props,
      message:
        decodedWorkspaceErrorMessage(props) ??
        `Failed to search workspace contents in '${props.cwd}'.`,
    } as any);
  }
}

export class WorkspaceListEntriesError extends Schema.TaggedError<WorkspaceListEntriesError>()(
  "WorkspaceListEntriesError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(WorkspaceEntriesFailure),
    normalizedCwd: Schema.optional(TrimmedNonEmptyString),
    timeout: Schema.optional(TrimmedNonEmptyString),
    detail: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: WorkspaceEntriesFailureContext & { readonly cwd: string }) {
    super({
      ...props,
      message:
        decodedWorkspaceErrorMessage(props) ??
        `Failed to list workspace entries in '${props.cwd}'.`,
    } as any);
  }
}

export const WorkspaceReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  // Workspace-relative or absolute host path; only workspace-relative paths are writable.
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(WORKSPACE_READ_FILE_PATH_MAX_LENGTH),
  ),
  // Optional files can be absent without failing the read.
  allowMissing: Schema.optional(Schema.Boolean),
});
export type WorkspaceReadFileInput = typeof WorkspaceReadFileInput.Type;

export const WorkspaceReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
  byteLength: NonNegativeInt,
  truncated: Schema.Boolean,
  // Omitted by older servers; false only for an absent optional file.
  exists: Schema.optional(Schema.Boolean),
});
export type WorkspaceReadFileResult = typeof WorkspaceReadFileResult.Type;

export const WorkspaceFileFailure = Schema.Literals([
  "workspace_path_outside_root",
  "resolved_path_outside_root",
  "path_not_file",
  "binary_file",
  "operation_failed",
]);
export type WorkspaceFileFailure = typeof WorkspaceFileFailure.Type;

export const WorkspaceFileOperation = Schema.Literals([
  "realpath-workspace-root",
  "realpath-target",
  "open",
  "stat",
  "read",
  "close",
  "make-directory",
  "write-file",
]);
export type WorkspaceFileOperation = typeof WorkspaceFileOperation.Type;

type WorkspaceFileFailureContext = {
  readonly cwd: string;
  readonly relativePath: string;
  readonly failure: WorkspaceFileFailure;
  readonly resolvedPath?: string;
  readonly resolvedWorkspaceRoot?: string;
  readonly operation?: WorkspaceFileOperation;
  readonly operationPath?: string;
  readonly cause?: unknown;
};

export class WorkspaceReadFileError extends Schema.TaggedError<WorkspaceReadFileError>()(
  "WorkspaceReadFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(WorkspaceFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(WorkspaceFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: WorkspaceFileFailureContext) {
    super({
      ...props,
      message:
        decodedWorkspaceErrorMessage(props) ??
        `Failed to read workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}

export const WorkspaceWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(WORKSPACE_WRITE_FILE_PATH_MAX_LENGTH),
  ),
  contents: Schema.String,
});
export type WorkspaceWriteFileInput = typeof WorkspaceWriteFileInput.Type;

export const WorkspaceWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type WorkspaceWriteFileResult = typeof WorkspaceWriteFileResult.Type;

export class WorkspaceWriteFileError extends Schema.TaggedError<WorkspaceWriteFileError>()(
  "WorkspaceWriteFileError",
  {
    cwd: Schema.optional(TrimmedNonEmptyString),
    relativePath: Schema.optional(TrimmedNonEmptyString),
    failure: Schema.optional(WorkspaceFileFailure),
    resolvedPath: Schema.optional(TrimmedNonEmptyString),
    resolvedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
    operation: Schema.optional(WorkspaceFileOperation),
    operationPath: Schema.optional(TrimmedNonEmptyString),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: WorkspaceFileFailureContext) {
    super({
      ...props,
      message:
        decodedWorkspaceErrorMessage(props) ??
        `Failed to write workspace file '${props.relativePath}' in '${props.cwd}'.`,
    } as any);
  }
}
