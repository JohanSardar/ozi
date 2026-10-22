import { useAtomValue } from "@effect/atom-react";
import { createJobsEnvironmentAtoms } from "@t3tools/client-runtime/state/jobs";
import type { EnvironmentId, OziJobHandleInput } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { commandError } from "./JobPanel";
import { requireCommand } from "./useJobActions";

const jobs = createJobsEnvironmentAtoms(connectionAtomRuntime);

export function useOziJobs(environmentId: EnvironmentId) {
  const snapshot = useAtomValue(jobs.snapshot(environmentId));
  const handle = useAtomCommand(jobs.handleJob, { reportFailure: false });
  return {
    cards: snapshot.cards,
    fresh: snapshot.fresh,
    unavailable:
      snapshot.result._tag === "Failure"
        ? commandError(Cause.squash(snapshot.result.cause))
        : snapshot.fresh
          ? undefined
          : "Waiting for current job updates…",
    onHandle: async (input: OziJobHandleInput) => {
      requireCommand(await handle({ environmentId, input }));
    },
  };
}
