import type {
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";

import * as Duration from "effect/Duration";

export type BrowserDefaultSettings = Pick<
  UnifiedSettings,
  | "browserDefaultViewport"
  | "browserDefaultZoomFactor"
  | "browserDefaultAppearance"
  | "browserRecordingFrameRate"
  | "browserRecordingShowKeyPresses"
  | "browserRecordingShowMousePresses"
  | "browserLinkTarget"
  | "browserSearchEngine"
  | "browserCustomSearchUrl"
  | "browserAutoShowFloatingPreview"
>;

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

export const PROVIDER_HEALTH_INTERVAL_STEP_SECONDS = 30;

export function durationToSeconds(duration: Duration.Duration): number {
  return Math.round(Duration.toMillis(duration) / 1_000);
}

export function normalizeIntervalSeconds(value: number | null, minimum = 0): number {
  if (value === null || !Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.round(value));
}
