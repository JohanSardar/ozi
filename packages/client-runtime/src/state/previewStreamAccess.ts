/**
 * `<img>`, `EventSource`, and `WebSocket` cannot set bearer or DPoP headers, so bearer and DPoP
 * connections mint a short-lived WebSocket ticket and pass it as `wsTicket`, the same way the
 * app's own `/ws` upgrade authenticates. Callers fetch a fresh one each time they (re)connect a
 * stream.
 */
import * as Effect from "effect/Effect";
import type { HttpClient } from "effect/http";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import type { RemoteEnvironmentRequestError } from "../rpc/http.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import type { PreviewStreamAccess } from "../preview/streamAccess.ts";

export { type PreviewStreamAccess } from "../preview/streamAccess.ts";

const TICKET_TIMEOUT_MS = 8_000;

export const resolvePreviewStreamAccess = Effect.fn(
  "clientRuntime.state.resolvePreviewStreamAccess",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly hubBasePath: string;
}): Effect.fn.Return<PreviewStreamAccess, RemoteEnvironmentRequestError, HttpClient.HttpClient> {
  const httpBase = environmentEndpointUrl(input.prepared.httpBaseUrl, input.hubBasePath);
  const wsBase = httpBase.replace(/^http/, "ws");
  if (input.prepared.httpAuthorization === null) {
    return { httpBase, wsBase, query: {}, credentials: true };
  }
  const ticket = yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared: input.prepared,
    group: "auth",
    url: (urls) => urls.webSocketTicket(),
    timeoutMs: TICKET_TIMEOUT_MS,
    request: ({ client, headers }) => client.webSocketTicket({ headers }),
  });
  return {
    httpBase,
    wsBase,
    query: { wsTicket: ticket.ticket },
    credentials: false,
  };
});
