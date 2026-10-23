import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSettingsWriteScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS } from "./rpc.ts";
import { OZI_WS_METHODS } from "./ozi.ts";

/** Incremental client enforcement; the server still authorizes every request. */
export const CLIENT_GUARDED_RPC_SCOPES = {
  [OZI_WS_METHODS.sessionNew]: AuthOrchestrationOperateScope,
  [OZI_WS_METHODS.sessionList]: AuthOrchestrationReadScope,
  [OZI_WS_METHODS.sessionImport]: AuthOrchestrationOperateScope,
  [OZI_WS_METHODS.sessionReload]: AuthOrchestrationOperateScope,
  [OZI_WS_METHODS.mainPi]: AuthOrchestrationOperateScope,
  [OZI_WS_METHODS.checksList]: AuthOrchestrationReadScope,
  [OZI_WS_METHODS.checksSubscribe]: AuthOrchestrationReadScope,
  [OZI_WS_METHODS.clockAdvance]: AuthOrchestrationOperateScope,
  [OZI_WS_METHODS.jobsGet]: AuthOrchestrationReadScope,
  [OZI_WS_METHODS.jobsSubscribe]: AuthOrchestrationReadScope,
  [OZI_WS_METHODS.jobsHandle]: AuthOrchestrationOperateScope,
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  [WS_METHODS.serverCheckOtlpEndpoint]: AuthSettingsWriteScope,

  [WS_METHODS.scheduledTasksUpsert]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksSetEnabled]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRunNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRotateWebhookToken]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: AuthOrchestrationOperateScope,
} as const;
export type ClientGuardedRpcTag = keyof typeof CLIENT_GUARDED_RPC_SCOPES;

export function clientRpcRequiredScopes(
  method: string,
  input: unknown,
): readonly AuthEnvironmentScope[] {
  return Object.hasOwn(CLIENT_GUARDED_RPC_SCOPES, method)
    ? [CLIENT_GUARDED_RPC_SCOPES[method as ClientGuardedRpcTag]]
    : [];
}
