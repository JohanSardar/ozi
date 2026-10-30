import { ORCHESTRATION_V2_WS_METHODS, WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

import { rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

// Trace queries and dashboards depend on these labels, including deviations from method prefixes.
const RPC_AGGREGATES = {
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreads]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThread]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getThreadFamily]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getOlderSettledThreads]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.launchThread]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: "orchestrationV2",
  [WS_METHODS.projectsMutate]: "orchestration",
  [WS_METHODS.serverProbe]: "server",
  [WS_METHODS.serverGetConfig]: "server",
  [WS_METHODS.serverRefreshProviders]: "server",
  [WS_METHODS.serverUpdateProvider]: "server",
  [WS_METHODS.providerAuthStart]: "provider",
  [WS_METHODS.providerConsumeResetCredit]: "provider",
  [WS_METHODS.providerAuthComplete]: "provider",
  [WS_METHODS.chatGptReconnectProfile]: "provider",
  [WS_METHODS.chatGptImportProfile]: "provider",
  [WS_METHODS.chatGptHandoffSubscribe]: "provider",
  [WS_METHODS.providerAuthRespond]: "provider",
  [WS_METHODS.providerAuthCancel]: "provider",
  [WS_METHODS.providerAuthLogout]: "provider",
  [WS_METHODS.providerAuthSubscribe]: "provider",
  [WS_METHODS.providerInstallStart]: "provider",
  [WS_METHODS.providerInstallCancel]: "provider",
  [WS_METHODS.providerInstallSubscribe]: "provider",
  [WS_METHODS.providerInstallRemove]: "provider",
  [WS_METHODS.serverUpdateServer]: "server",
  [WS_METHODS.serverUpdateServerWithProgress]: "server",
  [WS_METHODS.serverCommitDesktopUpdate]: "server",
  [WS_METHODS.serverUpsertKeybinding]: "server",
  [WS_METHODS.serverRemoveKeybinding]: "server",
  [WS_METHODS.serverRunStorageCleanup]: "server",
  [WS_METHODS.serverGetStorageCleanupReport]: "server",
  [WS_METHODS.serverGetDatabaseStorage]: "server",
  [WS_METHODS.peerLinksList]: "peerLinks",
  [WS_METHODS.peerLinksLink]: "peerLinks",
  [WS_METHODS.peerLinksUnlink]: "peerLinks",
  [WS_METHODS.peerLinksAnswerRequest]: "peerLinks",
  [WS_METHODS.serverUpdateSettings]: "server",
  [WS_METHODS.serverSearchAcpRegistry]: "server",
  [WS_METHODS.serverPrepareAcpRegistryAgent]: "server",
  [WS_METHODS.serverUninstallAcpRegistryManagedBinary]: "server",
  [WS_METHODS.serverAcceptAcpRegistryUrlAuth]: "server",
  [WS_METHODS.serverListAcpRegistrySessions]: "server",
  [WS_METHODS.serverImportAcpRegistrySession]: "server",
  [WS_METHODS.serverDeleteAcpRegistrySession]: "server",
  [WS_METHODS.serverListAcpRegistryProviders]: "server",
  [WS_METHODS.serverSetAcpRegistryProvider]: "server",
  [WS_METHODS.serverDisableAcpRegistryProvider]: "server",
  [WS_METHODS.serverLogoutAcpRegistry]: "server",
  [WS_METHODS.serverGetTraceDiagnostics]: "server",
  [WS_METHODS.serverGetProcessDiagnostics]: "server",
  [WS_METHODS.serverGetHostResources]: "server",
  [WS_METHODS.serverGetProcessResourceHistory]: "server",
  [WS_METHODS.serverGetResourceTelemetryHistory]: "server",
  [WS_METHODS.serverRetryResourceTelemetry]: "server",
  [WS_METHODS.serverCheckOtlpEndpoint]: "server",
  [WS_METHODS.serverGetUsageSummary]: "server",
  [WS_METHODS.serverRefreshUsageRates]: "server",
  [WS_METHODS.serverSignalProcess]: "server",
  [WS_METHODS.serverReportClientActivity]: "server",
  [WS_METHODS.scheduledTasksSubscribe]: "scheduledTasks",
  [WS_METHODS.scheduledTasksUpsert]: "scheduledTasks",
  [WS_METHODS.scheduledTasksSetEnabled]: "scheduledTasks",
  [WS_METHODS.scheduledTasksDelete]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRunNow]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRotateWebhookToken]: "scheduledTasks",
  [WS_METHODS.scheduledTasksListWebhookDeliveries]: "scheduledTasks",
  [WS_METHODS.scheduledTasksGetWebhookDelivery]: "scheduledTasks",
  [WS_METHODS.secretsAnswerRequest]: "secrets",
  [WS_METHODS.guestShareCreate]: "guest-share",
  [WS_METHODS.cloudGetRelayClientStatus]: "cloud",
  [WS_METHODS.cloudInstallRelayClient]: "cloud",
  [WS_METHODS.projectsListEntries]: "workspace",
  [WS_METHODS.projectsReadFile]: "workspace",
  [WS_METHODS.projectsSearchContents]: "workspace",
  [WS_METHODS.projectsSearchEntries]: "workspace",
  [WS_METHODS.projectsWriteFile]: "workspace",
  [WS_METHODS.projectsEnsureScratch]: "orchestration",
  [WS_METHODS.projectsCreateNew]: "orchestration",
  [WS_METHODS.projectsCreateFromThread]: "orchestration",
  [WS_METHODS.shellOpenInEditor]: "workspace",
  [WS_METHODS.filesystemBrowse]: "workspace",
  [WS_METHODS.filesystemGetMetadata]: "workspace",
  [WS_METHODS.agentSessionsScan]: "workspace",
  [WS_METHODS.agentSessionsImport]: "workspace",
  [WS_METHODS.assetsCreateUrl]: "workspace",
  [WS_METHODS.assetsPersistChatAttachments]: "orchestration",
  [WS_METHODS.attachmentsCreateUploadUrl]: "workspace",
  [WS_METHODS.attachmentsDelete]: "workspace",
  [WS_METHODS.providerUploadFeedback]: "provider",
  [WS_METHODS.mcpAppsCallTool]: "provider",
  [WS_METHODS.mcpAppsToolInfo]: "provider",
  [WS_METHODS.mcpAppsUpdateModelContext]: "provider",
  [WS_METHODS.mcpAppsReadResource]: "provider",
  [WS_METHODS.subscribeResourceTelemetry]: "server",
  [WS_METHODS.terminalOpen]: "terminal",
  [WS_METHODS.terminalAttach]: "terminal",
  [WS_METHODS.terminalObserve]: "terminal",
  [WS_METHODS.terminalWrite]: "terminal",
  [WS_METHODS.terminalResize]: "terminal",
  [WS_METHODS.terminalClear]: "terminal",
  [WS_METHODS.terminalClose]: "terminal",
  [WS_METHODS.subscribeTerminalMetadata]: "terminal",
  [WS_METHODS.previewOpen]: "preview",
  [WS_METHODS.previewResize]: "preview",
  [WS_METHODS.previewAdjust]: "preview",
  [WS_METHODS.previewClose]: "preview",
  [WS_METHODS.previewList]: "preview",
  [WS_METHODS.previewClearProfile]: "preview",
  [WS_METHODS.previewReportProfiles]: "preview",
  [WS_METHODS.previewReportStatus]: "preview",
  [WS_METHODS.subscribePreviewEvents]: "preview",
  [WS_METHODS.subscribeDiscoveredLocalServers]: "preview",
  [WS_METHODS.previewStopLocalServer]: "preview",
  [WS_METHODS.subscribeServerConfig]: "server",
  [WS_METHODS.subscribeServerLifecycle]: "server",
  [WS_METHODS.subscribeAuthAccess]: "auth",
  [WS_METHODS.ticketsCreate]: "tickets",
  [WS_METHODS.ticketsUpdate]: "tickets",
  [WS_METHODS.ticketsClose]: "tickets",
  [WS_METHODS.ticketsChoose]: "tickets",
  [WS_METHODS.ticketsGet]: "tickets",
  [WS_METHODS.ticketsList]: "tickets",
  [WS_METHODS.ticketsSubscribe]: "tickets",
  [WS_METHODS.chatSessionsExecute]: "sessions",
  [WS_METHODS.chatSessionsPrint]: "sessions",
  [WS_METHODS.chatSessionsAnswer]: "sessions",
} as const satisfies Readonly<Record<WsRpcMethod, string>>;

const RPC_SPAN_PREFIX = "ws.rpc";
const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;
const RPC_METHODS_WITH_TRACING_DISABLED: ReadonlySet<string> = new Set([
  WS_METHODS.serverGetTraceDiagnostics,
  WS_METHODS.serverGetProcessDiagnostics,
  WS_METHODS.serverGetProcessResourceHistory,
  WS_METHODS.serverSignalProcess,
]);

/** Add after RpcScopeAuthorization to wrap authorization and record rejected calls. */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "ozi/server/RpcInstrumentation",
) {}

export const rpcInstrumentationLayer = Layer.succeed(RpcInstrumentation)((effect, { rpc }) => {
  const method = rpc._tag;
  const measured = effect.pipe(
    withMetrics({ counter: rpcRequestsTotal, timer: rpcRequestDuration, attributes: { method } }),
  );

  if (RPC_METHODS_WITH_TRACING_DISABLED.has(method)) {
    return measured.pipe(Effect.provideService(References.TracerEnabled, false));
  }
  return measured.pipe(
    Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: {
        ...DEFAULT_RPC_SPAN_ATTRIBUTES,
        "rpc.method": method,
        "rpc.aggregate": RPC_AGGREGATES[method as WsRpcMethod],
      },
    }),
  );
});
