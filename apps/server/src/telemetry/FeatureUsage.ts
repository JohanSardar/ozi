import {
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  WS_METHODS,
} from "@t3tools/contracts";

export interface FeatureUsage {
  readonly feature: string;
  readonly variant?: string;
}

type Payload = Readonly<Record<string, unknown>>;

const literal = (payload: Payload, key: string) =>
  typeof payload[key] === "string" ? (payload[key] as string) : undefined;

const use = (feature: string, variant?: string): FeatureUsage =>
  variant === undefined ? { feature } : { feature, variant };

/**
 * User commands sent through `orchestration.dispatchCommand` that represent a
 * feature choice. Housekeeping commands (visits, reorders, acknowledgements)
 * and `message.dispatch`, which `client.turn.requested` already counts, are
 * left out.
 */
const COMMAND_FEATURES: Partial<
  Record<OrchestrationV2Command["type"], (command: Payload) => FeatureUsage>
> = {
  "thread.fork": () => ({ feature: "thread.fork" }),
  "thread.merge_back": () => ({ feature: "thread.merge_back" }),
  "provider.switch": () => ({ feature: "provider.switch" }),
  "thread.archive": () => ({ feature: "thread.archive" }),
  "thread.snooze": () => ({ feature: "thread.snooze" }),
  "thread.pin": () => ({ feature: "thread.pin" }),
  "thread.settle": () => ({ feature: "thread.settle" }),
  "thread.runtime-mode.set": (command) =>
    use("thread.runtime_mode.set", literal(command, "runtimeMode")),
  "thread.interaction-mode.set": (command) =>
    use("thread.interaction_mode.set", literal(command, "interactionMode")),
  "run.interrupt": () => ({ feature: "run.interrupt" }),
  "queued-message.promote-to-steer": () => ({ feature: "queue.steer" }),
  "queued-run.edit": () => ({ feature: "queue.edit" }),
};

/**
 * RPCs that represent a user starting a feature. Variants come only from
 * closed enums in the contracts, so no path, id, or free text can reach analytics.
 */
const METHOD_FEATURES: Readonly<Record<string, (payload: Payload) => FeatureUsage>> = {
  [ORCHESTRATION_V2_WS_METHODS.launchThread]: (payload) => {
    const strategy = payload.workspaceStrategy;
    return use(
      "thread.launch",
      typeof strategy === "object" && strategy !== null
        ? literal(strategy as Payload, "type")
        : undefined,
    );
  },
  [WS_METHODS.previewOpen]: () => ({ feature: "preview.open" }),
  [WS_METHODS.shellOpenInEditor]: (payload) => use("editor.open", literal(payload, "editor")),
  [WS_METHODS.scheduledTasksUpsert]: () => ({ feature: "scheduled_task.save" }),
  [WS_METHODS.scheduledTasksRunNow]: () => ({ feature: "scheduled_task.run_now" }),
  [WS_METHODS.serverUpsertKeybinding]: () => ({ feature: "keybinding.customize" }),
};

/** The feature a WebSocket request uses, or undefined when it is not a tracked feature. */
export function featureUsage(method: string, payload: unknown): FeatureUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const input = payload as Payload;
  if (method === ORCHESTRATION_V2_WS_METHODS.dispatchCommand) {
    const type = literal(input, "type") as OrchestrationV2Command["type"] | undefined;
    return type === undefined ? undefined : COMMAND_FEATURES[type]?.(input);
  }
  return METHOD_FEATURES[method]?.(input);
}
