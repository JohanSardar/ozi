import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "./endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiGroupClient } from "../rpc/http.ts";

const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 10_000;

export const fetchRemoteEnvironmentDescriptor = Effect.fn(
  "clientRuntime.environment.fetchRemoteEnvironmentDescriptor",
)(function* (input: { readonly httpBaseUrl: string; readonly timeoutMs?: number }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "metadata");
  const timeoutMs = input.timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS;
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/.well-known/t3/environment"),
    timeoutMs,
    client.descriptor(),
  ).pipe(
    Effect.catch(() =>
      executeEnvironmentHttpRequest(
        environmentEndpointUrl(input.httpBaseUrl, "/.well-known/ozi/environment"),
        timeoutMs,
        client.oziDescriptor(),
      ),
    ),
  );
});
