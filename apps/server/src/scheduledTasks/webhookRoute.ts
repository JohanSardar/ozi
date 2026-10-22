import { EnvironmentHttpApi } from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";
const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const json = (status: number, body: Record<string, string>, outcome: string) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "x-ozi-hook-outcome": outcome } });
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "webhooks",
  Effect.fnUntraced(function* (handlers) {
    const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
    const handler = Effect.fnUntraced(function* ({
      params,
      request,
    }: {
      readonly params: { readonly hookId: string; readonly token: string };
      readonly request: HttpServerRequest.HttpServerRequest;
    }) {
      const contentLength = Number(request.headers["content-length"] ?? "0");
      if (!Number.isFinite(contentLength) || contentLength > WEBHOOK_MAX_BODY_BYTES)
        return json(413, { error: "body_too_large" }, "body_too_large");
      const body = yield* request.arrayBuffer.pipe(
        Effect.map((value) => new Uint8Array(value)),
        Effect.provideService(
          HttpIncomingMessage.MaxBodySize,
          ByteSize.bytes(WEBHOOK_MAX_BODY_BYTES),
        ),
        Effect.option,
      );
      if (Option.isNone(body) || body.value.byteLength > WEBHOOK_MAX_BODY_BYTES)
        return json(413, { error: "body_too_large_or_unreadable" }, "body_too_large");
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers))
        if (typeof value === "string") headers[name.toLowerCase()] = value;
      const queryIndex = request.url.indexOf("?");
      const result = yield* scheduledTasks
        .triggerWebhook({
          hookId: params.hookId,
          token: params.token,
          method: request.method,
          path: ScheduledTaskService.WEBHOOK_ROUTE_PREFIX + "/" + encodeURIComponent(params.hookId),
          query: queryIndex === -1 ? "" : request.url.slice(queryIndex + 1),
          headers,
          body: body.value,
          bodyText: new TextDecoder().decode(body.value),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Webhook delivery failed", { cause }).pipe(
              Effect.as({ _tag: "error" as const }),
            ),
          ),
        );
      switch (result._tag) {
        case "accepted":
          return json(202, { deliveryId: result.deliveryId }, result.outcome);
        case "not_found":
          return json(404, { error: "hook_not_found" }, "not_found");
        case "rejected_signature":
          return json(401, { error: "invalid_signature" }, "rejected_signature");
        case "disabled":
          return json(409, { error: "hook_disabled" }, "disabled");
        case "rate_limited":
          return json(429, { error: result.outcome }, result.outcome);
        case "error":
          return json(500, { error: "internal_error" }, "error");
      }
    });
    return handlers
      .handleRaw("webhookPost", handler)
      .handleRaw("webhookPut", handler)
      .handleRaw("webhookPatch", handler)
      .handleRaw("webhookGet", handler);
  }),
);
