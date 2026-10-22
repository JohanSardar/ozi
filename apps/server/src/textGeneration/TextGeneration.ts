import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";

export type {
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "ozi/textGeneration/TextGeneration",
) {}

type TextGenerationOp = "generateThreadTitle";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  return TextGeneration.of({
    generateThreadTitle: (input) =>
      resolveInstance(registry, "generateThreadTitle", input.modelSelection.instanceId).pipe(
        Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input)),
      ),
  });
});

export const layer = Layer.effect(TextGeneration, make);
