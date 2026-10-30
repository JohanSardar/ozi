import { type ChatAttachment, isProviderSendTurnSupportedImageMimeType } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export function isProviderNativeImageAttachment(attachment: ChatAttachment): boolean {
  return (
    attachment.type === "image" && isProviderSendTurnSupportedImageMimeType(attachment.mimeType)
  );
}

export const providerMessageTextWithAttachmentPaths = Effect.fn(
  "providerMessageTextWithAttachmentPaths",
)(function* (input: {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly resolveAttachmentPath: (attachment: ChatAttachment) => string | null;
  readonly resolveExtractedTextPath?:
    | ((path: string) => Effect.Effect<string | undefined>)
    | undefined;
}) {
  let text = input.text;
  // The text-input budget must never hide the existence of an attachment.
  for (const attachment of input.attachments) {
    const path = input.resolveAttachmentPath(attachment);
    const extracted =
      path === null || !input.resolveExtractedTextPath
        ? undefined
        : yield* input.resolveExtractedTextPath(path);
    const context =
      path === null
        ? `[Attached ${attachment.type} "${attachment.name}" is unavailable: could not resolve a saved path for attachment '${attachment.id}'.]`
        : `[Attached ${attachment.type} "${attachment.name}" is saved at: ${path}${extracted ? ` (text extracted to: ${extracted})` : ""}]`;
    text = text ? `${text}\n\n${context}` : context;
  }

  return text;
});
