import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Command, GlobalFlag } from "effect/cli";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Service from "../ozi/Service.ts";
import { baseDirFlag, jsonFlag, resolveCliAuthConfig } from "./config.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const commands = (["install", "status", "restart", "uninstall"] as const).map((action) =>
  Command.make(action, { baseDir: baseDirFlag, json: jsonFlag }).pipe(
    Command.withHandler((flags) =>
      Effect.gen(function* () {
        const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
        const result = yield* Effect.gen(function* () {
          const service = yield* Service.Service;
          return yield* service.run(action);
        }).pipe(
          Effect.provide(
            Service.layer.pipe(
              Layer.provide(ServerConfig.layer(config)),
              Layer.provide(ProcessRunner.layer),
            ),
          ),
        );
        yield* Console.log(yield* encodeJson(result));
      }),
    ),
  ),
);

export const serviceCommand = Command.make("service").pipe(Command.withSubcommands(commands));
