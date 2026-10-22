import { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const decodeShellSnapshot = Schema.decodeUnknownEffect(
  Schema.toCodecJson(OrchestrationV2ShellSnapshot),
);
