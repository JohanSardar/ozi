import type { MessageId, ProviderSessionId, RunId, TicketError } from "@t3tools/contracts";
import type { McpProviderSessionConfig } from "@t3tools/provider-core/server/mcpSession";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { TicketListResult } from "@t3tools/contracts";
import * as Tickets from "./Tickets.ts";

export class InboxChecks extends Context.Service<
  InboxChecks,
  {
    readonly prepare: (input: {
      readonly source: McpProviderSessionConfig;
      readonly sessionId: ProviderSessionId;
      readonly messageId: MessageId;
      readonly runId: RunId;
    }) => Effect.Effect<
      {
        readonly config: McpProviderSessionConfig;
        readonly prompt: string;
        readonly filed: Set<string>;
        readonly close: Effect.Effect<void>;
      },
      TicketError
    >;
  }
>()("ozi/tickets/InboxChecks") {}

const encodeList = Schema.encodeEffect(Schema.fromJsonString(TicketListResult));

const make = Effect.gen(function* () {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const tickets = yield* Tickets.Tickets;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  return InboxChecks.of({
    prepare: Effect.fn("InboxChecks.prepare")(function* (input) {
      const source = yield* projections
        .getThreadRecords(input.source.threadId, ["messages"])
        .pipe(Effect.orDie);
      const messageId =
        source.messages.findLast(
          (message) => message.role === "user" && message.runId === input.runId,
        )?.id ?? input.messageId;
      const open = yield* tickets.list({});
      const listed = yield* encodeList(open).pipe(Effect.orDie);
      const filed = new Set<string>();
      const { config } = yield* registry.issue({
        threadId: input.source.threadId,
        providerInstanceId: input.source.providerInstanceId,
        browserToolsAvailable: false,
        inboxCheck: { sessionId: input.sessionId, messageId, filed },
      });
      return {
        config,
        filed,
        close: registry.revokeProviderSession(config.providerSessionId),
        prompt: `Inbox check. You are an isolated fork of the agent's completed turn. Do not continue its task or reply to the user.
Use ticket_create, ticket_update, ticket_close and ticket_list only.
File a ticket, with everything in it, for anything from this turn that needs the user's answer or acknowledgement: a question, approval, something only the user can do, finished result, failure, or something the user should see. Skip small talk. File nothing if nothing fits.
Include the group (Decide, Do, Review or Read), short title, one line saying what the user needs to do, a 2–4 line summary, up to four labelled choices with one-line details when useful, and full markdown details, attachments and HTML pages. Put all the information in the ticket so the user can act without reading the chat.
Do not duplicate an existing ticket; update it when needed. Close the listed open tickets that the user's last message acknowledged. Do not treat silence or viewing as acknowledgement.
Listed open tickets:
${listed}`,
      };
    }),
  });
});

export const layer = Layer.effect(InboxChecks, make);
