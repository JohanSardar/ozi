import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import type { PreparedConnection } from "../connection/model.ts";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
  makeEnvironmentHttpApiUrlBuilder,
} from "../rpc/http.ts";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
}
export function withOrchestrationProtocolHeader(headers: EnvironmentHttpAuthHeaders) {
  return {
    ...headers,
    [ORCHESTRATION_PROTOCOL_HEADER]:
      ORCHESTRATION_PROTOCOL_VERSION_TEXT as typeof ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  };
}
export const executeAuthenticatedEnvironmentHttpRequest = Effect.fnUntraced(function* <
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
>(input: {
  readonly prepared: PreparedConnection;
  readonly url: (urls: ReturnType<typeof makeEnvironmentHttpApiUrlBuilder>[Group]) => string;
  readonly timeoutMs: number;
  readonly group: Group;
  readonly request: (input: {
    readonly client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>>;
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
}) {
  const baseUrl = input.prepared.httpBaseUrl;
  const url = input.url(makeEnvironmentHttpApiUrlBuilder(baseUrl)[input.group]);
  const client = yield* makeEnvironmentHttpApiGroupClient(baseUrl, input.group);
  const authorization = input.prepared.httpAuthorization;
  const headers: EnvironmentHttpAuthHeaders =
    authorization === null ? {} : { authorization: "Bearer " + authorization.token };
  const request = input.request({ client, headers });
  return yield* executeEnvironmentHttpRequest(
    url,
    input.timeoutMs,
    authorization === null
      ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
      : request,
  );
});
