import {
  OZI_WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

import { rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * Trace queries and dashboards group by these labels, so they keep their historical values
 * even where they differ from the method prefix.
 */
const RPC_AGGREGATES = {
  [OZI_WS_METHODS.sessionNew]: "orchestrationV2",
  [OZI_WS_METHODS.sessionList]: "orchestrationV2",
  [OZI_WS_METHODS.sessionImport]: "orchestrationV2",
  [OZI_WS_METHODS.sessionReload]: "orchestrationV2",
  [OZI_WS_METHODS.sessionExport]: "orchestrationV2",
  [OZI_WS_METHODS.mainSettings]: "orchestrationV2",
  [OZI_WS_METHODS.mainPi]: "orchestrationV2",
  [OZI_WS_METHODS.clockAdvance]: "jobs",
  [OZI_WS_METHODS.todosGet]: "jobs",
  [OZI_WS_METHODS.jobsGet]: "jobs",
  [OZI_WS_METHODS.jobsSubscribe]: "jobs",
  [OZI_WS_METHODS.jobsHandle]: "jobs",
  [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.getWorkflowScript]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreads]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThread]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.searchThreadStream]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getArchivedShellSnapshot]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.getThreadProjection]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeArchivedShell]: "orchestration",
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: "orchestrationV2",
  [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: "orchestrationV2",
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
  [WS_METHODS.codexAuthCallbackSubscribe]: "provider",
  [WS_METHODS.providerAuthRespond]: "provider",
  [WS_METHODS.providerAuthCancel]: "provider",
  [WS_METHODS.providerAuthLogout]: "provider",
  [WS_METHODS.providerAuthSubscribe]: "provider",
  [WS_METHODS.providerInstallStart]: "provider",
  [WS_METHODS.providerInstallCancel]: "provider",
  [WS_METHODS.providerInstallSubscribe]: "provider",
  [WS_METHODS.providerInstallRemove]: "provider",
  [WS_METHODS.serverUpsertKeybinding]: "server",
  [WS_METHODS.serverRemoveKeybinding]: "server",
  [WS_METHODS.serverGetDatabaseStorage]: "server",
  [WS_METHODS.serverGetSettings]: "server",
  [WS_METHODS.serverUpdateSettings]: "server",
  [WS_METHODS.serverGetTraceDiagnostics]: "server",
  [WS_METHODS.serverCheckOtlpEndpoint]: "server",
  [WS_METHODS.serverGetUsageSummary]: "server",
  [WS_METHODS.serverRefreshUsageRates]: "server",
  [WS_METHODS.scheduledTasksList]: "scheduledTasks",
  [WS_METHODS.scheduledTasksSubscribe]: "scheduledTasks",
  [WS_METHODS.scheduledTasksUpsert]: "scheduledTasks",
  [WS_METHODS.scheduledTasksSetEnabled]: "scheduledTasks",
  [WS_METHODS.scheduledTasksDelete]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRunNow]: "scheduledTasks",
  [WS_METHODS.scheduledTasksRotateWebhookToken]: "scheduledTasks",
  [WS_METHODS.scheduledTasksListWebhookDeliveries]: "scheduledTasks",
  [WS_METHODS.scheduledTasksGetWebhookDelivery]: "scheduledTasks",
  [WS_METHODS.secretsAnswerRequest]: "secrets",
  [WS_METHODS.shellOpenInEditor]: "workspace",
  [WS_METHODS.assetsCreateUrl]: "workspace",
  [WS_METHODS.assetsPersistChatAttachments]: "orchestration",
  [WS_METHODS.attachmentsCreateUploadUrl]: "workspace",
  [WS_METHODS.attachmentsDelete]: "workspace",
  [WS_METHODS.providerUploadFeedback]: "provider",
  [WS_METHODS.mcpAppsCallTool]: "provider",
  [WS_METHODS.mcpAppsToolInfo]: "provider",
  [WS_METHODS.mcpAppsUpdateModelContext]: "provider",
  [WS_METHODS.mcpAppsReadResource]: "provider",
  [WS_METHODS.previewOpen]: "preview",
  [WS_METHODS.previewNavigate]: "preview",
  [WS_METHODS.previewResize]: "preview",
  [WS_METHODS.previewAdjust]: "preview",
  [WS_METHODS.previewRefresh]: "preview",
  [WS_METHODS.previewClose]: "preview",
  [WS_METHODS.previewList]: "preview",
  [WS_METHODS.previewClearProfile]: "preview",
  [WS_METHODS.previewReportProfiles]: "preview",
  [WS_METHODS.previewReportStatus]: "preview",
  [WS_METHODS.subscribePreviewEvents]: "preview",
  [WS_METHODS.subscribeDiscoveredLocalServers]: "preview",
  [WS_METHODS.subscribeServerConfig]: "server",
  [WS_METHODS.subscribeServerLifecycle]: "server",
  [WS_METHODS.subscribeAuthAccess]: "auth",
  "ozi.checks.list": "orchestrationV2",
  "ozi.checks.subscribe": "orchestrationV2",
} as const satisfies Readonly<Record<WsRpcMethod, string>>;

const RPC_SPAN_PREFIX = "ws.rpc";
const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;
const RPC_METHODS_WITH_TRACING_DISABLED: ReadonlySet<string> = new Set([
  WS_METHODS.serverGetTraceDiagnostics,
]);

/**
 * `ws.ts` adds it to the server's group after `RpcScopeAuthorization`, so it wraps
 * authorization and also records rejected calls.
 */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "t3/server/RpcInstrumentation",
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
