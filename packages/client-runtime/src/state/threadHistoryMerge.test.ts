import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { v2Projection, v2ThreadId } from "./orchestrationV2TestFixtures.ts";
import {
  applyHistoryPageMeta,
  clearActiveHistoryLoading,
  isActiveHistoryRequestCursor,
  mergeOlderHistoryIntoProjection,
  shouldShowLoadEarlierControl,
} from "./threadHistoryMerge.ts";
import { applyOrchestrationV2ProjectionEvent } from "./orchestrationV2Projection.ts";

const NOW = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");

function row(index: number): OrchestrationV2ProjectedTurnItem {
  const id = `item-${index}` as never;
  return {
    position: index,
    visibility: "local",
    sourceThreadId: v2ThreadId,
    sourceItemId: id,
    item: {
      id,
      type: "command_execution",
      threadId: v2ThreadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: index + 1,
      status: "completed",
      title: `Command ${index}`,
      input: `cmd-${index}`,
      output: `out-${index}`,
      exitCode: 0,
      startedAt: NOW,
      completedAt: NOW,
      updatedAt: NOW,
    },
  };
}

describe("threadHistoryMerge", () => {
  it("fills activity around partial messages in canonical order and preserves live edits", () => {
    const initial = { ...v2Projection, turnItems: [row(4).item], visibleTurnItems: [row(4)] };
    const preview = [row(1), row(3)];
    const partial = mergeOlderHistoryIntoProjection(initial, preview);
    const updated = { ...row(1), item: { ...row(1).item, title: "newer live title" } };
    const live = {
      ...partial,
      visibleTurnItems: partial.visibleTurnItems.map((entry) =>
        entry.sourceItemId === updated.sourceItemId ? updated : entry,
      ),
      turnItems: partial.turnItems.map((item) =>
        item.id === updated.item.id ? updated.item : item,
      ),
    };
    const complete = mergeOlderHistoryIntoProjection(live, [row(0), row(1), row(2), row(3)]);
    expect(complete.visibleTurnItems.map((entry) => entry.sourceItemId)).toEqual([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
    expect(complete.visibleTurnItems[1]?.item).toBe(updated.item);
    expect(complete.visibleTurnItems.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(complete.turnItems.map((item) => item.id)).size).toBe(5);
    const hidden = {
      ...partial,
      visibleTurnItems: partial.visibleTurnItems.filter(
        (entry) => entry.sourceItemId !== preview[0]!.sourceItemId,
      ),
    };
    const hiddenComplete = mergeOlderHistoryIntoProjection(hidden, [
      row(0),
      row(1),
      row(2),
      row(3),
    ]);
    expect(hiddenComplete.visibleTurnItems.map((entry) => entry.sourceItemId)).toEqual([
      "item-0",
      "item-2",
      "item-3",
      "item-4",
    ]);
  });

  it("prepends older rows and dedupes by source identity", () => {
    const recent = [row(2), row(3)];
    const projection = {
      ...v2Projection,
      turnItems: recent.map((entry) => entry.item),
      visibleTurnItems: recent.map((entry, position) => ({ ...entry, position })),
    };
    const older = [row(0), row(1), row(2)];
    const merged = mergeOlderHistoryIntoProjection(projection, older);
    expect(merged.visibleTurnItems.map((entry) => entry.sourceItemId)).toEqual([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
    ]);
    expect(merged.visibleTurnItems.map((entry) => entry.position)).toEqual([0, 1, 2, 3]);
    expect(merged.turnItems.map((item) => item.id)).toEqual([
      "item-2",
      "item-3",
      "item-0",
      "item-1",
    ]);
  });

  it("fills inherited activity without confusing identical item IDs from different source threads", () => {
    const inherited = (index: number) => ({
      ...row(index),
      visibility: "inherited" as const,
      sourceThreadId: "fork-source" as never,
    });
    const local = row(1);
    const preview = { ...inherited(1), item: { ...row(1).item, title: "newer inherited title" } };
    const projection = {
      ...v2Projection,
      turnItems: [local.item],
      visibleTurnItems: [preview, local],
    };
    const merged = mergeOlderHistoryIntoProjection(projection, [inherited(0), inherited(1)]);
    expect(
      merged.visibleTurnItems.map((entry) => [entry.sourceThreadId, entry.sourceItemId]),
    ).toEqual([
      ["fork-source", "item-0"],
      ["fork-source", "item-1"],
      [v2ThreadId, "item-1"],
    ]);
    expect(merged.visibleTurnItems[1]?.item).toBe(preview.item);
    expect(merged.turnItems).toEqual([local.item]);
    expect(mergeOlderHistoryIntoProjection(merged, [inherited(0), inherited(1)])).toBe(merged);
  });

  it("retains live rows that arrived after the older page was fetched", () => {
    const live = [row(5), row(6)];
    const projection = {
      ...v2Projection,
      turnItems: live.map((entry) => entry.item),
      visibleTurnItems: live.map((entry, position) => ({ ...entry, position })),
    };
    const older = [row(3), row(4)];
    const merged = mergeOlderHistoryIntoProjection(projection, older);
    expect(merged.visibleTurnItems.map((entry) => entry.sourceItemId)).toEqual([
      "item-3",
      "item-4",
      "item-5",
      "item-6",
    ]);
  });

  it("does not resurrect a local item hidden while an older page was in flight", () => {
    const stalePageRow = row(1);
    const currentItem = {
      ...stalePageRow.item,
      output: "newer live output",
      updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:01.000Z"),
    };
    const projection = {
      ...v2Projection,
      turnItems: [currentItem],
      visibleTurnItems: [],
    };

    const merged = mergeOlderHistoryIntoProjection(projection, [stalePageRow]);

    expect(merged).toBe(projection);
    expect(merged.turnItems).toEqual([currentItem]);
    expect(merged.visibleTurnItems).toEqual([]);
  });

  it("marks history expanded after a successful page", () => {
    const next = applyHistoryPageMeta(
      {
        historyCursor: "cursor-a",
        hasMoreHistory: true,
        loading: true,
        error: null,
        expanded: false,
        latestLocalTurnOrdinal: 42,
      },
      { nextCursor: "cursor-b", hasMoreHistory: true },
    );
    expect(next).toEqual({
      historyCursor: "cursor-b",
      hasMoreHistory: true,
      loading: false,
      error: null,
      expanded: true,
      latestLocalTurnOrdinal: 42,
    });
  });

  it("only applies history responses for the active request cursor", () => {
    expect(isActiveHistoryRequestCursor("cursor-a", { historyCursor: "cursor-a" })).toBe(true);
    expect(isActiveHistoryRequestCursor("cursor-a", { historyCursor: "cursor-b" })).toBe(false);
    expect(isActiveHistoryRequestCursor("cursor-a", { historyCursor: null })).toBe(false);
  });

  it("clears loading on interrupt only for the active request cursor", () => {
    const loading = {
      historyCursor: "cursor-a",
      hasMoreHistory: true,
      loading: true,
      error: null,
      expanded: false,
      latestLocalTurnOrdinal: 10,
    };
    expect(clearActiveHistoryLoading("cursor-a", loading)).toEqual({
      ...loading,
      loading: false,
    });
    expect(
      clearActiveHistoryLoading("cursor-a", { ...loading, historyCursor: "cursor-b" }),
    ).toEqual({ ...loading, historyCursor: "cursor-b" });
    const idle = { ...loading, loading: false };
    expect(clearActiveHistoryLoading("cursor-a", idle)).toBe(idle);
  });

  it("shows the load-earlier control when history remains or a local error is set", () => {
    expect(
      shouldShowLoadEarlierControl({
        historyCursor: "c",
        hasMoreHistory: true,
        loading: false,
        error: null,
        expanded: false,
        latestLocalTurnOrdinal: null,
      }),
    ).toBe(true);
    expect(
      shouldShowLoadEarlierControl({
        historyCursor: null,
        hasMoreHistory: false,
        loading: false,
        error: "Could not load earlier activity.",
        expanded: true,
        latestLocalTurnOrdinal: null,
      }),
    ).toBe(true);
    expect(
      shouldShowLoadEarlierControl({
        historyCursor: null,
        hasMoreHistory: false,
        loading: false,
        error: null,
        expanded: false,
        latestLocalTurnOrdinal: null,
      }),
    ).toBe(false);
  });

  it("retains merged older rows when a live turn-item update arrives", () => {
    const recent = [row(2), row(3)];
    const projection = {
      ...v2Projection,
      turnItems: recent.map((entry) => entry.item),
      visibleTurnItems: recent.map((entry, position) => ({ ...entry, position })),
    };
    const merged = mergeOlderHistoryIntoProjection(projection, [row(0), row(1)]);
    const liveItem = {
      ...row(3).item,
      output: "streamed",
    };
    const next = applyOrchestrationV2ProjectionEvent(merged, {
      id: "event-live-item" as never,
      type: "turn-item.updated",
      threadId: v2ThreadId,
      occurredAt: NOW,
      payload: liveItem,
    } as never);
    expect(next?.visibleTurnItems.map((entry) => entry.sourceItemId)).toEqual([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
    ]);
    expect(next?.visibleTurnItems[3]?.item).toEqual(liveItem);
  });
});
