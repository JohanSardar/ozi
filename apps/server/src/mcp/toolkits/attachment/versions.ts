import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { MessageId, OrchestratorMcpFailure } from "@t3tools/contracts";
import { AttachmentVersion, type AttachmentVersionsInput } from "@t3tools/contracts";
import { newCommandId } from "../../threadAccess.ts";
import { ServerConfig } from "../../../config.ts";
import {
  resolveAttachmentPathById,
  attachmentFileExtension,
  toSafeThreadAttachmentSegment,
  parseAttachmentUuid,
} from "../../../attachmentStore.ts";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";

export const attachmentVersions = Effect.fn("attachment.versions")(function* (
  input: AttachmentVersionsInput,
  author: "you" | "Ozi",
) {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;
  const original = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId: input.attachment.id,
  });
  if (!parseAttachmentUuid(input.attachment.id))
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Invalid attachment.",
    });
  const root = NodePath.join(config.attachmentsDir, "versions", input.attachment.id);
  yield* fs.makeDirectory(root, { recursive: true });
  const decodeVersion = Schema.decodeEffect(Schema.fromJsonString(AttachmentVersion));
  const files = yield* fs.readDirectory(root);
  const versions = (yield* Effect.forEach(
    files.filter((name) => name.endsWith(".json")),
    (name) => fs.readFileString(NodePath.join(root, name)).pipe(Effect.flatMap(decodeVersion)),
  )).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (versions.length === 0) {
    if (!original)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Attachment not found.",
      });
    yield* fs.copyFile(original, NodePath.join(root, "original.bin"));
    const first: AttachmentVersion = {
      id: "original",
      createdAt: new Date().toISOString(),
      author: "Ozi",
      attachment: input.attachment,
      notes: [],
    };
    yield* fs
      .writeFileString(NodePath.join(root, "original.json"), JSON.stringify(first), { flag: "wx" })
      .pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
    versions.push(first);
  }
  const selected = input.versionId
    ? versions.find((version) => version.id === input.versionId)
    : versions.at(-1);
  if (!selected)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Version not found.",
    });
  const snapshot = NodePath.join(root, `${selected.id}.bin`);
  const source = (yield* fs.exists(snapshot))
    ? snapshot
    : resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: selected.attachment.id,
      });
  if (!source)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Version file not found.",
    });
  if (input.action === "create" || input.action === "restore") {
    const bytes =
      input.action === "create" && input.contentBase64 !== undefined
        ? NodeBuffer.Buffer.from(input.contentBase64, "base64")
        : yield* fs.readFile(source);
    if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024)
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "File must be between 1 byte and 50 MB.",
      });
    const id = NodeCrypto.randomUUID();
    const extension = attachmentFileExtension(input.attachment.name);
    const attachmentId = `${toSafeThreadAttachmentSegment(input.threadId)}-${id}-${extension.slice(1)}`;
    yield* fs.writeFile(NodePath.join(root, `${id}.bin`), bytes, { flag: "wx" });
    yield* fs.writeFile(
      NodePath.join(config.attachmentsDir, `${attachmentId}${extension}`),
      bytes,
      { flag: "wx" },
    );
    const version: AttachmentVersion = {
      id,
      createdAt: new Date().toISOString(),
      author,
      attachment: { ...input.attachment, id: attachmentId, sizeBytes: bytes.length },
      notes: input.notes ?? selected.notes,
    };
    yield* fs.writeFileString(NodePath.join(root, `${id}.json`), JSON.stringify(version), {
      flag: "wx",
    });
    versions.push(version);
  }
  if (input.action === "send") {
    const livePath = NodePath.join(
      config.attachmentsDir,
      `${selected.attachment.id}${attachmentFileExtension(selected.attachment.name)}`,
    );
    if (!(yield* fs.exists(livePath))) yield* fs.copyFile(source, livePath);
    const command = yield* newCommandId();
    yield* ThreadMessageIntake.sendToThread({
      threadId: input.threadId,
      commandId: command,
      messageId: MessageId.make(command),
      text: `${input.message ?? ""}\n\nFile: ${input.attachment.name}\nAttachment: ${input.attachment.id}\nVersion: ${selected.id}\n${(input.notes ?? selected.notes).map((note) => `> ${note.quote}\n${note.comment}`).NodePath.join("\n\n")}`,
      attachments: [selected.attachment],
      mode: "auto",
      createdBy: "user",
      creationSource: "web",
    });
  }
  return {
    sourcePath: source,
    versions,
    ...(input.action === "read"
      ? { contentBase64: NodeBuffer.Buffer.from(yield* fs.readFile(source)).toString("base64") }
      : {}),
  };
});

export const importAttachment = Effect.fn("attachment.import")(function* (input: {
  threadId: string;
  name: string;
  mimeType: string;
  contentBase64: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig;
  const bytes = NodeBuffer.Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > 50 * 1024 * 1024)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "File must be between 1 byte and 50 MB.",
    });
  const extension = attachmentFileExtension(input.name);
  const id = `${toSafeThreadAttachmentSegment(input.threadId)}-${NodeCrypto.randomUUID()}-${extension.slice(1)}`;
  yield* fs.writeFile(NodePath.join(config.attachmentsDir, `${id}${extension}`), bytes, {
    flag: "wx",
  });
  return {
    type: "file" as const,
    id,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: bytes.length,
  };
});
