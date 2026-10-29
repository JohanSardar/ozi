import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

export class ScheduleClockError extends Schema.TaggedError<ScheduleClockError>()(
  "ScheduleClockError",
  { reason: Schema.Literals(["disabled", "invalid_advance"]) },
) {}

type ScheduleClockService = {
  readonly enabled: boolean;
  readonly now: Effect.Effect<DateTime.Zoned>;
  readonly onAdvance: (run: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>;
  readonly advance: (milliseconds: number) => Effect.Effect<string, ScheduleClockError>;
};

export class ScheduleClock extends Context.Reference<ScheduleClockService>(
  "ozi/scheduling/ScheduleClock",
  {
    defaultValue: () => ({
      enabled: false,
      now: DateTime.withCurrentZoneLocal(DateTime.nowInCurrentZone),
      onAdvance: () => Effect.void,
      advance: () => Effect.fail(new ScheduleClockError({ reason: "disabled" })),
    }),
  },
) {}

export const layer = Layer.effect(
  ScheduleClock,
  Effect.gen(function* () {
    const configured = yield* Config.String("OZI_TEST_CLOCK").pipe(Config.option);
    if (Option.isNone(configured)) return yield* ScheduleClock;
    const initial = DateTime.make(configured.value);
    if (Option.isNone(initial)) return yield* Effect.die(new Error("Invalid OZI_TEST_CLOCK."));
    const time = yield* Ref.make(DateTime.toEpochMillis(initial.value));
    const callbacks = yield* Ref.make(new Map<symbol, Effect.Effect<void>>());
    return {
      enabled: true,
      now: Ref.get(time).pipe(
        Effect.map((value) =>
          DateTime.makeZonedUnsafe(value, { timeZone: DateTime.zoneMakeLocal() }),
        ),
      ),
      onAdvance: (run) => {
        const id = Symbol();
        return Effect.acquireRelease(
          Ref.update(callbacks, (current) => new Map(current).set(id, run)),
          () =>
            Ref.update(callbacks, (current) => {
              const next = new Map(current);
              next.delete(id);
              return next;
            }),
        );
      },
      advance: Effect.fn("ScheduleClock.advance")(function* (milliseconds: number) {
        const current = yield* Ref.get(time);
        if (
          !Number.isSafeInteger(milliseconds) ||
          milliseconds <= 0 ||
          Option.isNone(DateTime.make(current + milliseconds))
        ) {
          return yield* new ScheduleClockError({ reason: "invalid_advance" });
        }
        const next = yield* Ref.updateAndGet(time, (value) => value + milliseconds);
        yield* Effect.forEach((yield* Ref.get(callbacks)).values(), (run) => run, {
          discard: true,
        });
        return DateTime.formatIso(DateTime.makeUnsafe(next));
      }),
    } satisfies ScheduleClockService;
  }),
);
