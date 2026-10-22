import {
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import { EMPTY_V2_ITEM_SUPPORT, resolveV2ItemSupport, v2ItemSupportEqual } from "./itemSupport.ts";

const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const runId = RunId.make("run-1");
const nodeId = NodeId.make("node-1");
const itemId = TurnItemId.make("item-1");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const providerTurnId = ProviderTurnId.make("provider-turn-1");

const commandItem: OrchestrationV2TurnItem = {
  id: itemId,
  threadId: v2ThreadId,
  runId,
  nodeId,
  providerThreadId,
  providerTurnId,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "running",
  title: null,
  startedAt: now,
  completedAt: null,
  updatedAt: now,
  type: "command_execution",
  input: "vp check",
};

describe("resolveV2ItemSupport", () => {
  it("resolves synthetic items from the authoritative visible sequence", () => {
    const projection = {
      ...v2Projection,
      visibleTurnItems: [
        {
          position: 0,
          visibility: "synthetic" as const,
          sourceThreadId: v2ThreadId,
          sourceItemId: itemId,
          item: commandItem,
        },
      ],
    };
    expect(resolveV2ItemSupport(projection, itemId).item).toBe(commandItem);
  });

  it("returns the stable empty support for unknown items", () => {
    expect(resolveV2ItemSupport(v2Projection, itemId)).toBe(EMPTY_V2_ITEM_SUPPORT);
  });

  it("compares support structurally while retaining entity identity semantics", () => {
    expect(v2ItemSupportEqual(EMPTY_V2_ITEM_SUPPORT, { ...EMPTY_V2_ITEM_SUPPORT })).toBe(true);
    expect(
      v2ItemSupportEqual(EMPTY_V2_ITEM_SUPPORT, {
        ...EMPTY_V2_ITEM_SUPPORT,
        attempts: [{ id: "attempt" } as never],
      }),
    ).toBe(false);
  });
});
