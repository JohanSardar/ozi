import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleOptional,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ORCHESTRATION_PROTOCOL_VERSION = 2;
export const ORCHESTRATION_PROTOCOL_VERSION_TEXT = "2";
export const ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const ORCHESTRATION_PROTOCOL_HEADER = "x-t3-orchestration-protocol";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

export const ENVIRONMENT_MACHINE_KINDS = [
  "server",
  "cloud",
  "linux",
  "desktop",
  "laptop",
  "mac-mini",
  "mac-studio",
] as const;
export const EnvironmentMachineKind = Schema.Literals(ENVIRONMENT_MACHINE_KINDS);
export type EnvironmentMachineKind = typeof EnvironmentMachineKind.Type;
export const isEnvironmentMachineKind = Schema.is(EnvironmentMachineKind);

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs,
  arch: ExecutionEnvironmentPlatformArch,
  machine: ForwardCompatibleOptional(EnvironmentMachineKind),
});
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  connectionProbe: Schema.optionalKey(Schema.Boolean),
  attachmentUploads: Schema.optionalKey(Schema.Boolean),
  questionAttachments: Schema.optionalKey(Schema.Boolean),
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** Absent on servers from before inline context shipped, which drop the records and forward
      the links as literal text -- so a client must serialize context the legacy way for them. */
  inlineMessageContext: Schema.optionalKey(Schema.Boolean),
  /** Server streams database size and reclaimable space for the Storage settings notice. */
  databaseStorage: Schema.optionalKey(Schema.Boolean),
  /** Server checks OTLP endpoints for the telemetry export settings. */
  otlpEndpointCheck: Schema.optionalKey(Schema.Boolean),
  threadRestartContinuation: Schema.optionalKey(Schema.Boolean),
  /** Absent on servers from
      before environment themes shipped, which never emit the events -- so a
      client reconnecting to one must drop published themes rather than keep
      showing a set nothing will ever update. */
  environmentThemes: Schema.optionalKey(Schema.Boolean),
  usagePriceOverrides: Schema.optionalKey(Schema.Boolean),
  usageModelAliases: Schema.optionalKey(Schema.Boolean),
  threadTitleRegeneration: Schema.optionalKey(Schema.Boolean),
  serverResolvedCommandContext: Schema.optionalKey(Schema.Boolean),
  threadStop: Schema.optionalKey(Schema.Boolean),
  environmentIcon: Schema.optionalKey(Schema.Boolean),
  /** Server hosts preview tabs in its own headless Chromium (`runtime:
      "server"`) and streams them over `/api/preview-stream`. Clients
      without a local browser runtime open server tabs here. */
  serverBrowser: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  orchestrationProtocolVersion: Schema.optionalKey(Schema.Int),
  capabilities: ExecutionEnvironmentCapabilities,
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const ScopedProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type ScopedProjectRef = typeof ScopedProjectRef.Type;

export const ScopedThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadRef = typeof ScopedThreadRef.Type;
