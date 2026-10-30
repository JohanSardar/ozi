import type { RunResult } from "@cursor/sdk";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { CursorSettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach, vi } from "vite-plus/test";

import { makeCursorTextGeneration } from "./textGeneration.ts";
import * as CursorSdk from "./CursorSdk.ts";

const cursorSdkMock = vi.hoisted(() => ({
  create: vi.fn<(options: unknown) => Promise<unknown>>(),
  send: vi.fn<(prompt: string) => Promise<unknown>>(),
  close: vi.fn(),
  cancel: vi.fn(async () => {}),
  storeOpen: vi.fn<(options: unknown) => Promise<unknown>>(),
  storeDispose: vi.fn(async () => {}),
  prompt: vi.fn<(prompt: string, options: unknown) => Promise<RunResult>>(async () => ({
    id: "run-cursor-text-generation-test",
    status: "finished",
    result:
      '{"subject":"Add generated commit message","body":"- verify cursor sdk text generation"}',
  })),
}));

vi.mock("./sdk.ts", () => ({
  Agent: { create: cursorSdkMock.create },
  createAgentPlatform: vi.fn(),
  SqliteLocalAgentStore: { open: cursorSdkMock.storeOpen },
}));

let hasCustomPolicy = false;
const layerFs = FileSystem.layerNoop({
  exists: () => Effect.succeed(hasCustomPolicy),
  makeTempDirectoryScoped: () => Effect.succeed("/isolated-text-generation"),
});
const layerTest = Layer.merge(layerFs, CursorSdk.layer);

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const cursorSettings = decodeCursorSettings({ enabled: true });

beforeEach(() => {
  hasCustomPolicy = false;
  cursorSdkMock.create.mockReset();
  cursorSdkMock.send.mockReset();
  cursorSdkMock.create.mockImplementation(async (options) => {
    cursorSdkMock.send.mockImplementation(async (prompt) => ({
      status: "running",
      cancel: cursorSdkMock.cancel,
      wait: () => cursorSdkMock.prompt(prompt, options),
    }));
    return {
      close: cursorSdkMock.close,
      [Symbol.asyncDispose]: async () => {
        cursorSdkMock.close();
      },
      send: cursorSdkMock.send,
    };
  });
  cursorSdkMock.close.mockClear();
  cursorSdkMock.cancel.mockClear();
  cursorSdkMock.storeDispose.mockClear();
  cursorSdkMock.storeOpen.mockReset();
  cursorSdkMock.storeOpen.mockResolvedValue({ dispose: cursorSdkMock.storeDispose });
  cursorSdkMock.prompt.mockReset();
  cursorSdkMock.prompt.mockResolvedValue({
    id: "run-cursor-text-generation-test",
    status: "finished",
    result:
      '{"subject":"Add generated commit message","body":"- verify cursor sdk text generation"}',
  });
});

describe("CursorTextGeneration", () => {
  it.effect("generates thread titles through Cursor SDK text generation", () =>
    Effect.gen(function* () {
      cursorSdkMock.prompt.mockResolvedValueOnce({
        id: "run-cursor-title-generation-test",
        status: "finished",
        result: '{"title":"\\"Trim reconnect spinner status after resume.\\""}',
      });
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {
        CURSOR_API_KEY: "test-cursor-key",
      });

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Fix the reconnect spinner after a resumed session.",
        modelSelection: {
          instanceId: ProviderInstanceId.make("cursor"),
          model: "composer-2",
        },
      });

      expect(generated.title).toBe("Trim reconnect spinner status after resume.");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each(["error", "cancelled"] as const)(
    "rejects a %s Cursor SDK run that includes valid title JSON",
    (status) =>
      Effect.gen(function* () {
        const promptResult = {
          id: "run-cursor-partial-title-test",
          status,
          result: '{"title":"Partial title from a failed run."}',
        } satisfies RunResult;
        cursorSdkMock.prompt.mockResolvedValueOnce(promptResult);
        const generation = yield* makeCursorTextGeneration(cursorSettings, {
          CURSOR_API_KEY: "test-cursor-key",
        });
        const failure = yield* Effect.flip(
          generation.generateThreadTitle({
            cwd: process.cwd(),
            message: "Fix the reconnect spinner after a resumed session.",
            modelSelection: {
              instanceId: ProviderInstanceId.make("cursor"),
              model: "composer-2",
            },
          }),
        );
        expect(failure).toBeInstanceOf(TextGenerationError);
        expect(failure.operation).toBe("generateThreadTitle");
        expect(failure.detail).toBe(
          status === "cancelled"
            ? "Cursor SDK request was cancelled."
            : "Cursor SDK request finished with an error.",
        );
        expect(cursorSdkMock.close).toHaveBeenCalledOnce();
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("fails closed when ambient sandbox policy can expand write access", () =>
    Effect.gen(function* () {
      hasCustomPolicy = true;
      const generation = yield* makeCursorTextGeneration(cursorSettings, { CURSOR_API_KEY: "key" });
      const failure = yield* Effect.flip(
        generation.generateThreadTitle({
          cwd: "/real-workspace",
          message: "Title",
          modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2" },
        }),
      );
      expect(failure.detail).toContain("custom ~/.cursor/sandbox.json");
      expect(cursorSdkMock.prompt).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layerTest)),
  );
});
