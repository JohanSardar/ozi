import { OziClockError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { ServerConfig } from "../config.ts";

const realNow = DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone);

export class OziClock extends Context.Reference<{
  readonly now: Effect.Effect<DateTime.Zoned>;
  readonly advance: (milliseconds: number) => Effect.Effect<string, OziClockError>;
}>("ozi/Clock", {
  defaultValue: () => ({
    now: realNow,
    advance: () => Effect.fail(new OziClockError({ detail: "Test clock is disabled." })),
  }),
}) {}

export const layer = Layer.effect(
  OziClock,
  Effect.gen(function* () {
    const { testClock } = yield* ServerConfig;
    if (testClock === undefined) return yield* OziClock;
    const start = DateTime.make(testClock);
    if (Option.isNone(start)) return yield* Effect.die("Invalid OZI_TEST_CLOCK.");
    const zone = (yield* realNow).zone;
    const time = yield* Ref.make(DateTime.toEpochMillis(start.value));
    return {
      now: Ref.get(time).pipe(Effect.map((at) => DateTime.makeZonedUnsafe(at, { timeZone: zone }))),
      advance: (milliseconds: number) =>
        Ref.updateAndGet(time, (at) => at + milliseconds).pipe(
          Effect.map((at) => DateTime.formatIso(DateTime.makeUnsafe(at))),
        ),
    };
  }),
);
