import { assert, describe, it } from "@effect/vitest";
import {
  AuthEnvironmentMaintainScope,
  AuthOrchestrationReadScope,
  type AuthEnvironmentScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import * as RpcTest from "effect/rpc/RpcTest";

import { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import { RpcInstrumentation, rpcInstrumentationLayer } from "./RpcInstrumentation.ts";

type WsRpcMethod = keyof typeof RPC_REQUIRED_SCOPES;

const groupOf = <const Tags extends ReadonlyArray<WsRpcMethod>>(...tags: Tags) =>
  WsRpcGroup.omit(
    ...[...WsRpcGroup.requests.keys()].filter(
      (tag): tag is Exclude<WsRpcMethod, Tags[number]> =>
        !(tags as ReadonlyArray<string>).includes(tag),
    ),
  ).middleware(RpcInstrumentation);

const connectionMiddleware = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.merge(RpcAuthorization.layer(scopes), rpcInstrumentationLayer);

const withTelemetry = <A, E, R>(
  test: (ended: ReadonlyArray<Tracer.NativeSpan>) => Effect.Effect<A, E, R>,
) => {
  const ended: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        ended.push(span);
      };
      return span;
    },
  });
  return test(ended).pipe(
    Effect.scoped,
    Effect.withTracer(tracer),
    Effect.provideService(Metric.MetricRegistry, new Map()),
  );
};

// RpcTest keeps Effect's own RpcServer/RpcClient spans, which ws.ts turns off with
// `disableTracing: true`.
const appSpans = (ended: ReadonlyArray<Tracer.NativeSpan>) =>
  ended.filter((span) => span.attributes.get("rpc.system.name") !== "effect_rpc");

const requestCount = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  method: string,
  outcome: string,
) =>
  snapshots.find(
    (snapshot): snapshot is Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }> =>
      snapshot.type === "Counter" &&
      snapshot.id === "t3_rpc_requests_total" &&
      snapshot.attributes?.["method"] === method &&
      snapshot.attributes?.["outcome"] === outcome,
  )?.state;

describe("WS RPC instrumentation middleware", () => {
  it.effect("records metrics but no spans for methods with tracing disabled", () =>
    withTelemetry((ended) =>
      Effect.gen(function* () {
        const group = groupOf(WS_METHODS.serverSignalProcess);
        const client = yield* RpcTest.makeClient(group).pipe(
          Effect.provide(
            Layer.mergeAll(
              group.toLayerHandler(WS_METHODS.serverSignalProcess, (input) =>
                Effect.succeed({
                  pid: input.pid,
                  signal: input.signal,
                  signaled: true,
                  message: Option.none(),
                }).pipe(Effect.withSpan("signalProcess.child")),
              ),
              connectionMiddleware([AuthOrchestrationReadScope, AuthEnvironmentMaintainScope]),
            ),
          ),
        );

        const input = { pid: 4242, startTimeMs: 0, signal: "SIGINT" } as const;
        assert.equal((yield* client[WS_METHODS.serverSignalProcess](input)).signaled, true);

        assert.deepStrictEqual(appSpans(ended), []);
        const snapshots = yield* Metric.snapshot;
        assert.equal(requestCount(snapshots, WS_METHODS.serverSignalProcess, "success")?.count, 1);
      }),
    ),
  );
});
