import {
  AuthOrchestrationOperateScope,
  ChatSessionRpcGroup,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  ORCHESTRATION_PROTOCOL_VERSION,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as RpcInstrumentation from "../observability/RpcInstrumentation.ts";
import * as ChatSessions from "./ChatSessions.ts";

const group = ChatSessionRpcGroup.middleware(RpcInstrumentation.RpcInstrumentation);

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const sessions = yield* SessionStore.SessionStore;
    const chats = yield* ChatSessions.ChatSessions;
    return HttpRouter.add(
      "GET",
      "/mcp/sessions",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* auth.authenticateMcpClient(request).pipe(Effect.option);
        if (session._tag === "None") return HttpServerResponse.empty({ status: 401 });
        if (session.value.access !== "full-access" || session.value.peerLink)
          return HttpServerResponse.empty({ status: 403 });
        const url = HttpServerRequest.toURL(request);
        if (
          url._tag === "None" ||
          url.value.searchParams.get(ORCHESTRATION_PROTOCOL_QUERY_PARAM) !==
            String(ORCHESTRATION_PROTOCOL_VERSION)
        )
          return HttpServerResponse.empty({ status: 426 });
        const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
        yield* RpcServer.make(group, { disableFatalDefects: true }).pipe(
          Effect.provideService(RpcServer.Protocol, protocol),
          Effect.provide(
            Layer.mergeAll(
              group.toLayer({
                "chatSessions.execute": (input) => chats.execute(input),
                "chatSessions.print": (input) => chats.print(input),
                "chatSessions.answer": (input) => chats.answer(input),
              }),
              RpcSerialization.layerJson,
              RpcAuthorization.layer([AuthOrchestrationOperateScope]),
              RpcInstrumentation.rpcInstrumentationLayer,
            ),
          ),
          Effect.forkScoped,
        );
        return yield* Effect.acquireUseRelease(
          sessions.markConnected(session.value.sessionId),
          () =>
            Effect.raceFirst(
              httpEffect,
              sessions
                .awaitInvalidation(session.value.sessionId)
                .pipe(Effect.as(HttpServerResponse.empty()), Effect.orDie),
            ),
          () => sessions.markDisconnected(session.value.sessionId),
        );
      }).pipe(Effect.provide(RpcSerialization.layerJson)),
    );
  }),
);
