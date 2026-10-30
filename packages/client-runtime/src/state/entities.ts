import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export class InvalidScopedThreadKeyError extends Schema.TaggedError<InvalidScopedThreadKeyError>()(
  "InvalidScopedThreadKeyError",
  {
    key: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid scoped thread atom key: ${JSON.stringify(this.key)}.`;
  }
}

export function threadKey(ref: ScopedThreadRef): string {
  return `${ref.environmentId}\u0000${ref.threadId}`;
}

export function parseThreadKey(key: string): ScopedThreadRef {
  const separator = key.indexOf("\u0000");
  if (separator < 0) {
    throw new InvalidScopedThreadKeyError({ key });
  }
  return {
    environmentId: EnvironmentId.make(key.slice(0, separator)),
    threadId: ThreadId.make(key.slice(separator + 1)),
  };
}

export function threadRefsEqual(
  left: ReadonlyArray<ScopedThreadRef>,
  right: ReadonlyArray<ScopedThreadRef>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (ref, index) =>
        ref.environmentId === right[index]?.environmentId &&
        ref.threadId === right[index]?.threadId,
    )
  );
}

export function arrayElementsEqual<A>(left: ReadonlyArray<A>, right: ReadonlyArray<A>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
