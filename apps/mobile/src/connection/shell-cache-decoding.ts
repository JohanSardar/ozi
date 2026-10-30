import { StoredOrchestrationShellSnapshot } from "@t3tools/client-runtime/platform";
import * as Schema from "effect/Schema";

export const decodeStoredShellSnapshot = Schema.decodeUnknownEffect(
  Schema.fromJsonString(StoredOrchestrationShellSnapshot),
);
