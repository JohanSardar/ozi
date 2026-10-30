import { McpAttachmentInput } from "../attachment/input.ts";
import {
  ModelSelection,
  TrimmedNonEmptyString,
  ThreadId,
  RunId,
  OrchestrationV2DelegatedFrom,
  OrchestrationV2RunStatus,
  RuntimeMode,
  ProviderInteractionMode,
  OrchestratorMcpClientRequestId,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ServerConfig from "../../../config.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ThreadLaunchService from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ThreadLaunchTool = Tool.make("ozi_thread_launch", {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  description:
    "Create one new top-level chat. Task in `message`. Omit the model, modes and workingDirectory to inherit yours; modes cannot exceed yours. After an error or lost reply, retry with the same `clientRequestId`. Follow it with `ozi_thread_read` or `ozi_thread_wait`. Mention it with its `link`.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    workingDirectory: Schema.optional(TrimmedNonEmptyString),
    title: TrimmedNonEmptyString,
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    message: Schema.optional(
      Schema.String.check(Schema.isMaxLength(120000)).annotate({
        description: "First prompt. Omit it and `attachments` for idle.",
      }),
    ),
    attachments: Schema.optional(Schema.Array(McpAttachmentInput).check(Schema.isMaxLength(8))),
    clientRequestId: Schema.optional(OrchestratorMcpClientRequestId),
    /** Set by a linked environment launching its agent's delegated task here; ignored otherwise. */
    delegatedFrom: Schema.optional(OrchestrationV2DelegatedFrom),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    link: Schema.optional(Schema.String),
    modelSelection: ModelSelection,
    runId: Schema.NullOr(RunId),
    status: Schema.NullOr(OrchestrationV2RunStatus),
  }),
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    Crypto.Crypto,
    ThreadLaunchService.ThreadLaunchService,
    FileSystem.FileSystem,
    ServerConfig.ServerConfig,
    ServerSettings.ServerSettingsService,
    ProviderRegistry.ProviderRegistry,
    DocumentText.DocumentText,
  ],
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const ThreadLaunchToolkit = Toolkit.make(ThreadLaunchTool);
