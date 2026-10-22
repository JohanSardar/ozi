import * as Schema from "effect/Schema";

const NodeRuntimeFeature = Schema.Literals(["Local device support", "Device automation"]);

const nodeRuntimeUnavailableMessage = (feature: typeof NodeRuntimeFeature.Type): string =>
  `${feature} requires Node.js. Install Node.js and make sure node is on PATH, then retry.`;

export class NodeRuntimeUnavailableError extends Schema.TaggedError<NodeRuntimeUnavailableError>()(
  "NodeRuntimeUnavailableError",
  { feature: NodeRuntimeFeature, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return nodeRuntimeUnavailableMessage(this.feature);
  }
}

export interface SelfInvocation {
  readonly command: string;
  /**
   * The absolute entrypoint script to place before the subcommand, or
   * undefined for the packaged binary, which dispatches subcommands from
   * argv[2] and treats a leading path as the subcommand itself.
   */
  readonly entrypoint: string | undefined;
}
