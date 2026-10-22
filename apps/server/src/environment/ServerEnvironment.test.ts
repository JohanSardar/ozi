import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { DEFAULT_SIGNAL_EXPORT } from "@t3tools/shared/observability";
import * as OtelEnvironment from "@t3tools/shared/otelEnvironment";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const isServerEnvironmentIdPersistenceError = Schema.is(
  ServerEnvironment.ServerEnvironmentIdPersistenceError,
);

const layerEmptySecretStore = Layer.succeed(
  ServerSecretStore.ServerSecretStore,
  ServerSecretStore.ServerSecretStore.of({
    get: () => Effect.succeedNone,
    set: () => Effect.void,
    create: () => Effect.void,
    getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
    remove: () => Effect.void,
  }),
);

const makeServerConfig = Effect.fn(function* (baseDir: string) {
  const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);

  return {
    ...derivedPaths,
    logLevel: "Error",
    traceMinLevel: "Info",
    traceTimingEnabled: true,
    traceBatchWindowMs: 200,
    traceMaxBytes: 10 * 1024 * 1024,
    traceMaxFiles: 10,
    otlpTracesUrl: undefined,
    otlpMetricsUrl: undefined,
    otlpLogsUrl: undefined,
    otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
    otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
    otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
    otelEnvironment: OtelEnvironment.none,
    cwd: process.cwd(),
    dataRoot: baseDir,
    baseDir,
    mode: "web",
    autoBootstrapProjectFromCwd: false,
    logWebSocketEvents: false,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    port: 0,
    host: undefined,
    desktopBootstrapToken: undefined,
    staticDir: undefined,
    devUrl: undefined,
    devAllowedOrigins: [],
    noBrowser: false,
    startupPresentation: "browser",
  } satisfies ServerConfig.ServerConfig["Service"];
});

it.layer(NodeServices.layer)("ServerEnvironmentLive", (it) => {
  it.effect.each([
    { name: "missing", content: undefined },
    { name: "empty", content: "" },
    { name: "whitespace-only", content: " \t\n" },
  ])("concurrent initializers recover a $name environment id file", ({ content }) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-environment-concurrent-test-",
      });
      const serverConfig = yield* makeServerConfig(baseDir);
      yield* fileSystem.makeDirectory(serverConfig.stateDir, { recursive: true });
      if (content !== undefined) {
        yield* fileSystem.writeFileString(serverConfig.environmentIdPath, content);
      }
      const bothGenerated = yield* Deferred.make<void>();
      const bothReadEmpty = yield* Deferred.make<void>();
      const firstInitialized = yield* Deferred.make<void>();
      let remaining = 2;
      let emptyReads = 0;
      const readIdentity = Effect.gen(function* () {
        const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
        return yield* identity.getEnvironmentId;
      }).pipe(
        Effect.tap(() => Deferred.succeed(firstInitialized, undefined)),
        Effect.provide(Layer.fresh(ServerEnvironment.layerIdentity)),
        Effect.provideService(ServerConfig.ServerConfig, serverConfig),
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          readFileString: (path) =>
            fileSystem.readFileString(path).pipe(
              Effect.tap(
                Effect.fn(function* (value) {
                  if (path !== serverConfig.environmentIdPath || remaining > 0 || value.trim()) {
                    return;
                  }
                  if (++emptyReads === 2) {
                    yield* Deferred.succeed(bothReadEmpty, undefined);
                    yield* Deferred.await(firstInitialized);
                  } else {
                    yield* Deferred.await(bothReadEmpty);
                  }
                }),
              ),
            ),
        }),
        Effect.provideService(Crypto.Crypto, {
          ...crypto,
          randomUUIDv4: (() =>
            Effect.gen(function* () {
              const id = yield* crypto.randomUUIDv4();
              if (--remaining === 0) {
                yield* Deferred.succeed(bothGenerated, undefined);
              }
              yield* Deferred.await(bothGenerated);
              return id;
            })) as Crypto.Crypto["randomUUIDv4"],
        }),
      );

      const [first, second] = yield* Effect.all([readIdentity, readIdentity], {
        concurrency: "unbounded",
      });
      const persisted = yield* fileSystem.readFileString(serverConfig.environmentIdPath);

      expect(first).toBe(second);
      expect(persisted.trim()).toBe(first);
    }),
  );

  it.effect("structures persisted environment id filesystem failures", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-server-environment-error-test-",
      });
      const serverConfig = yield* makeServerConfig(baseDir);
      const environmentIdPath = serverConfig.environmentIdPath;
      const tempPath = `${environmentIdPath}.tmp`;
      const methodByOperation = {
        check: "exists",
        read: "readFileString",
        write: "writeFileString",
      } as const;

      for (const operation of ["check", "read", "write"] as const) {
        const writeAttempts: string[] = [];
        const cause = PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: methodByOperation[operation],
          description: "permission denied",
          pathOrDescriptor: environmentIdPath,
        });
        const layerFailingFileSystem = FileSystem.layerNoop({
          exists: () =>
            operation === "check" ? Effect.fail(cause) : Effect.succeed(operation === "read"),
          readFileString: () => Effect.fail(cause),
          makeTempFileScoped: () => Effect.succeed(tempPath),
          writeFileString: (path) => {
            writeAttempts.push(path);
            return Effect.fail(cause);
          },
        });

        const error = yield* Effect.gen(function* () {
          const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
          return yield* serverEnvironment.getDescriptor;
        }).pipe(
          Effect.provide(
            ServerEnvironment.layer.pipe(
              Layer.provide(layerEmptySecretStore),
              Layer.provide(Layer.merge(ServerConfig.layer(serverConfig), layerFailingFileSystem)),
            ),
          ),
          Effect.flip,
        );

        expect(isServerEnvironmentIdPersistenceError(error)).toBe(true);
        if (!isServerEnvironmentIdPersistenceError(error)) {
          throw error;
        }
        expect(error.operation).toBe(operation);
        expect(error.environmentIdPath).toBe(environmentIdPath);
        expect(error.cause).toBe(cause);
        expect(error.message).toBe(
          `Server environment ID ${operation} failed at '${environmentIdPath}'.`,
        );
        expect(writeAttempts).toEqual(operation === "write" ? [tempPath] : []);
      }
    }),
  );
});
