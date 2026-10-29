import {
  type EnvironmentId,
  type ThreadId,
  type Ticket,
  type TicketId,
  WS_METHODS,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  formatComposerContextReference,
  ticketContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { create } from "zustand";

import { connectionAtomRuntime } from "../connection/runtime";
import { readThreadShell } from "./entities";
import { readPreparedConnection } from "./session";

export const ticketList = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:tickets:subscribe",
  tag: WS_METHODS.ticketsSubscribe,
  idleTtlMs: 10_000,
});

export const ticketClose = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:tickets:close",
  tag: WS_METHODS.ticketsClose,
});

export const ticketChoose = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:tickets:choose",
  tag: WS_METHODS.ticketsChoose,
});

export const useInboxStore = create<{
  tab: "inbox" | "archive";
  selected: { id: TicketId | null; index: number; reveal?: boolean };
}>()(() => ({ tab: "inbox", selected: { id: null, index: 0 } }));

export const useTicketReplyStore = create<{
  send: ((ticket: Ticket, text: string) => void) | null;
}>()(() => ({ send: null }));

export function ticketReplyMessage(environmentId: EnvironmentId, ticket: Ticket, text: string) {
  const title = (threadId: ThreadId) =>
    readThreadShell(scopeThreadRef(environmentId, threadId))?.title ?? "";
  const connection = readPreparedConnection(environmentId);
  const record = ticketContextRecord({
    ticket,
    chat: title(ticket.origin.chatId),
    session: title(ticket.origin.threadId),
    transcriptUrl: connection
      ? new URL(ticket.origin.transcriptPath, connection.httpBaseUrl).href
      : ticket.origin.transcriptPath,
  });
  return {
    text: `${formatComposerContextReference(record)}\n\n${text}`,
    context: { version: 1 as const, records: [record] },
  };
}
