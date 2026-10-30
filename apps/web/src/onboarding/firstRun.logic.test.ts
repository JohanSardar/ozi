import { describe, expect, it } from "vite-plus/test";

import { resolveFirstRunDecision, transitionFirstRunGateState } from "./firstRun.logic";

const freshWorkspace = {
  enabled: true,
  hydrated: true,
  completed: false,
  bootstrapped: true,
  authoritative: true,
  workspaceAuthoritative: true,
  workspaceProvenanceAuthoritative: true,
  catalogReady: true,
  serverConfigAvailable: true,
  workspaceFresh: true,
  threadCount: 1,
} as const;

describe("transitionFirstRunGateState", () => {
  it("shows recovery without mounting the app when evidence stalls", () => {
    expect(
      transitionFirstRunGateState({ decision: "pending", stalled: false }, { type: "timeout" }),
    ).toEqual({ decision: "pending", stalled: true });
  });

  it.each([
    { previous: "app", workspaceFresh: true, decision: "wizard" },
    { previous: "wizard", workspaceFresh: false, decision: "app" },
  ] as const)(
    "updates $previous to $decision when authoritative workspace evidence changes",
    ({ previous, workspaceFresh, decision }) => {
      const evidence = resolveFirstRunDecision({ ...freshWorkspace, workspaceFresh });
      expect(
        transitionFirstRunGateState(
          { decision: previous, stalled: false },
          { type: "evidence", decision: evidence.decision },
        ),
      ).toEqual({ decision, stalled: false });
    },
  );

  // regression: #19680 unchanged gate evidence must not produce a new state
  it.each(["pending", "app", "wizard"] as const)(
    "preserves state identity for unchanged %s evidence",
    (decision) => {
      const state = { decision, stalled: false };
      expect(transitionFirstRunGateState(state, { type: "evidence", decision })).toBe(state);
    },
  );
});
