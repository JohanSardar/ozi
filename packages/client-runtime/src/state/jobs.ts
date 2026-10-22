import { OZI_WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createJobsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    handleJob: createEnvironmentRpcCommand(runtime, {
      label: "Jobs.handle",
      tag: OZI_WS_METHODS.jobsHandle,
    }),
  };
}
