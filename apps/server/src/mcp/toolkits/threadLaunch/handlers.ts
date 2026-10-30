import * as Schema from "effect/Schema";
import { CommandId, MessageId, ThreadId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";
import * as Claims from "../../../orchestration-v2/AttachmentClaims.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import * as DateTime from "effect/DateTime";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { resolveRuntimeMode } from "../../delegatedTaskModes.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { newCommandId, readCaller, unavailable } from "../../threadAccess.ts";
import { ThreadLaunchToolkit } from "./tools.ts";

const encodeLaunchKey = Schema.encodeSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String])),
);

const launchCommandId = Effect.fn("mcp.launchCommandId")(function* (
  namespace: string,
  key: string,
) {
  const crypto = yield* Crypto.Crypto;
  const bytes = new TextEncoder().encode(encodeLaunchKey([namespace, key]));
  const digest = yield* crypto.digest("SHA-256", bytes).pipe(Effect.mapError(unavailable));
  return CommandId.make(`mcp:launch:${Hex.encode(digest)}`);
});

export const layer = McpToolAccess.toLayer(ThreadLaunchToolkit, {
  ozi_thread_launch: McpToolAccess.startsThreads(
    (input) => input,
    (input, { runtimeMode, interactionMode, linkOrigin }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.McpInvocationContext;
        const context = yield* readCaller();
        const { caller } = context;
        const commandId =
          input.clientRequestId === undefined
            ? yield* newCommandId()
            : yield* launchCommandId(scope.requestNamespace, input.clientRequestId);
        const threadId = ThreadId.make(commandId);
        const messageId = MessageId.make(commandId);
        const attachments = input.attachments ?? [];
        if (attachments.some((attachment) => !Claims.attachmentIsPendingUpload(attachment)))
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "A new thread accepts only pending attachment uploads.",
          });
        const launched =
          input.clientRequestId === undefined
            ? null
            : yield* context.threads.getThreadShell(threadId).pipe(Effect.mapError(unavailable));
        const launchedModel =
          launched === null || launched.deletedAt !== null ? undefined : launched.modelSelection;
        const replaying = launchedModel !== undefined;
        const defaults =
          caller === undefined && !replaying
            ? yield* ServerSettings.ServerSettingsService.pipe(
                Effect.flatMap((service) => service.getSettings),
                Effect.mapError(unavailable),
              )
            : undefined;
        const modelSelection =
          input.modelSelection ??
          launchedModel ??
          caller?.modelSelection ??
          (defaults
            ? resolveNewThreadModelSelection({
                defaultSelection: defaults.defaultModelSelection,
                fallbackSelection: defaults.fallbackModelSelection,
                providers: yield* ProviderRegistry.ProviderRegistry.pipe(
                  Effect.flatMap((registry) => registry.getProviders),
                ),
                settings: defaults,
                now: DateTime.toEpochMillis(yield* DateTime.now),
              }).selection
            : null) ??
          undefined;
        if (modelSelection === undefined)
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Pass modelSelection. orchestrator_capabilities lists providers and models.",
          });
        const startedRuntimeMode =
          defaults !== undefined && input.runtimeMode === undefined
            ? yield* resolveRuntimeMode(runtimeMode, defaults.defaultRuntimeMode).pipe(
                Effect.orElseSucceed(() => runtimeMode),
              )
            : runtimeMode;
        const result = yield* ThreadMessageIntake.launchThread({
          commandId,
          threadId,
          title: input.title,
          workingDirectory: input.workingDirectory ?? caller?.workingDirectory ?? undefined,
          modelSelection,
          runtimeMode: startedRuntimeMode,
          interactionMode,
          ...(input.message === undefined && attachments.length === 0
            ? {}
            : {
                initialMessage: {
                  messageId,
                  ...(caller === undefined ? {} : { senderThreadId: caller.id }),
                  text: input.message ?? "",
                  attachments,
                },
              }),
          createdBy: "agent",
          creationSource: "mcp",
          ...(linkOrigin === undefined ? {} : { linkOrigin }),
          ...(input.delegatedFrom === undefined ? {} : { delegatedFrom: input.delegatedFrom }),
        }).pipe(
          Effect.mapError((error) => {
            if (error._tag === "AttachmentClaimError") {
              return new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: error.message,
              });
            }
            if (error._tag === "ThreadManagementProviderInstanceDisabledError") {
              return new OrchestratorMcpFailure({
                code: "invalid_request",
                message: error.message,
              });
            }
            return unavailable();
          }),
        );
        const thread = result.projection.thread;
        const run = result.projection.runs.find((run) => run.userMessageId === messageId);
        return {
          threadId: thread.id,
          link: McpInvocationContext.threadLinkFor(scope, thread.id),
          modelSelection: thread.modelSelection,
          runId: run?.id ?? null,
          status: run?.status ?? null,
        };
      }),
    "stamped",
  ),
});
