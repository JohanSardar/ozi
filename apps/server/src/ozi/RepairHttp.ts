import { AuthOrchestrationReadScope, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as Repair from "./Repair.ts";

const Query = Schema.Struct({
  kind: Schema.Literals(["mistakes", "replays", "fixes", "undo", "events", "wait"]),
  id: Schema.optional(Schema.String),
  entity: Schema.optional(Schema.Literals(["mistake", "replay", "fix"])),
});

const decodeQuery = Schema.decodeUnknownEffect(Query);
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const layer = HttpRouter.add(
  "POST",
  "/api/ozi/repair",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request);
    if (!session.scopes.includes(AuthOrchestrationReadScope))
      return HttpServerResponse.empty({ status: 403 });
    const query = yield* request.json.pipe(Effect.flatMap(decodeQuery));
    const repair = yield* Repair.Repair;
    if (query.kind === "undo") {
      if (!session.scopes.includes(AuthOrchestrationOperateScope))
        return HttpServerResponse.empty({ status: 403 });
      return HttpServerResponse.jsonUnsafe(yield* repair.undo(query.id ?? ""));
    }
    if (query.kind === "fixes") return HttpServerResponse.jsonUnsafe(yield* repair.fixes());
    if (query.kind === "events")
      return HttpServerResponse.jsonUnsafe(yield* repair.events(query.id ?? "ozi-main"));
    if (query.kind === "replays") return HttpServerResponse.jsonUnsafe(yield* repair.replays());
    if (query.kind === "mistakes")
      return HttpServerResponse.jsonUnsafe(yield* repair.mistakes(query.id));
    return HttpServerResponse.stream(
      repair.subscribe(query.entity ?? "replay", query.id ?? "").pipe(
        Stream.mapEffect((row) => encodeJson(row)),
        Stream.map((row) => row + "\n"),
        Stream.encodeText,
      ),
      { contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store" } },
    );
  }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
);
