import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

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
