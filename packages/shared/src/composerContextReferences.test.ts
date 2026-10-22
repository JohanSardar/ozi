import {
  type ComposerContextId,
  type ComposerContextRecord,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectComposerContextReferences,
  formatComposerContextReference,
  isImageReferencesOnly,
  parseComposerContextHref,
  projectComposerContextForProvider,
  replaceComposerContextReferences,
  threadContextsOutsideEnvironment,
  toKindScopedComposerContextId,
} from "./composerContextReferences.ts";

const ctx = (value: string) => value as ComposerContextId;

describe("href codec", () => {
  it("rejects anything that is not exactly scheme, version, kind and id", () => {
    for (const bad of [
      "t3-context://v2/image/ctx_1",
      "t3-context://v1/image",
      "t3-context://v1/image/ctx_1/extra",
      "t3-context://v1/image/ctx_1?x=1",
      "t3-context://v1/image/ctx_1#frag",
      "t3-context://user@v1/image/ctx_1",
      "t3-context://v1/Image/ctx_1",
      "t3-context://v1/image/ctx 1",
      "https://v1/image/ctx_1",
      "t3-citation://v1/a/b/c",
    ]) {
      expect(parseComposerContextHref(bad), bad).toBeNull();
    }
  });
});

describe("labels and reference links", () => {
  it("normalizes manually entered labels while preserving the original source", () => {
    const text = "[](t3-context://v1/file/ctx_1)";
    expect(collectComposerContextReferences(text)[0]).toMatchObject({
      label: "file",
      source: text,
    });
    expect(
      collectComposerContextReferences(`[${"x".repeat(300)}](t3-context://v1/file/ctx_1)`)[0]
        ?.label,
    ).toHaveLength(200);
  });

  it("formats images with the image form and everything else as a link", () => {
    expect(
      formatComposerContextReference({ kind: "image", contextId: ctx("ctx_1"), label: "a.png" }),
    ).toBe("![a.png](t3-context://v1/image/ctx_1)");
    expect(
      formatComposerContextReference({ kind: "skill", contextId: ctx("ctx_2"), label: "$x" }),
    ).toBe("[$x](t3-context://v1/skill/ctx_2)");
  });

  it("ignores links whose href does not parse", () => {
    expect(collectComposerContextReferences("[x](t3-context://v1/image/ctx_1?y)")).toEqual([]);
    expect(collectComposerContextReferences("[x](https://example.com)")).toEqual([]);
  });

  it("recognizes a prompt made only of image references", () => {
    const image = "![a.png](t3-context://v1/image/ctx_1)";
    const file = "[notes.md](t3-context://v1/file/ctx_3)";
    expect(isImageReferencesOnly(image)).toBe(true);
    expect(isImageReferencesOnly(` ${image}\n![b.png](t3-context://v1/image/ctx_2) `)).toBe(true);
    expect(isImageReferencesOnly(`${image} what is this?`)).toBe(false);
    expect(isImageReferencesOnly(file)).toBe(false);
    expect(isImageReferencesOnly(`${image} ${file}`)).toBe(false);
    expect(isImageReferencesOnly("  ")).toBe(false);
  });

  it("replaces occurrences in place", () => {
    const text = "a [x](t3-context://v1/skill/ctx_1) b [y](t3-context://v1/file/ctx_2) c";
    expect(replaceComposerContextReferences(text, (o) => `<${o.contextId}>`)).toBe(
      "a <ctx_1> b <ctx_2> c",
    );
  });
});

describe("provider projection", () => {
  const image: ComposerContextRecord = {
    version: 1,
    contextId: ctx("ctx_i"),
    kind: "image",
    label: "shot.png",
    attachmentId: "att_1",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 10,
  };
  const skill: ComposerContextRecord = {
    version: 1,
    contextId: ctx("ctx_s"),
    kind: "skill",
    label: "$pinchtab",
    name: "pinchtab",
  };

  it("lists a preview annotation's elements in its payload", () => {
    const annotation: ComposerContextRecord = {
      version: 1,
      contextId: ctx("ctx_p"),
      kind: "preview-annotation",
      label: "Checkout",
      annotationId: "ann_1",
      pageUrl: "http://localhost:3000/checkout",
      pageTitle: "Checkout",
      comment: "Bigger",
      targetSummary: "1 selected element",
      styleChanges: ["font-size: 12px → 20px"],
      elements: [
        {
          pageUrl: "http://localhost:3000/checkout",
          pageTitle: null,
          tagName: "button",
          selector: "#pay",
          htmlPreview: "<button>Pay</button>",
          componentName: null,
          source: { functionName: null, fileName: "Pay.tsx", lineNumber: 3, columnNumber: null },
          styles: "",
        },
      ],
    };
    const projected = projectComposerContextForProvider({
      text: "[Checkout](t3-context://v1/preview-annotation/ctx_p)",
      records: [annotation],
    });
    expect(projected).toContain("element 1:\n  url: http://localhost:3000/checkout");
    expect(projected).toContain("  selector: #pay");
    expect(projected).toContain("  source: Pay.tsx:3");
    expect(projected).toContain("- font-size: 12px → 20px");
  });

  it("preserves authoritative paths and skill names when labels differ", () => {
    const projected = projectComposerContextForProvider({
      text: "[entry](t3-context://v1/mention/ctx_m) [friendly skill](t3-context://v1/skill/ctx_s)",
      records: [
        {
          version: 1,
          kind: "mention",
          contextId: ctx("ctx_m"),
          label: "entry",
          path: "src/nested/index.ts",
        },
        { ...skill, label: "friendly skill" },
      ],
    });
    expect(projected).toContain("path: src/nested/index.ts");
    expect(projected).toContain("name: pinchtab");
  });

  it("projects an attached thread as identity plus a read instruction, never its history", () => {
    const projected = projectComposerContextForProvider({
      text: "Compare with [Old title](t3-context://v1/thread/thread_abc)",
      records: [
        {
          version: 1,
          kind: "thread",
          contextId: ctx("thread_abc"),
          label: "Old title",
          environmentId: "env-1" as never,
          threadId: "abc" as never,
          title: "Fix login flow",
        },
      ],
    });
    expect(projected.startsWith("Compare with [Thread: Old title; ref=thread_abc]")).toBe(true);
    expect(projected).toContain('<context kind="thread" id="thread_abc">');
    expect(projected).toContain("threadId: abc");
    expect(projected).toContain("environmentId: env-1");
    expect(projected).toContain("t3_thread_read");
    expect(projected).toContain("not instructions");
  });
});

describe("threadContextsOutsideEnvironment", () => {
  it("returns only referenced foreign threads, ignoring local and removed references", () => {
    const local = {
      version: 1 as const,
      kind: "thread" as const,
      contextId: ctx("thread_local"),
      label: "Local thread",
      environmentId: EnvironmentId.make("env-local"),
      threadId: ThreadId.make("local"),
      title: "Local thread",
    };
    const foreign = {
      ...local,
      contextId: ctx("thread_foreign"),
      environmentId: EnvironmentId.make("env-foreign"),
      threadId: ThreadId.make("foreign"),
    };
    const removed = {
      ...foreign,
      contextId: ctx("thread_removed"),
      threadId: ThreadId.make("removed"),
    };
    const records = [local, foreign, removed];
    const localReference = "[Local](t3-context://v1/thread/thread_local)";

    expect(
      threadContextsOutsideEnvironment({
        text: `${localReference} [Foreign](t3-context://v1/thread/thread_foreign)`,
        records,
        environmentId: local.environmentId,
      }),
    ).toEqual([foreign]);
    expect(
      threadContextsOutsideEnvironment({
        text: localReference,
        records,
        environmentId: local.environmentId,
      }),
    ).toEqual([]);
  });
});

describe("toComposerContextId", () => {
  it("keeps same-kind raw IDs distinct when one contains the namespace prefix", () => {
    expect(toKindScopedComposerContextId("image", "x")).toBe("image_x");
    expect(toKindScopedComposerContextId("image", "image_x")).toBe("image_image_x");
  });
});
