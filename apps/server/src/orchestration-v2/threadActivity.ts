import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
const toMillis = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

export function isSnoozed(
  thread: Pick<
    OrchestrationV2ThreadShell,
    "snoozedUntil" | "snoozedAt" | "latestRunCompletedAt" | "status" | "pendingRuntimeRequest"
  >,
  nowMs: number,
): boolean {
  const snoozedUntilMs = toMillis(thread.snoozedUntil);
  if (snoozedUntilMs === null || snoozedUntilMs <= nowMs) return false;
  if (thread.pendingRuntimeRequest !== null) return false;
  const snoozedAtMs = toMillis(thread.snoozedAt);
  const completedAtMs = toMillis(thread.latestRunCompletedAt);
  const wokeOnError =
    thread.status === "failed" &&
    (snoozedAtMs === null || (completedAtMs !== null && completedAtMs > snoozedAtMs));
  return !wokeOnError;
}
