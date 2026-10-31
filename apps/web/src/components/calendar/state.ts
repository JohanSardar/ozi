import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";

export const calendarList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "calendar:list",
  tag: WS_METHODS.calendarList,
  staleTimeMs: 0,
  idleTtlMs: 0,
});
export const calendarAdd = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "calendar:add",
  tag: WS_METHODS.calendarAdd,
});
