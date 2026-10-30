import { ProviderInstanceId } from "@t3tools/contracts";
import { OpenCodeSettings } from "../settings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NetService from "@t3tools/shared/Net";
import { beforeEach, expect } from "vite-plus/test";

import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import * as OpenCodeServerOwner from "./OpenCodeServerOwner.ts";
import * as OpenCodeTextGeneration from "./textGeneration.ts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";

const runtimeMock = {
  state: {
    startCalls: [] as string[],
    promptUrls: [] as string[],
    promptParts: [] as ReadonlyArray<unknown>[],
    authHeaders: [] as Array<string | null>,
    closeCalls: [] as string[],
    sessionCreateCalls: 0,
    abortCalls: [] as string[],
    onSessionCreate: undefined as ((signal?: AbortSignal) => Promise<never>) | undefined,
    onPrompt: undefined as
      | ((signal?: AbortSignal) => Promise<{ data: { parts: ReadonlyArray<unknown> } }>)
      | undefined,
    onAbort: undefined as ((signal?: AbortSignal) => Promise<never>) | undefined,
    connectionError: undefined as Error | undefined,
    sessionCreateError: undefined as unknown,
    sessionResult: undefined as { data?: { id: string } } | undefined,
    promptRequestError: undefined as unknown,
    promptResult: undefined as
      | { data?: { info?: { error?: unknown }; parts?: Array<unknown> } }
      | undefined,
  },
  reset() {
    this.state.startCalls.length = 0;
    this.state.promptUrls.length = 0;
    this.state.promptParts.length = 0;
    this.state.authHeaders.length = 0;
    this.state.closeCalls.length = 0;
    this.state.sessionCreateCalls = 0;
    this.state.abortCalls.length = 0;
    this.state.onSessionCreate = undefined;
    this.state.onPrompt = undefined;
    this.state.onAbort = undefined;
    this.state.connectionError = undefined;
    this.state.sessionCreateError = undefined;
    this.state.sessionResult = undefined;
    this.state.promptRequestError = undefined;
    this.state.promptResult = undefined;
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntime.OpenCodeRuntime["Service"] = {
  startOpenCodeServerProcess: ({ binaryPath, serverPassword, environment }) =>
    Effect.gen(function* () {
      const index = runtimeMock.state.startCalls.length + 1;
      const url = `http://127.0.0.1:${4_300 + index}`;
      runtimeMock.state.startCalls.push(binaryPath);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          runtimeMock.state.closeCalls.push(url);
        }),
      );
      const effectiveServerPassword = OpenCodeRuntime.resolveOpenCodeServerPassword({
        external: false,
        ...(serverPassword !== undefined ? { serverPassword } : {}),
        ...(environment !== undefined ? { environment } : {}),
      });
      return {
        url,
        ...(effectiveServerPassword !== undefined
          ? { serverPassword: effectiveServerPassword }
          : {}),
        version: "1.14.19",
        isRunning: Effect.succeed(true),
        exitCode: Effect.never,
      };
    }),
  connectToOpenCodeServer: ({ serverUrl, serverPassword }) =>
    runtimeMock.state.connectionError
      ? Effect.fail(
          new OpenCodeRuntime.OpenCodeRuntimeError({
            operation: "global.health",
            detail: runtimeMock.state.connectionError.message,
            cause: runtimeMock.state.connectionError,
          }),
        )
      : Effect.succeed({
          url: serverUrl ?? "http://127.0.0.1:4301",
          ...(serverPassword ? { serverPassword } : {}),
          version: "1.14.19",
          exitCode: null,
          external: Boolean(serverUrl),
        }),
  runOpenCodeCommand: () => Effect.succeed({ stdout: "", stderr: "", code: 0 }),
  createOpenCodeSdkClient: ({ baseUrl, serverPassword }) =>
    ({
      session: {
        create: async (_input: unknown, options?: { readonly signal?: AbortSignal }) => {
          runtimeMock.state.sessionCreateCalls += 1;
          if (runtimeMock.state.onSessionCreate) {
            return runtimeMock.state.onSessionCreate(options?.signal);
          }
          if (runtimeMock.state.sessionCreateError !== undefined) {
            throw runtimeMock.state.sessionCreateError;
          }
          return runtimeMock.state.sessionResult ?? { data: { id: `${baseUrl}/session` } };
        },
        abort: async (
          input: { readonly sessionID: string },
          options?: { readonly signal?: AbortSignal },
        ) => {
          runtimeMock.state.abortCalls.push(input.sessionID);
          if (runtimeMock.state.onAbort) return runtimeMock.state.onAbort(options?.signal);
          return { data: true };
        },
        prompt: async (
          input: { readonly parts: ReadonlyArray<unknown> },
          options?: { readonly signal?: AbortSignal },
        ) => {
          runtimeMock.state.promptUrls.push(baseUrl);
          runtimeMock.state.promptParts.push(input.parts);
          runtimeMock.state.authHeaders.push(
            serverPassword ? `Basic ${btoa(`opencode:${serverPassword}`)}` : null,
          );
          if (runtimeMock.state.onPrompt) return runtimeMock.state.onPrompt(options?.signal);
          if (runtimeMock.state.promptRequestError !== undefined) {
            throw runtimeMock.state.promptRequestError;
          }
          return (
            runtimeMock.state.promptResult ?? {
              data: {
                parts: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      subject: "Improve OpenCode reuse",
                      body: "Reuse one server for the full action.",
                    }),
                  },
                ],
              },
            }
          );
        },
      },
    }) as unknown as ReturnType<
      OpenCodeRuntime.OpenCodeRuntime["Service"]["createOpenCodeSdkClient"]
    >,
  loadOpenCodeInventory: () =>
    Effect.fail(
      new OpenCodeRuntime.OpenCodeRuntimeError({
        operation: "loadOpenCodeInventory",
        detail: "OpenCodeRuntimeTestDouble.loadOpenCodeInventory not used in this test",
        cause: null,
      }),
    ),
  loadOpenCodeSkills: () => Effect.succeed([]),
};

const DEFAULT_TEST_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("opencode"),
  model: "openai/gpt-5",
};

const layerOpenCodeTextGenerationTest = Layer.succeed(
  OpenCodeRuntime.OpenCodeRuntime,
  OpenCodeRuntimeTestDouble,
).pipe(
  Layer.provideMerge(TestProviderHost.layer()),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
);

const layerOpenCodeTextGenerationExistingServerTest = Layer.succeed(
  OpenCodeRuntime.OpenCodeRuntime,
  OpenCodeRuntimeTestDouble,
).pipe(
  Layer.provideMerge(TestProviderHost.layer()),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
);

const DEFAULT_OPENCODE_SETTINGS = Schema.decodeSync(OpenCodeSettings)({
  binaryPath: "fake-opencode",
});

function withOpenCodeTextGeneration<A, E, R>(
  settings: OpenCodeSettings,
  effectFn: (textGeneration: ProviderTextGeneration) => Effect.Effect<A, E, R>,
  environment?: NodeJS.ProcessEnv,
) {
  return Effect.gen(function* () {
    const serverOwner = yield* OpenCodeServerOwner.make({
      binaryPath: settings.binaryPath,
      directory: process.cwd(),
      ...(settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
      ...(environment ? { environment } : {}),
    });
    const textGeneration = yield* OpenCodeTextGeneration.makeOpenCodeTextGeneration(settings).pipe(
      Effect.provideService(OpenCodeServerOwner.OpenCodeServerOwner, serverOwner),
    );
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

beforeEach(() => {
  runtimeMock.reset();
});

it.layer(layerOpenCodeTextGenerationTest)("OpenCodeTextGeneration", (it) => {
  it.effect("excludes generic files from thread title generation", () =>
    withOpenCodeTextGeneration(DEFAULT_OPENCODE_SETTINGS, (textGeneration) =>
      Effect.gen(function* () {
        runtimeMock.state.promptResult = {
          data: {
            parts: [{ type: "text", text: '{"title":"Review uploaded report"}' }],
          },
        };

        yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Review these attachments.",
          modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          attachments: [
            {
              type: "image",
              id: "thread-image-attachment",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 3,
            },
            {
              type: "file",
              id: "thread-report-attachment-pdf",
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 42,
            },
          ],
        });

        expect(runtimeMock.state.promptParts[0]).toEqual([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "file", filename: "screenshot.png" }),
        ]);
      }),
    ),
  );
});

it.layer(layerOpenCodeTextGenerationExistingServerTest)(
  "OpenCodeTextGeneration with configured server URL",
  () => {},
);
