import {
  ChatAttachmentId,
  ChatFileAttachment,
  ChatImageAttachment,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { providerMessageTextWithAttachmentPaths } from "./attachmentPrompt.ts";

const document = ChatFileAttachment.make({
  id: ChatAttachmentId.make("file-document"),
  type: "file",
  name: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 123,
});
const image = ChatImageAttachment.make({
  id: ChatAttachmentId.make("file-image"),
  type: "image",
  name: "diagram.png",
  mimeType: "image/png",
  sizeBytes: 456,
});

const resolveAttachmentPath = (attachment: { readonly id: string; readonly name: string }) =>
  `/attachments/${attachment.id}${attachment.name.slice(attachment.name.lastIndexOf("."))}`;

describe("provider attachment prompts", () => {
  it.effect("lists extracted text only when the host resolves it", () =>
    Effect.gen(function* () {
      const path = "/attachments/report.docx";
      const file = ChatFileAttachment.make({ ...document, name: "report.docx" });
      const input = {
        text: "Review this.",
        attachments: [file],
        resolveAttachmentPath: () => path,
      };
      assert.notInclude(yield* providerMessageTextWithAttachmentPaths(input), "text extracted");
      const resolved = { ...input, resolveExtractedTextPath: () => Effect.succeed(path + ".txt") };
      assert.include(
        yield* providerMessageTextWithAttachmentPaths(resolved),
        path + " (text extracted to: " + path + ".txt)",
      );
      assert.include(
        yield* providerMessageTextWithAttachmentPaths({
          ...resolved,
          text: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
        }),
        path + ".txt",
      );
      assert.notInclude(
        yield* providerMessageTextWithAttachmentPaths({
          ...resolved,
          resolveAttachmentPath: () => null,
        }),
        "text extracted",
      );
    }),
  );
  it.effect.each([PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 20, PROVIDER_SEND_TURN_MAX_INPUT_CHARS])(
    "keeps every attachment path when the message uses %s characters",
    (length) =>
      Effect.gen(function* () {
        const input = "x".repeat(length);
        const text = yield* providerMessageTextWithAttachmentPaths({
          text: input,
          attachments: [document, image],
          resolveAttachmentPath,
        });

        assert.isTrue(text.startsWith(input));
        assert.include(text, resolveAttachmentPath(document));
        assert.include(text, resolveAttachmentPath(image));
      }),
  );

  it.effect("identifies unresolved attachments instead of silently omitting them", () =>
    Effect.gen(function* () {
      const text = yield* providerMessageTextWithAttachmentPaths({
        text: "Review these.",
        attachments: [document, image],
        resolveAttachmentPath: (attachment) =>
          attachment === image ? resolveAttachmentPath(attachment) : null,
      });

      assert.include(text, 'Attached file "spec.pdf"');
      assert.include(text, "unavailable");
      assert.include(text, document.id);
      assert.include(text, resolveAttachmentPath(image));
    }),
  );
});
