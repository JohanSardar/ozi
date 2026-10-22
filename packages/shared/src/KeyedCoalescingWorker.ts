import * as Effect from "effect/Effect";

export interface KeyedCoalescingWorker<K, V> {
  readonly enqueue: (key: K, value: V) => Effect.Effect<void>;
  readonly drainKey: (key: K) => Effect.Effect<void>;
}
