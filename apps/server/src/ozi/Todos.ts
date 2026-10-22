import { OziTodo, OziTodoSettings, type OziTodos } from "@t3tools/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerSettingsService } from "../serverSettings.ts";
import { OziClock } from "./Clock.ts";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown));
const decodeTodo = Schema.decodeUnknownEffect(OziTodo);
const encodeSettings = Schema.encodeEffect(Schema.fromJsonString(OziTodoSettings));

const field = (input: unknown, path: string): unknown =>
  path === ""
    ? input
    : path
        .split(".")
        .reduce<unknown>(
          (value, key) => (Predicate.isObject(value) ? value[key] : undefined),
          input,
        );

const fetchItems = (settings: OziTodoSettings) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => new Client({ name: "ozi-todos", version: "1" })),
        (client) => Effect.promise(() => client.close()).pipe(Effect.ignoreCause),
      );
      const server = settings.server;
      const transport =
        server.type === "stdio"
          ? new StdioClientTransport({
              command: server.command,
              ...(server.args === undefined ? {} : { args: [...server.args] }),
              ...(server.env === undefined ? {} : { env: { ...server.env } }),
              stderr: "ignore",
            })
          : new StreamableHTTPClientTransport(new URL(server.url), {
              requestInit: { headers: server.headers ?? {} },
            });
      yield* Effect.tryPromise(() => client.connect(transport as Parameters<Client["connect"]>[0]));
      const result = yield* Effect.tryPromise(() =>
        client.callTool({ name: settings.tool, arguments: { ...settings.arguments } }),
      );
      if (result.isError) return yield* Effect.fail("To-do source failed.");
      const content =
        result.structuredContent ??
        (yield* decodeJson(
          Array.isArray(result.content)
            ? result.content
                .filter((item) => item.type === "text")
                .map((item) => item.text)
                .join("")
            : "",
        ));
      const rows = yield* decodeRows(field(content, settings.itemsPath));
      const items = yield* Effect.forEach(rows, (row) =>
        decodeTodo({
          id: field(row, settings.fields.id),
          title: field(row, settings.fields.title),
          link: field(row, settings.fields.link) ?? null,
          status: field(row, settings.fields.status),
          due: settings.fields.due === undefined ? null : (field(row, settings.fields.due) ?? null),
        }),
      );
      if (new Set(items.map((item) => item.id)).size !== items.length)
        return yield* Effect.fail("Duplicate to-do IDs.");
      return items;
    }),
  ).pipe(Effect.timeout("5 seconds"));

export class Todos extends Context.Service<
  Todos,
  {
    readonly fetch: Effect.Effect<OziTodos>;
  }
>()("ozi/ozi/Todos") {}

export const layer = Layer.effect(
  Todos,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const clock = yield* OziClock;
    const permit = yield* Semaphore.make(1);
    let key = "";
    let last: OziTodos = null;
    const fetch = Effect.gen(function* () {
      const config = yield* settings.getSettings.pipe(Effect.map((value) => value.externalTodos));
      if (config === null) {
        key = "";
        last = null;
        return null;
      }
      const nextKey = yield* encodeSettings(config);
      if (key !== nextKey) last = null;
      key = nextKey;
      const attemptedAt = DateTime.formatIso(yield* clock.now);
      const result = yield* Effect.result(fetchItems(config));
      last =
        result._tag === "Success"
          ? {
              source: config.source,
              state: "available",
              items: result.success,
              fetchedAt: attemptedAt,
              attemptedAt,
            }
          : {
              source: config.source,
              state: last?.items === null || last === null ? "unavailable" : "stale",
              items: last?.items ?? null,
              fetchedAt: last?.fetchedAt ?? null,
              attemptedAt,
            };
      return last;
    }).pipe(
      Effect.orElseSucceed(() => last),
      permit.withPermits(1),
    );
    return { fetch };
  }),
);
