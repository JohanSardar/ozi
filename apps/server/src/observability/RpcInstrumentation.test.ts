import { describe } from "@effect/vitest";

import { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";

type WsRpcMethod = keyof typeof RPC_REQUIRED_SCOPES;

describe("WS RPC instrumentation middleware", () => {});
