import {
  OrchestrationV2ThreadShell,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const sameThreadShell = Schema.toEquivalence(OrchestrationV2ThreadShell);

/**
 * Links are compared apart from the rest of the row because a deferred snapshot arrives without
 * them; such a row keeps its links until they fill in.
 */
export function reuseUnchangedThreadShells(
  previous: OrchestrationV2ShellSnapshot | null,
  next: OrchestrationV2ShellSnapshot,
): OrchestrationV2ShellSnapshot {
  if (previous === null || previous.threads.length === 0) return next;
  const previousById = new Map(previous.threads.map((thread) => [thread.id, thread]));
  const threads = next.threads.map((thread) => {
    const prior = previousById.get(thread.id);
    return prior !== undefined && sameThreadShell(prior, thread) ? prior : thread;
  });
  return threads.every((thread, index) => thread === next.threads[index])
    ? next
    : { ...next, threads };
}

function upsertById<T extends { readonly id: unknown }>(
  items: ReadonlyArray<T>,
  item: T,
): ReadonlyArray<T> {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return items.map((candidate, candidateIndex) => (candidateIndex === index ? item : candidate));
}

export function applyShellStreamEvent(
  snapshot: OrchestrationV2ShellSnapshot,
  event: Exclude<
    OrchestrationV2ShellStreamItem,
    { readonly kind: "snapshot" } | { readonly kind: "synchronized" }
  >,
): OrchestrationV2ShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "thread.updated": {
      const existing =
        event.location === "active"
          ? snapshot.threads.find((thread) => thread.id === event.thread.id)
          : undefined;
      if (existing !== undefined && sameThreadShell(existing, event.thread)) {
        return { ...snapshot, snapshotSequence: event.sequence };
      }
      const withoutThread = (threads: OrchestrationV2ShellSnapshot["threads"]) =>
        threads.filter((thread) => thread.id !== event.thread.id);
      return {
        ...snapshot,
        threads:
          event.location === "active"
            ? upsertById(snapshot.threads, event.thread)
            : withoutThread(snapshot.threads),
        // The archive has its own bounded query/subscription. Older servers may
        // still send archive-located deltas here; remove them from the normal
        // shell instead of growing its persisted cache again.
        archivedThreads: withoutThread(snapshot.archivedThreads),
        snapshotSequence: event.sequence,
      };
    }
    case "thread.removed":
      return {
        ...snapshot,
        threads: snapshot.threads.filter((thread) => thread.id !== event.threadId),
        archivedThreads: snapshot.archivedThreads.filter((thread) => thread.id !== event.threadId),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
