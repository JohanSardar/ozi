import { ChatFileAttachment } from "@t3tools/contracts";
import { AttachmentVersionsInput, AttachmentVersionsResult } from "@t3tools/contracts";
import { McpAttachmentInput } from "./input.ts";
import {
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  MessageId,
  RunId,
  ThreadId,
  OrchestrationV2RunStatus,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerConfig.ServerConfig,
    ServerSecretStore.ServerSecretStore,
    FileSystem.FileSystem,
    Path.Path,
    Crypto.Crypto,
  ],
};
const AttachmentUploadTool = Tool.make("ozi_attachment_prepare_upload", {
  ...shared,
  description:
    "For a new chat message, get an upload URL. For ticket files use ozi_attachment_import instead. POST the file's exact bytes to `relativeUrl` on this MCP server's HTTP origin, then send via `ozi_thread_send_attachments` with the returned `attachmentId`.",
  parameters: Schema.Struct({ upload: AttachmentCreateUploadUrlInput }),
  success: AttachmentCreateUploadUrlResult,
}).annotate(Tool.Destructive, true);
const AttachmentDiscardTool = Tool.make("ozi_attachment_discard", {
  ...shared,
  description: "Discard a pending upload (not a sent attachment).",
  parameters: AttachmentDeleteInput,
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
const AttachmentSendTool = Tool.make("ozi_thread_send_attachments", {
  ...shared,
  dependencies: [...shared.dependencies, DocumentText.DocumentText],
  description:
    "Send uploaded attachments as a new message to a thread. No retry key. Target modes cannot exceed yours. Success does not mean the provider read them or finished.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(120000))),
    attachments: Schema.Array(McpAttachmentInput).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    messageId: MessageId,
    runId: RunId,
    status: OrchestrationV2RunStatus,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const AttachmentImportTool = Tool.make("ozi_attachment_import", {
  ...shared,
  description:
    'Store file bytes without sending a message or starting a turn. Example: {"threadId":"origin_chat_id","name":"report.md","mimeType":"text/markdown","contentBase64":"IyBSZXBvcnQK"}. Put the returned file reference in ticket attachments; for text/html use htmlPages with a takeaway title. PDF/docx/xlsx/csv/md/txt open in the in-app file sheet. CLI: ozi attachment import --thread ID --file PATH --mime-type TYPE --json.',
  parameters: Schema.Struct({
    threadId: ThreadId,
    name: Schema.String,
    mimeType: Schema.String,
    contentBase64: Schema.String.check(Schema.isMaxLength(70000000)),
  }),
  success: ChatFileAttachment,
}).annotate(Tool.Destructive, true);
const AttachmentVersionsTool = Tool.make("ozi_attachment_versions", {
  ...shared,
  dependencies: [...shared.dependencies, DocumentText.DocumentText],
  description:
    "Read, list, create or restore file versions using the original attachment reference and origin threadId. action: list returns history; read returns contentBase64 (latest unless versionId); create takes contentBase64 and optional notes; restore takes versionId and appends a version. Keep the original attachment ID so the open file sheet updates in place. send forwards the selected file and quote/comment notes to the origin chat and starts or steers its agent; use only when asked. CLI: ozi attachment versions --input JSON --json.",
  parameters: AttachmentVersionsInput,
  success: AttachmentVersionsResult,
}).annotate(Tool.Destructive, true);
export const AttachmentToolkit = Toolkit.make(
  AttachmentImportTool,
  AttachmentVersionsTool,
  AttachmentUploadTool,
  AttachmentDiscardTool,
  AttachmentSendTool,
);
