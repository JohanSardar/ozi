import { OZI_WS_METHODS, type EnvironmentId, type OziJobCard } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { subscribeDynamicWithSession, type EnvironmentRpcInput } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentSubscriptionAtomFamily,
  followStreamInEnvironment,
} from "./runtime.ts";

const noCards: readonly OziJobCard[] = [];

export function createJobsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const subscription = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "Jobs.subscribe",
    subscribe: (input: EnvironmentRpcInput<typeof OZI_WS_METHODS.jobsSubscribe>) =>
      subscribeDynamicWithSession(OZI_WS_METHODS.jobsSubscribe, () => Effect.succeed(input)),
  });
  const session = Atom.family((environmentId: EnvironmentId) =>
    runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.unwrap(
          EnvironmentSupervisor.pipe(
            Effect.map((supervisor) => SubscriptionRef.changes(supervisor.session)),
          ),
        ),
      ),
    ),
  );
  return {
    snapshot: Atom.family((environmentId: EnvironmentId) =>
      Atom.make((get) => {
        const result = get(subscription({ environmentId, input: {} }));
        const value = Option.getOrNull(AsyncResult.value(result));
        const current = Option.flatten(AsyncResult.value(get(session(environmentId))));
        return {
          cards: value?.[1] ?? noCards,
          fresh:
            result._tag === "Success" && Option.isSome(current) && value?.[0] === current.value,
          result,
        };
      }).pipe(Atom.withLabel(`Jobs.snapshot:${environmentId}`)),
    ),
    handleJob: createEnvironmentRpcCommand(runtime, {
      label: "Jobs.handle",
      tag: OZI_WS_METHODS.jobsHandle,
    }),
  };
}
