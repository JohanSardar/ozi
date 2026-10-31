import * as FileSystem from "effect/FileSystem";
import * as NodeBuffer from "node:buffer";
import * as NodePath from "node:path";
import { ChatFileAttachment, ThreadId } from "@t3tools/contracts";
import { AttachmentVersionsInput, AttachmentVersionsResult } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { baseDirFlag } from "./config.ts";
import { formatJson, withInboxTools } from "./inbox.ts";

const decodeInput = Schema.decodeEffect(Schema.fromJsonString(AttachmentVersionsInput));

export const attachmentCommand = Command.make("attachment").pipe(
  Command.withSubcommands([
    Command.make("import", {
      baseDir: baseDirFlag,
      json: Flag.Boolean("json").pipe(Flag.withDefault(true)),
      file: Flag.String("file"),
      thread: Flag.String("thread").pipe(Flag.withSchema(ThreadId)),
      mimeType: Flag.String("mime-type").pipe(Flag.withDefault("application/octet-stream")),
    }).pipe(
      Command.withHandler((flags) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const bytes = yield* fs.readFile(flags.file);
          yield* withInboxTools(flags, (tools) =>
            tools
              .call(
                "ozi_attachment_import",
                {
                  threadId: flags.thread,
                  name: NodePath.basename(flags.file),
                  mimeType: flags.mimeType,
                  contentBase64: NodeBuffer.Buffer.from(bytes).toString("base64"),
                },
                ChatFileAttachment,
              )
              .pipe(Effect.flatMap((result) => Console.log(formatJson(result)))),
          );
        }),
      ),
    ),
    Command.make("versions", {
      baseDir: baseDirFlag,
      json: Flag.Boolean("json").pipe(Flag.withDefault(true)),
      input: Flag.String("input"),
    }).pipe(
      Command.withHandler((flags) =>
        decodeInput(flags.input).pipe(
          Effect.flatMap((input) =>
            withInboxTools(flags, (tools) =>
              tools
                .call("ozi_attachment_versions", input, AttachmentVersionsResult)
                .pipe(Effect.flatMap((result) => Console.log(formatJson(result)))),
            ),
          ),
        ),
      ),
    ),
  ]),
);
