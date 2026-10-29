import { AuthMcpClientAccess, EnvironmentHttpApi } from "@t3tools/contracts";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Config from "effect/Config";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Base64Url from "effect/encoding/Base64Url";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

export class RemoteConnectionError extends Schema.TaggedError<RemoteConnectionError>()(
  "RemoteConnectionError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override readonly [Runtime.errorReported] = false;
}
const isRemoteConnectionError = Schema.is(RemoteConnectionError);

const RemoteConnection = Schema.Struct({
  origin: Schema.String.check(
    Schema.makeFilter((value) => {
      const url = URL.parse(value);
      return (
        url !== null &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      );
    }),
  ),
  token: Schema.String.check(Schema.isMinLength(1)),
  expiresAt: Schema.Number.check(Schema.isFinite()),
});
const remoteJson = Schema.fromJsonString(RemoteConnection);
const encodeRemote = Schema.encodeEffect(remoteJson);
const decodeRemote = Schema.decodeUnknownEffect(remoteJson);
export const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
export const reportRemoteErrors =
  (json: boolean) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.tapError((error) =>
        isRemoteConnectionError(error)
          ? json
            ? encodeJson({ code: error._tag, message: error.message }).pipe(
                Effect.flatMap(Console.error),
              )
            : Console.error(error.message)
          : Effect.void,
      ),
    );

const remoteConnectionPath = Effect.fn("cli.remote.path")(function* (
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
      (cause) =>
        new RemoteConnectionError({
          message: "Saved connection is invalid. Run `ozi connect <pairing-url>` again.",
          cause,
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

const exchangePairingToken = Effect.fn("cli.remote.exchange")(function* (
  origin: string,
  token: string,
  access: AuthMcpClientAccess,
) {
  const http = yield* HttpClient.HttpClient;
  const client = yield* HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.transform(http, (response) =>
        Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
      ),
    ),
  );
  const crypto = yield* Crypto.Crypto;
  const redirectUri = "http://127.0.0.1/ozi-cli";
  const registered = yield* client.mcpOAuth.register({
    payload: { client_name: "ozi cli", redirect_uris: [redirectUri] },
  });
  const verifier = Base64Url.encode(yield* crypto.randomBytes(32));
  const challenge = Base64Url.encode(
    yield* crypto.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const state = Base64Url.encode(yield* crypto.randomBytes(16));
  const resource = new URL("/mcp", origin).href;
  const decided = yield* client.mcpOAuth.decision({
    payload: {
      authorization: {
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        resource,
      },
      decision: { _tag: "pairing-code", access, code: token },
    },
  });
  const redirect = URL.parse(decided.redirectTo);
  const code = redirect?.searchParams.get("code");
  if (
    !code ||
    redirect?.searchParams.get("state") !== state ||
    redirect.origin + redirect.pathname !== redirectUri
  ) {
    return yield* new RemoteConnectionError({
      message: "Pairing failed. Use a fresh URL from `ozi pair`.",
    });
  }
  return yield* client.mcpOAuth.token({
    payload: {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: registered.client_id,
      code_verifier: verifier,
      resource,
    },
  });
});

export const connectCommand = Command.make("connect", {
  ...locationFlags,
  pairingUrl: Argument.String("pairing-url"),
  access: Flag.Literals("access", AuthMcpClientAccess.literals).pipe(
    Flag.withDefault("full-access" as const),
  ),
}).pipe(
  Command.withDescription(
    "Pair with a reachable Ozi server and save its session for CLI commands.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const target = yield* Effect.try({
        try: () => resolveRemotePairingTarget({ pairingUrl: flags.pairingUrl }),
        catch: (cause) =>
          new RemoteConnectionError({
            message: "Invalid pairing URL. Use a fresh URL from `ozi pair`.",
            cause,
          }),
      });
      const issued = yield* exchangePairingToken(
        target.httpBaseUrl,
        target.credential,
        flags.access,
      ).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(
          (cause) =>
            new RemoteConnectionError({
              message:
                "Pairing failed. Check the server address and use a fresh URL from `ozi pair`.",
              cause,
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
      ).pipe(
        Effect.mapError(
          (cause) =>
            new RemoteConnectionError({
              message: "Could not save the remote connection. Check the client home's permissions.",
              cause,
            }),
        ),
      );
      yield* Console.log(
        flags.json
          ? yield* encodeJson({
              origin: target.httpBaseUrl,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAt)),
            })
          : `Connected to ${target.httpBaseUrl}.`,
      );
    }).pipe(Effect.provide(FetchHttpClient.layer), reportRemoteErrors(flags.json)),
  ),
);

export const disconnectCommand = Command.make("disconnect", locationFlags).pipe(
  Command.withDescription("Remove the saved remote CLI connection."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(yield* remoteConnectionPath(flags.baseDir), { force: true }).pipe(
        Effect.mapError(
          (cause) =>
            new RemoteConnectionError({
              message:
                "Could not remove the saved connection. Check the client home's permissions.",
              cause,
            }),
        ),
      );
      yield* Console.log(flags.json ? yield* encodeJson({ disconnected: true }) : "Disconnected.");
    }).pipe(reportRemoteErrors(flags.json)),
  ),
);
