import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

type Projection = OrchestrationV2ThreadProjection;

export interface V2ItemSupport {
  readonly item: Projection["turnItems"][number] | null;
  readonly run: Projection["runs"][number] | null;
  readonly attempts: ReadonlyArray<Projection["attempts"][number]>;
  readonly node: Projection["nodes"][number] | null;
  readonly providerSession: Projection["providerSessions"][number] | null;
  readonly providerThread: Projection["providerThreads"][number] | null;
  readonly providerTurn: Projection["providerTurns"][number] | null;
  readonly runtimeRequest: Projection["runtimeRequests"][number] | null;
  readonly subagent: Projection["subagents"][number] | null;
  readonly contextHandoff: Projection["contextHandoffs"][number] | null;
  readonly contextTransfer: Projection["contextTransfers"][number] | null;
}
