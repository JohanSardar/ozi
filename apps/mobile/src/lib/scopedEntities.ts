import { EnvironmentId, ThreadId } from "@t3tools/contracts";

export function scopedThreadKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}
