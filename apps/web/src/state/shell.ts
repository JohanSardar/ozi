import {
  createEnvironmentShellAtoms,
  createEnvironmentSnapshotAtom,
  createShellEnvironmentAtoms,
} from "@t3tools/client-runtime/state/shell";

import { connectionAtomRuntime } from "../connection/runtime";

export const shellEnvironment = createShellEnvironmentAtoms(connectionAtomRuntime);
const environmentShell = createEnvironmentShellAtoms(connectionAtomRuntime);
export const environmentSnapshotAtom = createEnvironmentSnapshotAtom(environmentShell.stateAtom);
