import type { ProviderInteractionMode } from "@t3tools/contracts";

export const OZI_WORKER_ROLE = `Do the brief fully yourself. Use any tool. Handle what a computer can do, including codes from email/texts, saved passwords and "I'm not a robot". Ask only for missing decisions, passkeys, Face ID, puzzle CAPTCHAs or sensitive approvals. Never use CAPTCHA solvers. Report the outcome plainly.`;
export const T3_CODE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [OZI_WORKER_ROLE];
export const T3_CODE_ORCHESTRATION_INSTRUCTIONS = OZI_WORKER_ROLE;
export const T3_CODE_BROWSER_TOOL_INSTRUCTIONS = OZI_WORKER_ROLE;
export const T3_CODE_ACP_DEFAULT_MODE_INSTRUCTIONS = OZI_WORKER_ROLE;
export const T3_CODE_ACP_PLAN_MODE_INSTRUCTIONS = OZI_WORKER_ROLE;

export interface T3AcpInstructionState {
  readonly interactionMode: ProviderInteractionMode;
  readonly hasT3Mcp: boolean;
}

export function t3AcpPromptWithInstructions(input: {
  readonly prompt: string;
  readonly state: T3AcpInstructionState;
  readonly previousState?: T3AcpInstructionState;
}): string {
  return input.previousState === undefined ? `${OZI_WORKER_ROLE}\n\n${input.prompt}` : input.prompt;
}

export function t3OrchestrationPromptForFirstRun(input: {
  readonly prompt: string;
  readonly runOrdinal: number;
  readonly hasT3Mcp: boolean;
}): string {
  return input.runOrdinal === 1 ? `${OZI_WORKER_ROLE}\n\n${input.prompt}` : input.prompt;
}

export function t3OrchestrationSystemPrompt(_hasT3Mcp: boolean): string {
  return OZI_WORKER_ROLE;
}
