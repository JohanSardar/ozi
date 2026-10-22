import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/http-api/OpenApi";
import * as Schema from "effect/Schema";

import { RelayApi, RelayEnvironmentLinkUnavailableError } from "./relay.ts";

const decodeLinkUnavailableError = Schema.decodeUnknownSync(RelayEnvironmentLinkUnavailableError);

describe("relay provisioning error compatibility", () => {
  it("preserves a stage introduced by a newer relay", () => {
    const error = {
      _tag: "RelayEnvironmentLinkUnavailableError",
      code: "environment_link_unavailable",
      reason: "managed_endpoint_provisioning_failed",
      provisioningStage: "future-provisioning-stage",
      traceId: "trace-1",
    };

    expect(decodeLinkUnavailableError(error)).toMatchObject(error);
  });
});

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});
