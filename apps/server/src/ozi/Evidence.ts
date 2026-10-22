import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { mcpTools } from "./McpTools.ts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class EvidenceError extends Schema.TaggedError<EvidenceError>()("EvidenceError", {
  detail: Schema.String,
}) {}

export const read = Effect.fn("Evidence.read")(function* (root: string, file: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fs.realPath(root);
  const target = yield* fs.realPath(path.resolve(base, file));
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    return yield* new EvidenceError({ detail: "Evidence must be in the workspace." });
  const bytes = yield* fs.readFile(target);
  if (bytes.length > 262144)
    return yield* new EvidenceError({ detail: "Evidence exceeds 256 KiB." });
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest("SHA-256", bytes);
  return {
    evidence: `${relative}:${Buffer.from(digest).toString("hex")}`,
    text: new TextDecoder().decode(bytes),
  };
});

export const verify = Effect.fn("Evidence.verify")(function* (root: string, evidence: string) {
  const index = evidence.lastIndexOf(":");
  if (index < 1) return false;
  return yield* read(root, evidence.slice(0, index)).pipe(
    Effect.map((result) => result.evidence === evidence),
    Effect.orElseSucceed(() => false),
  );
});

const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const action = Effect.fn("Evidence.action")(function* (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  id: string,
) {
  const item = items.find((item) => item.id === id);
  if (
    item?.type !== "dynamic_tool" ||
    item.status !== "completed" ||
    item.output == null ||
    typeof item.output !== "object" ||
    Array.isArray(item.output)
  )
    return yield* new EvidenceError({ detail: "No completed action receipt." });
  const name = item.toolName?.replace(/^(?:t3-code\.|mcp__t3-code__)/, "");
  const annotations = name ? mcpTools.get(name)?.annotations : undefined;
  const output = item.output as Record<string, unknown>;
  if (
    !annotations?.destructiveHint ||
    annotations.readOnlyHint ||
    output.error ||
    output.isError === true ||
    output.success === false
  )
    return yield* new EvidenceError({
      detail: "Evidence requires a successful action, not additional tool calls.",
    });
  const text = yield* encodeReceipt({ name, input: item.input, output: item.output });
  const digest = yield* (yield* Crypto.Crypto).digest("SHA-256", new TextEncoder().encode(text));
  return { evidence: `action:${item.id}:${Buffer.from(digest).toString("hex")}`, text };
});

export const verifyAction = (items: ReadonlyArray<OrchestrationV2TurnItem>, evidence: string) =>
  action(items, evidence.slice(7, evidence.lastIndexOf(":"))).pipe(
    Effect.map((result) => result.evidence === evidence),
    Effect.orElseSucceed(() => false),
  );
