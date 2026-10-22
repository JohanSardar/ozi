import type { ChatImageAttachment } from "@t3tools/contracts";

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, "previewUrl"> {
  previewUrl: string;
  file: File;
}
