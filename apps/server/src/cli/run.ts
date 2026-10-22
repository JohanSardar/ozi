import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { OziJobError } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { CliError, Command } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import packageJson from "../../package.json" with { type: "json" };
import { extendConnectionAttemptTimeout, keepOutboundFetchOnHttp1 } from "../outboundHttp.ts";

const encodeError = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isJobError = Schema.is(OziJobError);

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
    Effect.tapCause((cause) => {
      const failure = Cause.squash(cause);
      if (CliError.isCliError(failure) && failure._tag === "ShowHelp") return Effect.void;
      const error = isJobError(failure)
        ? { code: failure.reason, message: failure.detail }
        : {
            code: failure instanceof Error ? failure.name : "Error",
            message: failure instanceof Error ? failure.message : String(failure),
          };
      error.message = error.message.split(/[\r\n]/)[0]!;
      return process.argv.includes("--json")
        ? Console.log(encodeError({ error }))
        : Console.error(error.message);
    }),
    Effect.scoped,
    Effect.provide(runtime),
    NodeRuntime.runMain({ disableErrorReporting: true }),
  );
}
