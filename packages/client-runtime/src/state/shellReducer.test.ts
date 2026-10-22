import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { v2Project, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { applyShellStreamEvent, reuseUnchangedThreadShells } from "./shellReducer.ts";

describe("applyShellStreamEvent", () => {
  it("updates a thread in place without moving its siblings", () => {
    const threads = ["a", "b", "c"].map((id) => ({ ...v2ThreadShell, id: ThreadId.make(id) }));
    const updated = { ...threads[1]!, title: "Streaming" };
    const next = applyShellStreamEvent(
      { ...v2ShellSnapshot, threads },
      {
        kind: "thread.updated",
        sequence: 1,
        location: "active",
        thread: updated,
      },
    );
    expect(next.threads.map((thread) => thread.id)).toEqual(["a", "b", "c"]);
    expect(next.threads[0]).toBe(threads[0]);
    expect(next.threads[1]).toBe(updated);
    expect(next.threads[2]).toBe(threads[2]);
  });

  it("keeps the thread list and object when an update changes nothing", () => {
    const threads = ["a", "b"].map((id) => ({ ...v2ThreadShell, id: ThreadId.make(id) }));
    const next = applyShellStreamEvent(
      { ...v2ShellSnapshot, threads },
      {
        kind: "thread.updated",
        sequence: 1,
        location: "active",
        thread: { ...threads[1]! },
      },
    );
    expect(next.threads).toBe(threads);
    expect(next.snapshotSequence).toBe(1);
  });

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

  it("applies project updates and removals", () => {
    const updated = applyShellStreamEvent(v2ShellSnapshot, {
      kind: "project.updated",
      sequence: 1,
      project: { ...v2Project, title: "Updated" },
    });
    expect(updated.projects[0]?.title).toBe("Updated");
    expect(updated.snapshotSequence).toBe(1);

    const removed = applyShellStreamEvent(updated, {
      kind: "project.removed",
      sequence: 2,
      projectId: ProjectId.make(v2Project.id),
    });
    expect(removed.projects).toEqual([]);
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

  it("removes a thread from either collection", () => {
    const next = applyShellStreamEvent(v2ShellSnapshot, {
      kind: "thread.removed",
      sequence: 5,
      location: "active",
      threadId: ThreadId.make(v2ThreadShell.id),
    });
    expect(next.threads).toEqual([]);
    expect(next.snapshotSequence).toBe(5);
  });

  it("leaves unknown future events unchanged", () => {
    const next = applyShellStreamEvent(v2ShellSnapshot, {
      kind: "future.event",
      sequence: 99,
    } as never);

    expect(next).toBe(v2ShellSnapshot);
  });
});

describe("reuseUnchangedThreadShells", () => {
  const other = { ...v2ThreadShell, id: ThreadId.make("thread-other"), title: "Other" };

  it("returns the incoming snapshot when no row is unchanged", () => {
    const incoming = { ...v2ShellSnapshot, threads: [{ ...other, title: "Renamed" }] };
    expect(reuseUnchangedThreadShells({ ...v2ShellSnapshot, threads: [other] }, incoming)).toBe(
      incoming,
    );
  });
});
