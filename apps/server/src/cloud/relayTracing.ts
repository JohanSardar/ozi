import {
  nodeProcessRuntimeAttributes,
  processServiceInstanceId,
} from "@t3tools/shared/observability";
import * as RelayTracing from "@t3tools/shared/relayTracing";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { resolveRelayClientTracingConfig } from "./publicConfig.ts";

const relayClientTracingConfig = resolveRelayClientTracingConfig();

const relayLayer = (resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">) =>
  Layer.unwrap(
    Effect.map(ServerConfig.ServerConfig, (config) =>
      RelayTracing.layer(relayClientTracingConfig, {
        ...resource,
        serviceInstanceId: processServiceInstanceId(config.otelEnvironment.resourceAttributes),
      }),
    ),
  );

export const layerServerRelayBroker = relayLayer({
  serviceName: "ozi-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "environment-server",
  component: "relay-broker",
});
