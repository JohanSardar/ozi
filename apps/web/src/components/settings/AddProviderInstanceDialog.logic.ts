export type WizardNavigation =
  | { readonly kind: "navigate"; readonly step: number }
  | { readonly kind: "blocked"; readonly step: number; readonly error: string };

const IDENTITY_STEP = 1;

export const ADD_PROVIDER_WIZARD_STEPS = ["Provider", "Identity", "Config"] as const;

export interface ProviderIdentityDraft {
  readonly label: string;
  readonly accentColor: string;
  readonly instanceIdOverride: string | null;
}

export function deriveAvailableInstanceId(
  derive: (label: string) => string,
  label: string,
  existing: ReadonlySet<string>,
): string {
  const base = derive(label);
  if (!base || !existing.has(base)) return base;

  for (let suffix = 2; ; suffix += 1) {
    const suffixText = `_${suffix}`;
    const candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function resolveWizardNavigation(
  currentStep: number,
  requestedStep: number,
  stepCount: number,
  validation: {
    readonly instanceIdError: string | null;
    readonly identityStep?: number;
    readonly prerequisite?: {
      readonly step: number;
      readonly error: string | null;
    };
  },
): WizardNavigation {
  const lastStep = Math.max(0, stepCount - 1);
  const targetStep = Math.max(0, Math.min(lastStep, requestedStep));
  const identityStep = validation.identityStep ?? IDENTITY_STEP;
  const prerequisite = validation.prerequisite;

  if (prerequisite?.error && currentStep <= prerequisite.step && targetStep > prerequisite.step) {
    return {
      kind: "blocked",
      step: Math.min(prerequisite.step, lastStep),
      error: prerequisite.error,
    };
  }

  const movesForwardPastIdentity = currentStep <= identityStep && targetStep > identityStep;

  if (movesForwardPastIdentity && validation.instanceIdError !== null) {
    return {
      kind: "blocked",
      step: Math.min(identityStep, lastStep),
      error: validation.instanceIdError,
    };
  }

  return { kind: "navigate", step: targetStep };
}
