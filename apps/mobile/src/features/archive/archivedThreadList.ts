import type { ArchivedSnapshotEntry } from "@t3tools/client-runtime/state/threads";
import { scopeThreadShell, type EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentId } from "@t3tools/contracts";
import { foldSearchQuery, rankSearchItems, scoreThreadSearch } from "@t3tools/shared/paletteSearch";
export type ArchivedThreadSortOrder = "newest" | "oldest";
export interface ArchivedThreadGroup {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}
const timestamp = (thread: EnvironmentThreadShell) =>
  Date.parse(thread.archivedAt ?? thread.updatedAt) || 0;
export function buildArchivedThreadGroups(input: {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly environmentLabels: Readonly<Record<string, string>>;
  readonly environmentId: EnvironmentId | null;
  readonly searchQuery: string;
  readonly sortOrder: ArchivedThreadSortOrder;
}): ReadonlyArray<ArchivedThreadGroup> {
  const query = foldSearchQuery(input.searchQuery);
  return input.snapshots
    .filter((entry) => input.environmentId === null || entry.environmentId === input.environmentId)
    .flatMap((entry) => {
      const all = entry.snapshot.threads
        .filter((thread) => thread.archivedAt !== null)
        .map((thread) => scopeThreadShell(entry.environmentId, thread));
      const threads =
        query.length === 0 ||
        (input.environmentLabels[entry.environmentId] ?? "").toLowerCase().includes(query)
          ? all
          : rankSearchItems(all, (thread, options) =>
              scoreThreadSearch(query, threadSearchSubject(thread), 0, {
                ...options,
                picks: false,
              }),
            ).map(({ item }) => item);
      threads.sort(
        (a, b) =>
          (input.sortOrder === "newest" ? -1 : 1) * (timestamp(a) - timestamp(b)) ||
          a.title.localeCompare(b.title),
      );
      return threads.length
        ? [{ key: entry.environmentId, environmentId: entry.environmentId, threads }]
        : [];
    })
    .sort(
      (a, b) =>
        (input.sortOrder === "newest" ? -1 : 1) *
        (timestamp(a.threads[0]!) - timestamp(b.threads[0]!)),
    );
}
