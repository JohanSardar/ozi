import * as Schema from "effect/Schema";

import {
  ApprovalRequestId,
  ClientSurface,
  IsoDateTime,
  ProviderItemId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import type { OrchestrationV2StoredEvent } from "./orchestrationV2.ts";

export const OrchestrationClientOrigin = Schema.Struct({
  surface: Schema.optional(ClientSurface),
  appVersion: Schema.optional(TrimmedNonEmptyString),
});
export type OrchestrationClientOrigin = typeof OrchestrationClientOrigin.Type;

export const ApplicationEventMetadata = Schema.Struct({
  deferredTurn: Schema.optional(Schema.Boolean),
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
  origin: Schema.optional(OrchestrationClientOrigin),
});
export type ApplicationEventMetadata = typeof ApplicationEventMetadata.Type;

export type ApplicationStoredEvent = OrchestrationV2StoredEvent;
