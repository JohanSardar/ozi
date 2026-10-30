import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { threadContextAttachment } from "./threadContextAttachment";

describe("threadContextAttachment", () => {
  it("keeps filenames stable per snapshot and distinct across environments and updates", () => {
    const transcript = {
      threadId: ThreadId.make("same-thread"),
      title: "Same / title: notes",
      updatedAt: DateTime.makeUnsafe("2026-09-29T00:00:00.000Z"),
      items: [],
    };
    const source = EnvironmentId.make("source/with:unsafe characters");
    const first = threadContextAttachment(source, transcript);
    expect(threadContextAttachment(source, transcript).name).toBe(first.name);
    expect(threadContextAttachment(EnvironmentId.make("other"), transcript).name).not.toBe(
      first.name,
    );
    expect(
      threadContextAttachment(source, {
        ...transcript,
        updatedAt: DateTime.add(transcript.updatedAt, { seconds: 1 }),
      }).name,
    ).not.toBe(first.name);
    expect(first.name).toMatch(/^Same _ title_ notes-[a-f0-9]+\.jsonl$/);
    expect(first.name.length).toBeLessThan(255);
  });
});
