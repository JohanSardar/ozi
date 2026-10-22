import {
  ModelSelection,
  isOziMain,
  isOziMainSelection,
  OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerConfig from "../config.ts";

export class RuntimePolicyResolveError extends Schema.TaggedError<RuntimePolicyResolveError>()(
  "RuntimePolicyResolveError",
  {
    projectId: ProjectId,
    providerInstanceId: ProviderInstanceId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to resolve runtime policy for provider instance ${this.providerInstanceId} in project ${this.projectId}.`;
  }
}

export const RuntimePolicyV2Error = Schema.Union([RuntimePolicyResolveError]);
export type RuntimePolicyV2Error = typeof RuntimePolicyV2Error.Type;

export const RuntimePolicyV2Override = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  approvalPolicy: Schema.optional(Schema.Unknown),
  sandboxPolicy: Schema.optional(Schema.Unknown),
  reasoningEffort: Schema.optional(Schema.String),
});
export type RuntimePolicyV2Override = typeof RuntimePolicyV2Override.Type;

export interface RuntimePolicyV2Shape {
  readonly resolve: (input: {
    readonly thread: OrchestrationV2AppThread;
    readonly modelSelection: ModelSelection;
  }) => Effect.Effect<ProviderAdapter.ProviderAdapterV2RuntimePolicy, RuntimePolicyV2Error>;
}

export class RuntimePolicyV2 extends Context.Service<RuntimePolicyV2, RuntimePolicyV2Shape>()(
  "t3/orchestration-v2/RuntimePolicy/RuntimePolicyV2",
) {}

function providerRuntimeMode(
  runtimeMode: RuntimeMode,
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
): RuntimeMode {
  return supportedRuntimeModes === undefined ||
    supportedRuntimeModes.length === 0 ||
    supportedRuntimeModes.includes(runtimeMode)
    ? runtimeMode
    : "approval-required";
}

const mainSelectionError = (
  input: Parameters<RuntimePolicyV2Shape["resolve"]>[0],
  snapshot: ServerProvider | undefined,
) => {
  if (!isOziMain(input.thread)) return;
  const thinking = snapshot?.models
    .find((model) => model.slug === input.modelSelection.model)
    ?.capabilities?.optionDescriptors?.find((option) => option.id === "thinking");
  if (
    !isOziMainSelection(input.modelSelection) ||
    snapshot?.driver !== "pi" ||
    !snapshot.enabled ||
    !snapshot.installed ||
    snapshot.status === "error" ||
    snapshot.auth.status === "unauthenticated" ||
    thinking?.type !== "select" ||
    !thinking.options.some((option) => option.id === "high")
  )
    return new RuntimePolicyResolveError({
      projectId: input.thread.projectId,
      providerInstanceId: input.modelSelection.instanceId,
      cause: "Main requires available Pi claude-bridge/claude-opus-5-5, high thinking, fast off.",
    });
};

const checkerSelectionError = (
  input: Parameters<RuntimePolicyV2Shape["resolve"]>[0],
  snapshot: ServerProvider | undefined,
) => {
  if (input.thread.role !== "checker") return;
  const model = snapshot?.models.find((model) => model.slug === input.modelSelection.model);
  for (const selected of input.modelSelection.options ?? []) {
    const descriptor = model?.capabilities?.optionDescriptors?.find(
      (option) => option.id === selected.id,
    );
    if (!descriptor && !["thinking", "reasoningEffort", "effort"].includes(selected.id)) continue;
    if (
      !descriptor ||
      (descriptor.type === "select"
        ? !descriptor.options.some((option) => option.id === selected.value)
        : typeof selected.value !== "boolean")
    )
      return new RuntimePolicyResolveError({
        projectId: input.thread.projectId,
        providerInstanceId: input.modelSelection.instanceId,
        cause: `Unsupported checker option ${selected.id}=${selected.value}.`,
      });
  }
};

export const layerInstallation = Layer.effect(
  RuntimePolicyV2,
  Effect.gen(function* () {
    const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return RuntimePolicyV2.of({
      resolve: Effect.fn("RuntimePolicyV2.installation")(function* (input) {
        const workspace = path.join(config.baseDir, "workspace");
        const jobId = input.thread.jobId;
        const cwd =
          jobId == null
            ? workspace
            : path.join(
                workspace,
                "jobs",
                yield* Effect.promise(() =>
                  crypto.subtle.digest("SHA-256", new TextEncoder().encode(jobId)),
                ).pipe(Effect.map((digest) => Buffer.from(digest).toString("hex"))),
              );
        yield* fs.makeDirectory(cwd, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimePolicyResolveError({
                projectId: input.thread.projectId,
                providerInstanceId: input.modelSelection.instanceId,
                cause,
              }),
          ),
        );
        const instance = yield* providerInstances.getInstance(input.modelSelection.instanceId);
        let snapshot = instance === undefined ? undefined : yield* instance.snapshot.getSnapshot;
        if (instance && checkerSelectionError(input, snapshot))
          snapshot = yield* instance.snapshot.refresh;
        const invalid =
          mainSelectionError(input, snapshot) ?? checkerSelectionError(input, snapshot);
        if (invalid) return yield* invalid;
        return ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: providerRuntimeMode(
            input.thread.runtimeMode,
            snapshot?.supportedRuntimeModes,
          ),
          interactionMode: input.thread.interactionMode,
          cwd,
        });
      }),
    });
  }),
);
