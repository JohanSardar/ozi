import { createWorkspaceEnvironmentAtoms } from "@t3tools/client-runtime/state/workspace";
import { connectionAtomRuntime } from "../connection/runtime";

export const workspaceEnvironment = createWorkspaceEnvironmentAtoms(connectionAtomRuntime);
