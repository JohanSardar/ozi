import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  INITIAL_NEW_TASK_FLOW_STATE,
  resolveRouteDraft,
  stampedEnvironmentLoading,
} from "./new-task-flow-state";

describe("resolveRouteDraft", () => {
  const environmentId = EnvironmentId.make("env");
  const stamp = { environmentId };
  const base = {
    environments: [{ environmentId }],
    flow: INITIAL_NEW_TASK_FLOW_STATE,
    routeDraftId: "new-task:draft-1",
    draftsLoaded: true,
    stamp,
    stampedEnvironmentLoading: false,
  };

  it("binds the route's draft and its stamped project", () => {
    expect(resolveRouteDraft(base)).toEqual({
      kind: "open",
      flow: {
        ...INITIAL_NEW_TASK_FLOW_STATE,
        environmentId,
        draftKey: "new-task:draft-1",
      },
    });
  });

  it("leaves a flow that already bound a draft alone", () => {
    const flow = { ...INITIAL_NEW_TASK_FLOW_STATE, draftKey: "new-task:other" };
    expect(
      resolveRouteDraft({
        ...base,
        flow,
      }),
    ).toEqual({ kind: "none" });
  });

  it("waits for hydration, and for the stamped environment's projects", () => {
    expect(
      resolveRouteDraft({
        ...base,
        draftsLoaded: false,
        stamp: undefined,
      }),
    ).toEqual({
      kind: "pending",
    });
    expect(
      resolveRouteDraft({
        ...base,
        stampedEnvironmentLoading: true,
      }),
    ).toEqual({
      kind: "pending",
    });
  });

  it("reports a draft that is gone or whose project is gone", () => {
    expect(
      resolveRouteDraft({
        ...base,
        stamp: undefined,
      }),
    ).toEqual({ kind: "missing" });
    expect(resolveRouteDraft({ ...base })).toEqual({ kind: "missing" });
  });
});

describe("stampedEnvironmentLoading", () => {
  const settled = {
    connectionsReady: true,
    connectionState: "connected" as const,
    shellCacheRead: true,
    shellStatus: "live" as const,
    shellHasError: false,
  };

  it("waits while the environment is still delivering its first project list", () => {
    expect(stampedEnvironmentLoading({ ...settled, connectionsReady: false })).toBe(true);
    expect(stampedEnvironmentLoading({ ...settled, shellCacheRead: false })).toBe(true);
    expect(stampedEnvironmentLoading({ ...settled, connectionState: "connecting" })).toBe(true);
    expect(stampedEnvironmentLoading({ ...settled, shellStatus: "synchronizing" })).toBe(true);
  });

  it("settles once the list is live, or when nothing more will arrive", () => {
    expect(stampedEnvironmentLoading(settled)).toBe(false);
    expect(stampedEnvironmentLoading({ ...settled, connectionState: null })).toBe(false);
    expect(
      stampedEnvironmentLoading({
        ...settled,
        connectionState: "reconnecting",
        shellStatus: "synchronizing",
      }),
    ).toBe(false);
    expect(stampedEnvironmentLoading({ ...settled, shellHasError: true })).toBe(false);
  });
});
