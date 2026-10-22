import { type ScheduledTaskWebhookFilterOp } from "@t3tools/contracts";

/**
 * One editable filter row. `in` takes a comma-separated list, which is
 * lossless because list values can't contain commas; `exists` ignores the value.
 */
export interface WebhookFilterDraft {
  /** Stable row identity for the form; never sent to the server. */
  readonly id: string;
  readonly path: string;
  readonly op: ScheduledTaskWebhookFilterOp;
  readonly value: string;
}
