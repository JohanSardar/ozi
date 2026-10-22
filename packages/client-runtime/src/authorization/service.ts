import type { ClientConnectionMethod, EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import { environmentMismatchError, mapRemoteEnvironmentError } from "../connection/errors.ts";
import type { ConnectionAttemptError, PreparedHttpAuthorization } from "../connection/model.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import * as ClientCapabilities from "../platform/capabilities.ts";
import { resolveRemoteWebSocketConnectionUrl } from "./remote.ts";

export interface AuthorizedRemoteEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: PreparedHttpAuthorization;
}
export class RemoteEnvironmentAuthorization extends Context.Service<
  RemoteEnvironmentAuthorization,
  {
    readonly authorizeBearer: (input: {
      readonly expectedEnvironmentId: EnvironmentId;
      readonly httpBaseUrl: string;
      readonly wsBaseUrl: string;
      readonly bearerToken: string;
      readonly connectionMethod: ClientConnectionMethod;
    }) => Effect.Effect<AuthorizedRemoteEnvironment, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/authorization/service/RemoteEnvironmentAuthorization") {}
export const make = Effect.gen(function* () {
  const presentation = yield* ClientCapabilities.ClientPresentation;
  const httpClient = yield* HttpClient.HttpClient;
  return RemoteEnvironmentAuthorization.of({
    authorizeBearer: Effect.fn("connection.authorizeBearer")(
      function* (input) {
        const descriptor = yield* fetchRemoteEnvironmentDescriptor({
          httpBaseUrl: input.httpBaseUrl,
        }).pipe(Effect.mapError(mapRemoteEnvironmentError));
        if (descriptor.environmentId !== input.expectedEnvironmentId)
          return yield* environmentMismatchError({
            expected: input.expectedEnvironmentId,
            actual: descriptor.environmentId,
          });
        const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
          httpBaseUrl: input.httpBaseUrl,
          wsBaseUrl: input.wsBaseUrl,
          bearerToken: input.bearerToken,
          clientMetadata: presentation.metadata,
          connectionMethod: input.connectionMethod,
        }).pipe(Effect.mapError(mapRemoteEnvironmentError));
        return {
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          httpBaseUrl: input.httpBaseUrl,
          socketUrl,
          httpAuthorization: { _tag: "Bearer" as const, token: input.bearerToken },
        };
      },
      Effect.provideService(HttpClient.HttpClient, httpClient),
    ),
  });
});
export const layer = Layer.effect(RemoteEnvironmentAuthorization, make);
