import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { toJsonSchemaObject } from "./textGenerationUtils.ts";

describe("buildThreadTitlePrompt", () => {
  it("requires each generated field in the strict response schema", () => {
    const { outputSchema } = buildThreadTitlePrompt({ message: "Fix this" });
    expect(toJsonSchemaObject(outputSchema)).toMatchObject({
      required: ["title", "needsRefinement"],
      properties: { title: { type: "string" }, needsRefinement: { type: "boolean" } },
    });
  });

  it("includes the user message without absent attachment metadata", () => {
    const result = buildThreadTitlePrompt({
      message: "Investigate reconnect regressions after session restore",
    });

    expect(result.prompt).toContain("User message:");
    expect(result.prompt).toContain("Investigate reconnect regressions after session restore");
    expect(result.prompt).not.toContain("Attachment metadata:");
  });

  it("includes attachment metadata when attachments are provided", () => {
    const result = buildThreadTitlePrompt({
      message: "Name this thread from the screenshot",
      attachments: [
        {
          type: "image" as const,
          id: "att-456",
          name: "thread.png",
          mimeType: "image/png",
          sizeBytes: 67890,
        },
      ],
    });

    expect(result.prompt).toContain("Attachment metadata:");
    expect(result.prompt).toContain("thread.png");
    expect(result.prompt).toContain("image/png");
    expect(result.prompt).toContain("67890 bytes");
  });

  it("regenerates from recent thread contents and identifies the previous title", () => {
    const result = buildThreadTitlePrompt({
      message: `USER:\nInvestigate reconnect regressions\n\nASSISTANT:\nThe remaining issue is stale session state`,
      previousTitle: "Investigate reconnect regressions",
    });

    expect(result.prompt).toContain(
      "Regenerate the title for an existing T3 Code thread so the user can recognize it weeks later.",
    );
    expect(result.prompt).toContain('The previous title was "Investigate reconnect regressions".');
    expect(result.prompt).toContain("Thread contents:");
    expect(result.prompt).toContain("The remaining issue is stale session state");
  });

  it("keeps the latest thread contents when regeneration context is truncated", () => {
    const result = buildThreadTitlePrompt({
      message: `${"old context ".repeat(1_000)}\n\nASSISTANT:\nCurrent thread state`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain("[Earlier content truncated]");
    expect(result.prompt).toContain("Current thread state");
    expect(result.prompt).not.toContain("[truncated]");
  });

  it("does not truncate an already-marked regeneration context twice", () => {
    const retainedContext = "x".repeat(7_998);
    const result = buildThreadTitlePrompt({
      message: `[Earlier content truncated]\n\n${retainedContext}`,
      previousTitle: "Old title",
    });

    expect(result.prompt).toContain(
      `Thread contents:\n[Earlier content truncated]\n\n${retainedContext}`,
    );
    expect(result.prompt.match(/\[Earlier content truncated\]/g)).toHaveLength(1);
  });
});
