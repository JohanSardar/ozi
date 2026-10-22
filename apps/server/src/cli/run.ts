import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import packageJson from "../../package.json" with { type: "json" };
import { extendConnectionAttemptTimeout, keepOutboundFetchOnHttp1 } from "../outboundHttp.ts";

const encodeError = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const runtime = Layer.mergeAll(NodeServices.layer, NetService.layer, FetchHttpClient.layer);

export function runCommand<Name extends string, Input, ContextInput, E>(
  command: Command.Command<
    Name,
    Input,
    ContextInput,
    E,
    Layer.Success<typeof runtime> | Scope.Scope
  >,
) {
  extendConnectionAttemptTimeout();
  keepOutboundFetchOnHttp1();
  Command.run(command, { version: packageJson.version }).pipe(
    Effect.tapError((error) =>
      process.argv.includes("--json")
        ? Console.log(
            encodeError({
              error: { message: error instanceof Error ? error.message : String(error) },
            }),
          )
        : Effect.void,
    ),
    Effect.scoped,
    Effect.provide(runtime),
    NodeRuntime.runMain({ disableErrorReporting: process.argv.includes("--json") }),
  );
}
