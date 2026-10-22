import { ORCHESTRATION_V2_WS_METHODS, ThreadId, WS_METHODS } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { featureUsage } from "./FeatureUsage.ts";

const dispatch = ORCHESTRATION_V2_WS_METHODS.dispatchCommand;
const threadId = ThreadId.make("thread-private");
