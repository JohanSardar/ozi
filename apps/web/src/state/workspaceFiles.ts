import { createWorkspaceEnvironmentAtoms } from "@t3tools/client-runtime/state/workspace";
import { connectionAtomRuntime } from "../connection/runtime";

export const workspaceEnvironment = createWorkspaceEnvironmentAtoms(connectionAtomRuntime);

import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

export const workspaceContentSearch = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workspace:search-contents",
  tag: WS_METHODS.workspaceSearchContents,
  staleTimeMs: 5000,
  idleTtlMs: 60000,
});
