import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";

export const layer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span: (options) => new Tracer.NativeSpan(options),
  }),
);
