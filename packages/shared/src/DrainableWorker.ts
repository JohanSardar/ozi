import * as Effect from "effect/Effect";

export interface DrainableWorker<A> {
  readonly enqueue: (item: A) => Effect.Effect<void>;

  readonly drain: Effect.Effect<void>;
}
