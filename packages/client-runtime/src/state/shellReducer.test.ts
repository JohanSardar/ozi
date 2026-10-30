import { describe, expect, it } from "vite-plus/test";

import { v2Project, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { applyShellStreamEvent } from "./shellReducer.ts";

describe("applyShellStreamEvent", () => {
  it("ignores stale project updates without mutating the snapshot", () => {
    const snapshotWithProject = {
      ...v2ShellSnapshot,
      snapshotSequence: 4,
      projects: [v2Project],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project.updated",
        sequence,
        project: { ...v2Project, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe(v2Project.title);
    }
  });

  it("keeps archive deltas out of the normal shell cache", () => {
    const archived = applyShellStreamEvent(v2ShellSnapshot, {
      kind: "thread.updated",
      sequence: 3,
      location: "archive",
      thread: { ...v2ThreadShell, archivedAt: v2ThreadShell.updatedAt },
    });
    expect(archived.threads).toEqual([]);
    expect(archived.archivedThreads).toEqual([]);

    const active = applyShellStreamEvent(archived, {
      kind: "thread.updated",
      sequence: 4,
      location: "active",
      thread: v2ThreadShell,
    });
    expect(active.threads).toHaveLength(1);
    expect(active.archivedThreads).toEqual([]);
  });

  it("leaves unknown future events unchanged", () => {
    const next = applyShellStreamEvent(v2ShellSnapshot, {
      kind: "future.event",
      sequence: 99,
    } as never);

    expect(next).toBe(v2ShellSnapshot);
  });
});
