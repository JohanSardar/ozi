import * as ProviderRegistry from "../../../provider/ProviderRegistry.ts";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ModelSelection,
  type RuntimeMode,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerConfig from "../../../config.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as PeerForwarding from "../../../peer/PeerForwarding.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ThreadLaunchHandlers from "./handlers.ts";
import { ThreadLaunchToolkit } from "./tools.ts";

const clientLaunchHarness = (input: {
  readonly runtimeModeCeiling: RuntimeMode;
  readonly defaultRuntimeMode?: RuntimeMode;
  readonly fallbackModel?: ModelSelection;
  readonly providers?: readonly ServerProvider[];
  readonly launched: Array<ThreadLaunch.ThreadLaunchInput>;
  readonly workspaceRoot?: string;
  readonly webOrigin?: string;
}) => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "claude-opus",
  };
  const layerDependencies = Layer.mergeAll(
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed(input.providers ?? []),
    }),
    ServerSettings.layerTest({
      fallbackModelSelection: input.fallbackModel ?? null,
      ...(input.defaultRuntimeMode === undefined
        ? {}
        : { defaultRuntimeMode: input.defaultRuntimeMode }),
    }),
    NodeCrypto.layer,
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("environment"),
      requestNamespace: "client:session-1",
      thread: undefined,
      client: {
        sessionId: "session-1",
        label: "Claude Code",
        access: input.runtimeModeCeiling,
        webOrigin: input.webOrigin,
      },
      issuedAt: 0,
      capabilities: new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      // A thread exists once a launch started it.
      getThreadShell: (threadId) => {
        const launch = input.launched.find((candidate) => candidate.threadId === threadId);
        return Effect.succeed(
          launch === undefined
            ? null
            : ({
                id: launch.threadId,
                modelSelection: launch.modelSelection,
                deletedAt: null,
              } as unknown as OrchestrationV2ThreadShell),
        );
      },
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (launch) => {
        input.launched.push(launch);
        return Effect.succeed({
          threadId: launch.threadId,
          projection: {
            thread: {
              id: launch.threadId,
              title: launch.title,
              modelSelection: launch.modelSelection,
            },
            runs: [],
          },
          resumed: false,
        } as unknown as ThreadLaunch.ThreadLaunchResult);
      },
    }),
    Layer.mock(PeerForwarding.PeerForwarding)({}),
    DocumentText.layer.pipe(Layer.provideMerge(NodeServices.layer)),
  ).pipe(
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-client-launch-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  return { modelSelection, dependencies: layerDependencies };
};

it.effect("a launch retried with the same clientRequestId replays the first one", () =>
  Effect.gen(function* () {
    const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
    const { dependencies } = clientLaunchHarness({
      runtimeModeCeiling: "auto",
      launched,
    });
    const toolkit = yield* ThreadLaunchToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(ThreadLaunchHandlers.layer).pipe(
          Layer.provide(dependencies),
        ),
      ),
    );
    const launch = (clientRequestId: string | undefined) =>
      toolkit
        .handle("t3_thread_launch", {
          title: "Fix",
          message: "Fix the bug",
          ...(clientRequestId === undefined ? {} : { clientRequestId }),
        })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));

    yield* launch("fix-1");
    yield* launch("fix-1");
    yield* launch("fix-2");
    yield* launch(undefined);
    yield* launch(undefined);
    const ids = launched.map((input) => [input.commandId, input.threadId]);
    // The same key sends the same command and thread ids, which the launch
    // service replays instead of starting a second thread.
    expect(ids[0]).toEqual(ids[1]);
    expect(ids[0]?.[0]).toMatch(/^mcp:launch:[0-9a-f]{64}$/);
    expect(ids[2]).not.toEqual(ids[0]);
    // Without a key every launch is new.
    expect(ids[3]).not.toEqual(ids[4]);
  }),
);

it.effect("a launch key of any length or content gives a short id and never a defect", () =>
  Effect.gen(function* () {
    const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
    const { dependencies } = clientLaunchHarness({
      runtimeModeCeiling: "auto",
      launched,
    });
    const toolkit = yield* ThreadLaunchToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(ThreadLaunchHandlers.layer).pipe(
          Layer.provide(dependencies),
        ),
      ),
    );
    const launch = (clientRequestId: string) =>
      toolkit
        .handle("t3_thread_launch", { title: "Fix", clientRequestId })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));

    // Percent-encoding would grow this six times; scratch folders are named from the id.
    yield* launch("\u00e9".repeat(256));
    expect(launched.map((input) => input.commandId)).toEqual([
      expect.stringMatching(/^mcp:launch:[0-9a-f]{64}$/),
    ]);

    const loneSurrogate = yield* launch("key-\ud800").pipe(Effect.exit);
    expect(Exit.isFailure(loneSurrogate) && Cause.hasDies(loneSurrogate.cause)).toBe(false);
    expect(launched).toHaveLength(1);
  }),
);

it.effect("a client launches with the fallback for an exhausted default", () =>
  Effect.gen(function* () {
    const launched: ThreadLaunch.ThreadLaunchInput[] = [];
    const fallbackModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
    const providers: ServerProvider[] = ["claudeAgent", "codex"].map((driver) => ({
      instanceId: ProviderInstanceId.make(driver),
      driver: ProviderDriverKind.make(driver),
      enabled: true,
      installed: true,
      status: "ready",
      version: null,
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00Z",
      models: [],
      slashCommands: [],
      skills: [],
      ...(driver === "claudeAgent"
        ? {
            usageLimits: {
              checkedAt: "2026-01-01T00:00:00Z",
              windows: [{ id: "session", kind: "session", label: "Session", usedPercent: 100 }],
            },
          }
        : {}),
    }));
    const { dependencies } = clientLaunchHarness({
      runtimeModeCeiling: "full-access",
      launched,
      fallbackModel,
      providers,
    });
    const toolkit = yield* ThreadLaunchToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(ThreadLaunchHandlers.layer).pipe(
          Layer.provide(dependencies),
        ),
      ),
    );
    const result = yield* toolkit
      .handle("t3_thread_launch", {
        title: "Fallback",
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    expect(result.at(-1)?.result).toMatchObject({
      modelSelection: fallbackModel,
    });
    expect(launched[0]?.modelSelection).toEqual(fallbackModel);
  }),
);
