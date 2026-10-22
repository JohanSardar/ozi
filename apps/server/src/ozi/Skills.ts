import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ServerConfig } from "../config.ts";
import { McpInvocationContext } from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { dataRoot } from "./Loadout.ts";

export const SkillToolkit = Toolkit.make(
  Tool.make("read_skill", {
    description: "Read a skill by name from the Ozi data root.",
    parameters: Schema.Struct({ name: Schema.String }),
    success: Schema.String,
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [McpInvocationContext, ServerConfig, FileSystem.FileSystem, Path.Path],
  }).annotate(Tool.Readonly, true),
);

export const layer = McpToolAccess.toLayer(SkillToolkit, {
  read_skill: McpToolAccess.readsAsCaller(({ name }) =>
    Effect.gen(function* () {
      const missing = new OrchestratorMcpFailure({
        code: "invalid_request",
        message: "Unknown skill.",
      });
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) return yield* missing;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return yield* Effect.gen(function* () {
        const root = yield* fs.realPath(dataRoot(config));
        const file = yield* fs.realPath(path.join(root, "skills", name, "SKILL.md"));
        const relative = path.relative(path.join(root, "skills"), file);
        if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
          return yield* missing;
        return yield* fs.readFileString(file);
      }).pipe(Effect.mapError(() => missing));
    }),
  ),
});
