import { EnvironmentId, type OrchestrationThreadSearchMatch } from "@t3tools/contracts";

export interface EnvironmentThreadSearchMatch extends OrchestrationThreadSearchMatch {
  readonly environmentId: EnvironmentId;
}

export interface ThreadSearchResultsState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isLoading: boolean;
}
