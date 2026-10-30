import {
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { makeEnvironmentShellState } from "./shell.ts";
import * as ShellSnapshotLoader from "./shellSnapshotHttp.ts";
import { v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};

const LIVE_SHELL_SNAPSHOT: OrchestrationV2ShellSnapshot = {
  ...v2ShellSnapshot,
  snapshotSequence: 1,
};

function session(client: WsRpcProtocolClient): RpcSession.RpcSession {
  return {
    client,
    initialConfig: Effect.succeed({ shellResumeCompletionMarker: true } as never),
    subscribeServerConfig: (input) => client.subscribeServerConfig(input),
    ready: Effect.void,
    probe: Effect.void,
    inboundFrames: Effect.succeed(0),
    closed: Effect.never,
  };
}

const makePersistenceHarness = Effect.fn("test.makeShellPersistenceHarness")(function* (
  saveShell: Persistence.EnvironmentCacheStore["Service"]["saveShell"],
) {
  const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
  const client = {
    [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
  } as unknown as WsRpcProtocolClient;
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session(client))),
    prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell,
    loadThread: () => Effect.succeedNone,
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    clear: () => Effect.void,
  });
  const state = yield* makeEnvironmentShellState().pipe(
    Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
    Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    Effect.provideService(ShellSnapshotLoader.ShellSnapshotLoader, {
      load: () => Effect.succeedNone,
    }),
  );
  const send = Effect.fn("test.sendShellItem")(function* (
    item: OrchestrationV2ShellStreamItem,
    ready: (snapshot: OrchestrationV2ShellSnapshot) => boolean,
  ) {
    const previous = yield* SubscriptionRef.get(state);
    yield* Queue.offer(events, item);
    return yield* SubscriptionRef.changes(state).pipe(
      Stream.filter((value) => value !== previous),
      Stream.map((value) => value.snapshot),
      Stream.filter(Option.isSome),
      Stream.map((value) => value.value),
      Stream.filter(ready),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
  });
  yield* send({ kind: "snapshot", snapshot: LIVE_SHELL_SNAPSHOT }, () => true);
  return { state, send };
});

describe("environment shell synchronization", () => {
  it.effect("retries a failed shell save after a cursor-only update", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make<ReadonlyArray<number>>([]);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const h = yield* makePersistenceHarness((_id, snapshot) =>
            Effect.gen(function* () {
              const values = yield* Ref.updateAndGet(attempts, (values) => [
                ...values,
                snapshot.snapshotSequence,
              ]);
              if (values.length === 1)
                return yield* new Persistence.ConnectionPersistenceError({
                  operation: "save-shell",
                  message: "test failure",
                });
            }),
          );
          yield* TestClock.adjust("500 millis");
          yield* h.send(
            { kind: "thread.updated", sequence: 2, location: "active", thread: v2ThreadShell },
            (snapshot) => snapshot.snapshotSequence === 2,
          );
          yield* TestClock.adjust("10 seconds");
        }),
      );
      expect(yield* Ref.get(attempts)).toEqual([1, 2]);
    }),
  );
});
