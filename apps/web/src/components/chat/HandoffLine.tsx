import { useAtomValue } from "@effect/atom-react";
import type {
  NodeId,
  OrchestrationV2TurnItem,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronRightIcon, CornerDownRightIcon } from "lucide-react";

import { useEnvironmentQuery } from "../../state/query";
import { environmentThreadDetails } from "../../state/threads";
import { ticketList, useInboxStore } from "../../state/tickets";
import { orderTickets } from "../inbox/InboxPanel";

const STATES: Record<OrchestrationV2TurnItem["status"], string> = {
  pending: "queued",
  running: "working",
  waiting: "waiting",
  idle: "idle",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
  interrupted: "stopped",
};

export function HandoffLine(props: {
  readonly parentRef: ScopedThreadRef;
  readonly subagentId: NodeId;
  readonly title: string;
  readonly status: OrchestrationV2TurnItem["status"];
  readonly childThreadId: ThreadId | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const status = useAtomValue(
    environmentThreadDetails.threadAtom(props.parentRef),
    (thread) => thread?.projection.subagents.find((agent) => agent.id === props.subagentId)?.status,
  );
  const tickets = orderTickets(
    useEnvironmentQuery(ticketList({ environmentId: props.parentRef.environmentId, input: {} }))
      .data?.tickets ?? [],
  );
  const ticket = tickets.find((candidate) => candidate.origin.jobId === props.subagentId);
  const state = ticket ? "waiting on you" : STATES[status ?? props.status];
  const childThreadId = props.childThreadId;
  const open = ticket
    ? () =>
        useInboxStore.setState({
          tab: "inbox",
          selected: { id: ticket.id, index: tickets.indexOf(ticket), reveal: true },
        })
    : childThreadId
      ? () => props.onOpenThread(childThreadId)
      : undefined;
  return (
    <button
      type="button"
      aria-label={`${props.title} · ${state}`}
      onClick={open}
      className="mt-3 mb-0.5 inline-flex max-w-full items-center gap-2.5 rounded-lg border border-border bg-card py-2 pr-2.5 pl-3 text-left text-sm transition-colors hover:border-ring/40"
    >
      <CornerDownRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="min-w-0 truncate font-medium">{props.title}</span>
      <span className="shrink-0 text-muted-foreground">· {state}</span>
      <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
    </button>
  );
}
