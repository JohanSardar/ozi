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
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  formatComposerContextReference,
  ticketContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { connectionAtomRuntime } from "../connection/runtime";
import { resolveStorage } from "../lib/storage";
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

interface InboxState {
  tab: "inbox" | "archive";
  selected: { id: TicketId | null; index: number; reveal?: boolean };
  hidden: boolean;
}

export const useInboxStore = create<InboxState>()(
  persist((): InboxState => ({ tab: "inbox", selected: { id: null, index: 0 }, hidden: false }), {
    name: "ozi:inbox:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    partialize: ({ hidden }) => ({ hidden }),
  }),
);

const syncInboxHidden = ({ hidden }: { hidden: boolean }) =>
  document.documentElement.toggleAttribute("data-inbox-hidden", hidden);
if (typeof document !== "undefined") {
  syncInboxHidden(useInboxStore.getState());
  useInboxStore.subscribe(syncInboxHidden);
}

export const toggleInbox = () => useInboxStore.setState(({ hidden }) => ({ hidden: !hidden }));

export const useTicketReplyStore = create<{
  send: ((ticket: Ticket, text: string) => void) | null;
  pending: { ticket: Ticket; text: string } | null;
}>()(() => ({ send: null, pending: null }));

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

export const linkPreview = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:links:preview",
  tag: WS_METHODS.linksPreview,
  staleTimeMs: 60 * 60_000,
  idleTtlMs: 10 * 60_000,
});
