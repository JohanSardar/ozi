import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_PROTOCOL_QUERY_PARAM,
  TicketCloseInput,
  TicketChooseInput,
  TicketCreateInput,
  TicketGetInput,
  TicketListInput,
  TicketUpdateInput,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag, GlobalFlag } from "effect/cli";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { baseDirFlag, resolveCliAuthConfig } from "./config.ts";
import { ThreadServerNotRunningError } from "./thread.ts";

const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;
const print = (value: unknown) => Console.log(JSON.stringify(value));
const run = Effect.fn("cli.ticket")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  operation: (client: Client) => Effect.Effect<A, E, R>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  return yield* Effect.gen(function* () {
    const state = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(state))
      return yield* new ThreadServerNotRunningError({ baseDir: config.baseDir });
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* Effect.acquireRelease(
      auth.issueSession({ label: "ozi ticket cli" }),
      (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
    );
    const url = new URL("/ws", state.value.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(
      ORCHESTRATION_PROTOCOL_QUERY_PARAM,
      String(ORCHESTRATION_PROTOCOL_VERSION),
    );
    return yield* Effect.gen(function* () {
      const client = yield* makeClient;
      return yield* operation(client);
    }).pipe(
      Effect.provide(
        RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
          Layer.provide(
            NodeSocket.layerWebSocket(url.href, {
              headers: { authorization: `Bearer ${session.token}` },
            }),
          ),
          Layer.provide(RpcSerialization.layerJson),
        ),
      ),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
      ),
    ),
  );
});

const flags = {
  baseDir: baseDirFlag,
  input: Flag.String("input").pipe(Flag.withDefault("{}"), Flag.withDescription("JSON request.")),
  json: Flag.Boolean("json").pipe(Flag.withDefault(true)),
};
const command = <S extends Schema.Decoder<unknown>, E, R>(
  name: string,
  schema: S,
  operation: (client: Client, input: S["Type"]) => Effect.Effect<unknown, E, R>,
) =>
  Command.make(name, flags).pipe(
    Command.withHandler((input) =>
      Schema.decodeEffect(Schema.fromJsonString(schema))(input.input).pipe(
        Effect.flatMap((payload) => run(input, (client) => operation(client, payload))),
      ),
    ),
  );

export const ticketCommand = Command.make("ticket").pipe(
  Command.withDescription(
    "Create, update, archive and watch structured inbox tickets. All output is JSON.",
  ),
  Command.withSubcommands([
    command("create", TicketCreateInput, (client, input) =>
      client["tickets.create"](input).pipe(Effect.flatMap(print)),
    ),
    command("update", TicketUpdateInput, (client, input) =>
      client["tickets.update"](input).pipe(Effect.flatMap(print)),
    ),
    command("choose", TicketChooseInput, (client, input) =>
      client["tickets.choose"](input).pipe(Effect.flatMap(print)),
    ),
    command("close", TicketCloseInput, (client, input) =>
      client["tickets.close"](input).pipe(Effect.flatMap(print)),
    ),
    command("get", TicketGetInput, (client, input) =>
      client["tickets.get"](input).pipe(Effect.flatMap(print)),
    ),
    command("list", TicketListInput, (client, input) =>
      client["tickets.list"](input).pipe(Effect.flatMap(print)),
    ),
    command("subscribe", TicketListInput, (client, input) =>
      client["tickets.subscribe"](input).pipe(Stream.runForEach(print)),
    ),
  ]),
);
