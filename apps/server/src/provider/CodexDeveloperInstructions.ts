import type { ProviderInteractionMode } from "@t3tools/contracts";
import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { OZI_WORKER_ROLE } from "@t3tools/provider-core/server/orchestrationInstructions";

export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
}

export interface CodexRuntimeInfo {
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

export function buildCodexDeveloperInstructions(_interactionMode: ProviderInteractionMode): string {
  return OZI_WORKER_ROLE;
}

export function buildCodexAdditionalContext(
  _runtime: CodexRuntimeInfo,
  _toolsAvailable: boolean | T3CodeToolAvailability = true,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  return { ozi_worker: { kind: "application", value: OZI_WORKER_ROLE } };
}
