import { type TicketId, WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { create } from "zustand";

import { connectionAtomRuntime } from "../connection/runtime";

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
