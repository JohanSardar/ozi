import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationV2ProjectLabel } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { environmentShell } from "../../state/shell";

const NO_PROJECTS: readonly OrchestrationV2ProjectLabel[] = [];

const projectsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      Option.getOrNull(get(environmentShell.stateValueAtom(environmentId)).snapshot)?.projects ??
      NO_PROJECTS,
  ).pipe(Atom.withLabel(`web-settings-environment-projects:${environmentId}`)),
);
const NO_PROJECTS_ATOM = Atom.make(NO_PROJECTS).pipe(
  Atom.withLabel("web-settings-environment-projects:none"),
);

export function useEnvironmentProjects(environmentId: string | undefined) {
  return useAtomValue(
    environmentId === undefined ? NO_PROJECTS_ATOM : projectsAtom(environmentId as EnvironmentId),
  );
}
