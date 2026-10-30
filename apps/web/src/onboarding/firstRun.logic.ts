export type FirstRunDecision = "pending" | "app" | "wizard";

export interface FirstRunGateState {
  readonly decision: FirstRunDecision;
  readonly stalled: boolean;
}

type FirstRunGateEvent =
  | { readonly type: "evidence"; readonly decision: FirstRunDecision }
  | { readonly type: "timeout" };

interface FirstRunDecisionInput {
  readonly enabled: boolean;
  readonly hydrated: boolean;
  readonly completed: boolean;
  readonly bootstrapped: boolean;
  readonly authoritative: boolean;
  readonly workspaceAuthoritative: boolean;
  readonly workspaceProvenanceAuthoritative: boolean;
  readonly catalogReady: boolean;
  readonly serverConfigAvailable: boolean;
  readonly workspaceFresh: boolean;
  readonly threadCount: number;
}

export function transitionFirstRunGateState(
  state: FirstRunGateState,
  event: FirstRunGateEvent,
): FirstRunGateState {
  if (event.type === "timeout") {
    return state.decision === "pending" && !state.stalled ? { ...state, stalled: true } : state;
  }

  if (event.decision === "pending" || state.decision === event.decision) {
    return state;
  }

  return { decision: event.decision, stalled: false };
}

export function resolveFirstRunDecision(input: FirstRunDecisionInput): {
  readonly decision: FirstRunDecision;
  readonly persistCompletion: boolean;
} {
  if (!input.enabled || (input.hydrated && input.completed)) {
    return { decision: "app", persistCompletion: false };
  }

  if (!input.hydrated) {
    return { decision: "pending", persistCompletion: false };
  }

  if (input.threadCount > 0) {
    return {
      decision: "app",
      persistCompletion:
        input.bootstrapped &&
        input.authoritative &&
        input.workspaceAuthoritative &&
        input.catalogReady &&
        input.serverConfigAvailable,
    };
  }

  if (
    !input.bootstrapped ||
    !input.authoritative ||
    !input.workspaceProvenanceAuthoritative ||
    !input.catalogReady ||
    !input.serverConfigAvailable
  ) {
    return { decision: "pending", persistCompletion: false };
  }

  return input.workspaceFresh
    ? { decision: "wizard", persistCompletion: false }
    : { decision: "app", persistCompletion: input.workspaceAuthoritative };
}

export function resolveHostedFirstRunDecision(hydrated: boolean): {
  readonly decision: FirstRunDecision;
  readonly persistCompletion: boolean;
} {
  return { decision: hydrated ? "app" : "pending", persistCompletion: false };
}
