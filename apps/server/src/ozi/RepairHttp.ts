import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as Repair from "./Repair.ts";
import type { Mistake, Replay, RepairError } from "./RepairModel.ts";

const Query = Schema.Struct({
  kind: Schema.Literals(["mistakes", "replays", "events", "wait"]),
  id: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  entity: Schema.optional(Schema.Literals(["mistake", "replay"])),
});

const decodeQuery = Schema.decodeUnknownEffect(Query);

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
    if (query.kind === "events")
      return HttpServerResponse.jsonUnsafe(yield* repair.events(query.id ?? "ozi-main"));
    if (query.kind === "replays") return HttpServerResponse.jsonUnsafe(yield* repair.replays());
    if (query.kind === "mistakes")
      return HttpServerResponse.jsonUnsafe(yield* repair.mistakes(query.id));
    const rows: Effect.Effect<ReadonlyArray<Mistake | Replay>, RepairError> = query.entity ===
    "mistake"
      ? repair.mistakes(query.id)
      : repair.replays();
    const result = yield* rows.pipe(
      Effect.repeat({
        schedule: Schedule.spaced("50 millis"),
        until: (values) =>
          values.some(
            (row) =>
              row.id === query.id && ("status" in row ? row.status : row.state) === query.state,
          ),
      }),
      Effect.timeout(`${Math.min(120, Math.max(1, query.timeout ?? 30))} seconds`),
    );
    return HttpServerResponse.jsonUnsafe(result.find((row) => row.id === query.id));
  }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
);
