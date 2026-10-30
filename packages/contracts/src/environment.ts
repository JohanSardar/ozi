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
export const ORCHESTRATION_PROTOCOL_HEADER = "x-ozi-orchestration-protocol";

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

export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "respawn", "desktop-app"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

export const ServerInstallation = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["npx", "pnpm-dlx", "bunx"]) }),
  Schema.Struct({ kind: Schema.Literal("npm-global"), prefix: TrimmedNonEmptyString }),
]);
export type ServerInstallation = typeof ServerInstallation.Type;

export const ServerSelfUpdateCapability = Schema.Literals([
  "boot-service",
  "respawn",
  "desktop-managed",
]);
export type ServerSelfUpdateCapability = typeof ServerSelfUpdateCapability.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  connectionProbe: Schema.optionalKey(Schema.Boolean),
  attachmentUploads: Schema.optionalKey(Schema.Boolean),
  questionAttachments: Schema.optionalKey(Schema.Boolean),
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** Every protocol-2 server sends this; older mobile builds still read it. */
  inlineMessageContext: Schema.optionalKey(Schema.Boolean),
  threadSettlement: Schema.optionalKey(Schema.Boolean),
  threadAutoSettlement: Schema.optionalKey(Schema.Boolean),
  storageCleanup: Schema.optionalKey(Schema.Boolean),
  storageCleanupRun: Schema.optionalKey(Schema.Boolean),
  databaseStorage: Schema.optionalKey(Schema.Boolean),
  otlpEndpointCheck: Schema.optionalKey(Schema.Boolean),
  threadAutoSettlementScope: Schema.optionalKey(Schema.Boolean),
  threadRestartContinuation: Schema.optionalKey(Schema.Boolean),
  projectSettingsOverrides: Schema.optionalKey(Schema.Boolean),
  /** Hide the switch when absent; older servers silently drop per-project provider patches. */
  projectProviderInstanceOverrides: Schema.optionalKey(Schema.Boolean),
  threadSnooze: Schema.optionalKey(Schema.Boolean),
  /** Every protocol-2 server sends this; older mobile builds still read it. */
  environmentThemes: Schema.optionalKey(Schema.Boolean),
  usageLimitSources: Schema.optionalKey(Schema.Boolean),
  /** Honors `workspaceSnapshotsOnDemand`; older servers send every snapshot and drop them in the stream. */
  providerWorkspaceSnapshotsOnDemand: Schema.optionalKey(Schema.Boolean),
  usagePriceOverrides: Schema.optionalKey(Schema.Boolean),
  usageModelAliases: Schema.optionalKey(Schema.Boolean),
  threadPinning: Schema.optionalKey(Schema.Boolean),
  threadPinReorder: Schema.optionalKey(Schema.Boolean),
  threadActiveReorder: Schema.optionalKey(Schema.Boolean),
  threadAutoSettleOptOut: Schema.optionalKey(Schema.Boolean),
  threadProjectFromScratch: Schema.optionalKey(Schema.Boolean),
  threadTitleRegeneration: Schema.optionalKey(Schema.Boolean),
  threadVisitedTracking: Schema.optionalKey(Schema.Boolean),
  serverResolvedCommandContext: Schema.optionalKey(Schema.Boolean),
  threadStop: Schema.optionalKey(Schema.Boolean),
  /** Absent on older servers and on Windows hosts, which cannot stop a discovered server. */
  localServerStop: Schema.optionalKey(Schema.Boolean),
  serverSelfUpdate: Schema.optionalKey(ServerSelfUpdateCapability),
  /** Manual commands must update this install, not the host's default global prefix. */
  serverInstallation: ForwardCompatibleOptional(ServerInstallation),
  serverSelfUpdateProgress: Schema.optionalKey(Schema.Boolean),
  serverUpdateThreadContinuation: Schema.optionalKey(Schema.Boolean),
  /** Only explicit false skips Live Activity seeding; older servers may still publish. */
  agentActivityPublishing: Schema.optionalKey(Schema.Boolean),
  /** Server answers projects.listIgnoredFiles. */
  ignoredFileListing: Schema.optionalKey(Schema.Boolean),
  environmentIcon: Schema.optionalKey(Schema.Boolean),
  desktopAppUpdate: Schema.optionalKey(Schema.Boolean),
  /** The desktop app switches update tracks when a server update request names one. */
  desktopAppChannelSwitch: Schema.optionalKey(Schema.Boolean),
  /** Subscribe to command output only when advertised; older servers never send it. */
  commandOutputStreaming: Schema.optionalKey(Schema.Boolean),
  /** Hosts headless Chromium tabs streamed over /api/preview-stream for clients without a local runtime. */
  serverBrowser: Schema.optionalKey(Schema.Boolean),
  /** Server links to other environments (`PeerLink`) and its agents can work
      in them. Absent on servers from before linking, which clients must not
      offer linking for. */
  peerLinks: Schema.optionalKey(Schema.Boolean),
  /** Server's `/mcp` narrows an OAuth client's modes from `T3-Mode-Limit`, so
      a linked environment's calls keep its agent's limits. Another environment
      links to this one only when it is set. */
  mcpModeLimitHeader: Schema.optionalKey(Schema.Boolean),
  /** Work a linked environment starts here stays within its link
      (`linkOrigin`). Another environment links to this one only when it is
      set, since without it that work could change the user's own threads. */
  linkFence: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  orchestrationProtocolVersion: Schema.optionalKey(Schema.Int),
  /** Highest migration this server's database holds; absent on older servers. */
  databaseMigration: Schema.optionalKey(Schema.Int),
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
