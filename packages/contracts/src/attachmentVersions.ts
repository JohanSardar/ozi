import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";
import { ChatAttachment } from "./chatAttachment.ts";

export const AttachmentVersionNote = Schema.Struct({
  id: Schema.String,
  quote: Schema.String,
  comment: Schema.String,
  page: Schema.optional(Schema.Number),
});
export const AttachmentVersion = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  author: Schema.Literals(["you", "Ozi"]),
  attachment: ChatAttachment,
  notes: Schema.Array(AttachmentVersionNote),
});
export type AttachmentVersion = typeof AttachmentVersion.Type;
export type AttachmentVersionNote = typeof AttachmentVersionNote.Type;
export const AttachmentVersionsInput = Schema.Struct({
  threadId: ThreadId,
  attachment: ChatAttachment,
  action: Schema.Literals(["list", "create", "read", "restore", "send"]),
  versionId: Schema.optional(Schema.String),
  contentBase64: Schema.optional(Schema.String.check(Schema.isMaxLength(70000000))),
  notes: Schema.optional(Schema.Array(AttachmentVersionNote)),
  message: Schema.optional(Schema.String.check(Schema.isMaxLength(100000))),
});
export type AttachmentVersionsInput = typeof AttachmentVersionsInput.Type;
export const AttachmentVersionsResult = Schema.Struct({
  versions: Schema.Array(AttachmentVersion),
  contentBase64: Schema.optional(Schema.String),
});
