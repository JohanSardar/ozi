import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Config from "effect/Config";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

export class RemoteConnectionError extends Schema.TaggedError<RemoteConnectionError>()(
  "RemoteConnectionError",
  { message: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
}

const RemoteConnection = Schema.Struct({
  origin: Schema.String,
  token: Schema.String,
  expiresAt: Schema.Number,
});
const remoteJson = Schema.fromJsonString(RemoteConnection);
const encodeRemote = Schema.encodeEffect(remoteJson);
const decodeRemote = Schema.decodeUnknownEffect(remoteJson);
export const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const remoteConnectionPath = Effect.fn("cli.remote.path")(function* (
  baseDir: Option.Option<string>,
) {
  const path = yield* Path.Path;
  const home =
    Option.getOrUndefined(baseDir) ??
    Option.getOrUndefined(yield* Config.String("OZI_HOME").pipe(Config.option));
  return path.join(yield* resolveBaseDir(home), "remote.json");
});

export const readRemoteConnection = Effect.fn("cli.remote.read")(function* (
  baseDir: Option.Option<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* remoteConnectionPath(baseDir);
  if (!(yield* fs.exists(file))) return Option.none<typeof RemoteConnection.Type>();
  const remote = yield* fs.readFileString(file).pipe(
    Effect.flatMap(decodeRemote),
    Effect.mapError(
      () =>
        new RemoteConnectionError({
          message: "Saved connection is invalid. Run `ozi connect <pairing-url>` again.",
        }),
    ),
  );
  if (remote.expiresAt <= (yield* Clock.currentTimeMillis)) {
    return yield* new RemoteConnectionError({
      message: "Remote session expired. Run `ozi connect <pairing-url>` again.",
    });
  }
  return Option.some(remote);
});

const locationFlags = {
  baseDir: baseDirFlag,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
};

export const connectCommand = Command.make("connect", {
  ...locationFlags,
  pairingUrl: Argument.String("pairing-url"),
}).pipe(
  Command.withDescription(
    "Pair with a reachable Ozi server and save its session for CLI commands.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const target = yield* Effect.try({
        try: () => resolveRemotePairingTarget({ pairingUrl: flags.pairingUrl }),
        catch: () =>
          new RemoteConnectionError({
            message: "Invalid pairing URL. Use a fresh URL from `ozi pair`.",
          }),
      });
      const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: target.httpBaseUrl });
      const issued = yield* client.auth
        .token({
          headers: {},
          payload: {
            grant_type: AuthTokenExchangeGrantType,
            subject_token: target.credential,
            subject_token_type: AuthEnvironmentBootstrapTokenType,
            requested_token_type: AuthAccessTokenType,
            client_label: "ozi cli",
            client_device_type: "desktop",
          },
        })
        .pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError(
            () =>
              new RemoteConnectionError({
                message:
                  "Pairing failed. Check the server address and use a fresh URL from `ozi pair`.",
              }),
          ),
        );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = yield* remoteConnectionPath(flags.baseDir);
      const expiresAt = (yield* Clock.currentTimeMillis) + issued.expires_in * 1000;
      const contents = yield* encodeRemote({
        origin: target.httpBaseUrl,
        token: issued.access_token,
        expiresAt,
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
          const temporary = yield* fs.makeTempFileScoped({
            directory: path.dirname(file),
            prefix: ".remote-",
          });
          yield* fs.writeFileString(temporary, contents, { mode: 0o600 });
          yield* fs.chmod(temporary, 0o600);
          yield* fs.rename(temporary, file);
        }),
      );
      yield* Console.log(
        flags.json
          ? yield* encodeJson({
              origin: target.httpBaseUrl,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
            })
          : `Connected to ${target.httpBaseUrl}.`,
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  ),
);

export const disconnectCommand = Command.make("disconnect", locationFlags).pipe(
  Command.withDescription("Remove the saved remote CLI connection."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(yield* remoteConnectionPath(flags.baseDir), { force: true });
      yield* Console.log(flags.json ? yield* encodeJson({ disconnected: true }) : "Disconnected.");
    }),
  ),
);
