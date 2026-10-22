import {
  ProviderInstanceId,
  ProviderSetupError,
  type OrchestrationV2ProviderCapabilities,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Option from "effect/Option";
import * as RepairTasks from "../ozi/RepairTasks.ts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { ProviderAdapterDriverCreateError } from "@t3tools/provider-core/server/adapterDriver";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const isProviderSetupError = Schema.is(ProviderSetupError);

export class ProviderAdapterRegistryLookupError extends Schema.TaggedError<ProviderAdapterRegistryLookupError>()(
  "ProviderAdapterRegistryLookupError",
  {
    instanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return `No orchestration provider adapter is registered for ${this.instanceId}.`;
  }
}

export class ProviderAdapterRegistryMetadataError extends Schema.TaggedError<ProviderAdapterRegistryMetadataError>()(
  "ProviderAdapterRegistryMetadataError",
  { instanceId: ProviderInstanceId, cause: Schema.Defect() },
) {}

export const ProviderAdapterRegistryV2Error = Schema.Union([
  ProviderAdapterRegistryLookupError,
  ProviderAdapterRegistryMetadataError,
  ProviderAdapterDriverCreateError,
]);
export type ProviderAdapterRegistryV2Error = typeof ProviderAdapterRegistryV2Error.Type;

export interface ProviderAdapterRegistryV2Shape {
  readonly get: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapter.ProviderAdapterV2["Service"], ProviderAdapterRegistryV2Error>;
  readonly list: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  readonly getMetadata?: (instanceId: ProviderInstanceId) => Effect.Effect<
    {
      readonly driver: ProviderAdapter.ProviderAdapterV2["Service"]["driver"];
      readonly continuationKey: string;
      readonly enabled: boolean;
      readonly capabilities: OrchestrationV2ProviderCapabilities;
    },
    ProviderAdapterRegistryV2Error
  >;
}

export class ProviderAdapterRegistryV2 extends Context.Service<
  ProviderAdapterRegistryV2,
  ProviderAdapterRegistryV2Shape
>()("t3/orchestration-v2/ProviderAdapterRegistry/ProviderAdapterRegistryV2") {}

export const layerFromProviderInstanceRegistry: Layer.Layer<
  ProviderAdapterRegistryV2,
  never,
  ProviderInstanceRegistry.ProviderInstanceRegistry
> = Layer.effect(
  ProviderAdapterRegistryV2,
  Effect.gen(function* () {
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    return ProviderAdapterRegistryV2.of({
      get: (instanceId) =>
        instances.getInstance(instanceId).pipe(
          Effect.flatMap((instance) => {
            if (instance === undefined)
              return new ProviderAdapterRegistryLookupError({ instanceId });
            const original = instance.orchestrationAdapter;
            const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
              ...original,
              openSession: Effect.fn("ProviderAdapterRegistry.openSession")(function* (input) {
                const repair = yield* Effect.serviceOption(RepairTasks.RepairTasks);
                if (Option.isSome(repair)) {
                  const confined = yield* repair.value.open(input, original);
                  if (confined) return confined;
                }
                if (RepairTasks.isRepairThread(input.threadId))
                  return yield* new ProviderAdapter.ProviderAdapterProtocolError({
                    driver: original.driver,
                    detail: "Confined repair runtime is unavailable",
                  });
                return yield* original.openSession(input);
              }),
            };
            const auth = instance.auth;
            if (!auth) return Effect.succeed(adapter);
            return Effect.succeed({
              ...adapter,
              openSession: (input) => {
                const open = Effect.gen(function* () {
                  const binding = auth.credentialBinding;
                  const related = binding
                    ? (yield* instances.listInstances).filter(
                        (instance) =>
                          instance.auth?.credentialBinding?.key === binding.key &&
                          instance.auth.credentialBinding.owner === binding.owner,
                      )
                    : [instance];
                  for (const instance of related) {
                    if (
                      instance.auth?.isChangingCredentials &&
                      (yield* instance.auth.isChangingCredentials)
                    )
                      return yield* new ProviderSetupError({
                        instanceId,
                        operation: "session",
                        detail: "This provider's sign-in is changing. Try again after it finishes.",
                      });
                  }
                  let admitted: Effect.Effect<
                    ProviderAdapter.ProviderAdapterV2SessionRuntime,
                    ProviderAdapter.ProviderAdapterV2Error | ProviderSetupError,
                    Scope.Scope
                  > = adapter.openSession(input);
                  // Shared credential changes must interrupt a peer's startup too.
                  for (const peer of related) {
                    if (peer.auth?.withAccess) admitted = peer.auth.withAccess(admitted);
                  }
                  return yield* admitted;
                });
                return open.pipe(
                  Effect.mapError((cause) =>
                    isProviderSetupError(cause)
                      ? new ProviderAdapter.ProviderAdapterOpenSessionError({
                          driver: adapter.driver,
                          providerSessionId: input.providerSessionId,
                          cause,
                        })
                      : cause,
                  ),
                );
              },
            } satisfies ProviderAdapter.ProviderAdapterV2["Service"]);
          }),
        ),
      list: () =>
        instances.listInstances.pipe(
          Effect.map((available) => available.map((instance) => instance.instanceId)),
        ),
      getMetadata: Effect.fn("ProviderAdapterRegistry.getMetadata")(function* (instanceId) {
        const instance = yield* instances.getInstance(instanceId);
        if (instance === undefined) {
          return yield* new ProviderAdapterRegistryLookupError({ instanceId });
        }
        const capabilities = yield* instance.orchestrationAdapter
          .getCapabilities()
          .pipe(
            Effect.mapError(
              (cause) => new ProviderAdapterRegistryMetadataError({ instanceId, cause }),
            ),
          );
        return {
          driver: instance.driverKind,
          continuationKey: instance.continuationIdentity.continuationKey,
          enabled: instance.enabled,
          capabilities,
        };
      }),
    });
  }),
);

export const ProviderAdapterRegistryBuildError = Schema.Union([ProviderAdapterDriverCreateError]);
export type ProviderAdapterRegistryBuildError = typeof ProviderAdapterRegistryBuildError.Type;
