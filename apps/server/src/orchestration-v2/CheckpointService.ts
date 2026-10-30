import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  OrchestrationV2Checkpoint,
  OrchestrationV2CheckpointScope,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
const ROOT_CHECKPOINT_SCOPE_NAME = "root";
export class CheckpointRootScopePrepareError extends Schema.TaggedError<CheckpointRootScopePrepareError>()(
  "CheckpointRootScopePrepareError",
  {
    threadId: ThreadId,
    runId: RunId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to prepare root checkpoint scope for run ${this.runId}.`;
  }
}
export class CheckpointCaptureError extends Schema.TaggedError<CheckpointCaptureError>()(
  "CheckpointCaptureError",
  {
    scopeId: CheckpointScopeId,
    parentCheckpointId: Schema.optional(CheckpointId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to capture checkpoint for scope ${this.scopeId}.`;
  }
}
export interface CheckpointServiceV2Shape {
  readonly prepareRootRunScope: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly rootNodeId: NodeId;
    readonly providerThreadId: ProviderThreadId;
    readonly cwd: string;
    readonly createdAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2CheckpointScope, CheckpointServiceV2Error>;
  readonly materializeBaselineCheckpoint: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly ordinalWithinScope: number;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
  readonly capture: (input: {
    readonly scope: OrchestrationV2CheckpointScope;
    readonly runId: RunId | null;
    readonly nodeId: NodeId;
    readonly ordinalWithinScope: number;
    readonly appRunOrdinal: number | null;
    readonly capturedAt: DateTime.Utc;
  }) => Effect.Effect<OrchestrationV2Checkpoint, CheckpointServiceV2Error>;
}
export class CheckpointServiceV2 extends Context.Service<
  CheckpointServiceV2,
  CheckpointServiceV2Shape
>()("ozi/orchestration-v2/CheckpointService/CheckpointServiceV2") {}
const makeRootRunScope = Effect.fn("CheckpointService.makeRootRunScope")(function* (input: {
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly cwd: string;
  readonly createdAt: DateTime.Utc;
}) {
  const scopeId = yield* input.idAllocator.allocate.checkpointScope({
    threadId: input.threadId,
    name: ROOT_CHECKPOINT_SCOPE_NAME,
  });
  return {
    id: scopeId,
    threadId: input.threadId,
    runId: input.runId,
    nodeId: input.rootNodeId,
    parentScopeId: null,
    providerThreadId: input.providerThreadId,
    kind: "root_run",
    ordinalWithinParent: 0,
    advancesAppRunCount: true,
    cwd: input.cwd,
    createdAt: input.createdAt,
  } satisfies OrchestrationV2CheckpointScope;
});
function makeCheckpoint(input: {
  readonly id: CheckpointId;
  readonly scope: OrchestrationV2CheckpointScope;
  readonly runId: RunId | null;
  readonly nodeId: NodeId;
  readonly parentCheckpointId: CheckpointId | null;
  readonly ordinalWithinScope: number;
  readonly appRunOrdinal: number | null;
  readonly ref: CheckpointRef;
  readonly status: OrchestrationV2Checkpoint["status"];
  readonly capturedAt: DateTime.Utc;
}): OrchestrationV2Checkpoint {
  return {
    id: input.id,
    threadId: input.scope.threadId,
    scopeId: input.scope.id,
    runId: input.runId,
    nodeId: input.nodeId,
    parentCheckpointId: input.parentCheckpointId,
    ordinalWithinScope: input.ordinalWithinScope,
    appRunOrdinal: input.appRunOrdinal,
    ref: input.ref,
    status: input.status,
    capturedAt: input.capturedAt,
  };
}
export type CheckpointServiceV2Error = CheckpointRootScopePrepareError | CheckpointCaptureError;
export const layer = Layer.effect(
  CheckpointServiceV2,
  Effect.gen(function* () {
    const idAllocator = yield* IdAllocator.IdAllocatorV2;
    const capture: CheckpointServiceV2Shape["capture"] = Effect.fn("CheckpointService.capture")(
      function* (input) {
        const id = yield* idAllocator.allocate.checkpoint({
          checkpointScopeId: input.scope.id,
          name: String(input.ordinalWithinScope),
        });
        const parentCheckpointId =
          input.ordinalWithinScope > 0
            ? yield* idAllocator.allocate.checkpoint({
                checkpointScopeId: input.scope.id,
                name: String(input.ordinalWithinScope - 1),
              })
            : null;
        return makeCheckpoint({
          ...input,
          id,
          parentCheckpointId,
          ref: CheckpointRef.make(id),
          status: "ready",
        });
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError(
            (cause) => new CheckpointCaptureError({ scopeId: input.scope.id, cause }),
          ),
        ),
    );
    return CheckpointServiceV2.of({
      prepareRootRunScope: Effect.fn("CheckpointService.prepareRootRunScope")(
        (input: Parameters<CheckpointServiceV2Shape["prepareRootRunScope"]>[0]) =>
          makeRootRunScope({ ...input, idAllocator }).pipe(
            Effect.mapError(
              (cause) =>
                new CheckpointRootScopePrepareError({
                  threadId: input.threadId,
                  runId: input.runId,
                  cause,
                }),
            ),
          ),
      ),
      capture,
      materializeBaselineCheckpoint: Effect.fn("CheckpointService.materializeBaselineCheckpoint")(
        (input: Parameters<CheckpointServiceV2Shape["materializeBaselineCheckpoint"]>[0]) =>
          capture({
            scope: input.scope,
            runId: null,
            nodeId: input.scope.nodeId,
            ordinalWithinScope: input.ordinalWithinScope,
            appRunOrdinal: null,
            capturedAt: input.scope.createdAt,
          }),
      ),
    });
  }),
);
