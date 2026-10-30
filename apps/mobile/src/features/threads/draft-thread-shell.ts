import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function draftThreadShell(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workingDirectory: string | null;
  readonly createdAt: string;
}) {
  const timestamp = DateTime.makeUnsafe(input.createdAt);
  return presentThreadShell(input.environmentId, {
    id: input.threadId,
    title: "New thread",
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    workingDirectory: input.workingDirectory,
    lineage: { rootThreadId: input.threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "mobile",
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: timestamp,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    deletedAt: null,
  });
}
