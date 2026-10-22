import {
  isOziMain,
  OZI_MAIN_TOOL_NAMES,
  type ModelSelection,
  type OziEffectiveLoadout,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { OZI_WORKER_ROLE } from "@t3tools/provider-core/server/orchestrationInstructions";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { ServerConfig } from "../config.ts";
import { dataRootPermit } from "./DataRoot.ts";

export const dataRoot = (config: ServerConfig["Service"]) => config.dataRoot;

export const readMainPrompt = Effect.fn("Ozi.readMainPrompt")(function* (
  config: ServerConfig["Service"],
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = dataRoot(config);
  const prompt = yield* fs.readFileString(path.join(root, "prompt.md"));
  const adhd = yield* fs
    .readFileString(path.join(root, "adhd.md"))
    .pipe(
      Effect.catch((error) =>
        error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(error),
      ),
    );
  return prompt.replaceAll("{{ADHD}}", adhd);
}, dataRootPermit.withPermits(1));

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("hex")),
  );

const effectiveLoadout = Effect.fn("Ozi.effectiveLoadout")(function* (input: {
  readonly provider: string;
  readonly selection: ModelSelection;
  readonly toolNames: ReadonlyArray<string>;
  readonly systemPrompt: string;
}): Effect.fn.Return<OziEffectiveLoadout> {
  return {
    provider: input.provider,
    model: input.selection.model,
    options: input.selection.options ?? [],
    toolNames: input.toolNames,
    systemPromptSha256: yield* sha256(input.systemPrompt),
  };
});

export const prepareLoadout = Effect.fn("Ozi.prepareLoadout")(function* (
  config: ServerConfig["Service"],
  thread: OrchestrationV2AppThread,
  selection: ModelSelection,
  provider: string,
  workerTools: ReadonlyArray<string>,
) {
  const main = isOziMain(thread);
  const systemPrompt = main ? yield* readMainPrompt(config) : OZI_WORKER_ROLE;
  let mainPromptPath: string | undefined;
  if (main) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.join(config.stateDir, "ozi-prompts");
    yield* fs.makeDirectory(directory, { recursive: true });
    mainPromptPath = path.join(directory, `${yield* sha256(thread.id)}.md`);
    yield* fs.writeFileString(mainPromptPath, systemPrompt);
  }
  return {
    mainPromptPath,
    effectiveLoadout: yield* effectiveLoadout({
      provider,
      selection,
      toolNames: main ? OZI_MAIN_TOOL_NAMES : workerTools,
      systemPrompt,
    }),
  };
});
