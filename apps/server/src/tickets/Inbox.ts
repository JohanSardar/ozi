import {
  CommandId,
  type InboxSnapshot,
  TicketListResult,
  MessageId,
  TicketError,
  type TicketListInput,
  type TicketReplyInput,
  type TicketResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Hex from "effect/encoding/Hex";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Tickets from "./Tickets.ts";
import * as TicketClearing from "./TicketClearing.ts";
import {
  formatComposerContextReference,
  ticketContextRecord,
} from "@t3tools/shared/composerContextReferences";

export class Inbox extends Context.Service<
  Inbox,
  {
    readonly reply: (input: TicketReplyInput) => Effect.Effect<TicketResponse, TicketError>;
    readonly watch: (
      input: TicketListInput & { readonly after?: string | undefined },
    ) => Effect.Effect<typeof InboxSnapshot.Type, TicketError>;
  }
>()("ozi/tickets/Inbox") {}

const isTicketError = Schema.is(TicketError);
const encodeList = Schema.encodeEffect(Schema.fromJsonString(TicketListResult));

const make = Effect.gen(function* () {
  const tickets = yield* Tickets.Tickets;
  const clearing = yield* TicketClearing.TicketClearing;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const failure = (cause: unknown) =>
    isTicketError(cause) ? cause : new TicketError({ reason: "delivery", cause });
  const reply = Effect.fn("Inbox.reply")(
    function* (input: TicketReplyInput) {
      const ticket = yield* tickets.get(input.id);
      const threadId = input.chatId;
      const target = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(failure));
      if (target?.lineage?.relationshipToParent === "subagent")
        return yield* new TicketError({ reason: "invalid_origin" });
      const key = yield* crypto.randomUUIDv4().pipe(Effect.mapError(failure));
      if (target === null || target.deletedAt !== null)
        return yield* new TicketError({ reason: "invalid_origin" });
      const origin = yield* threads.getThreadShell(ticket.origin.threadId);
      const chat = yield* threads.getThreadShell(ticket.origin.chatId);
      const context = ticketContextRecord({
        ticket,
        chat: chat?.title ?? "chat",
        session: origin?.title ?? "session",
        transcriptUrl: ticket.origin.transcriptPath,
      });
      const messageId = MessageId.make(`ticket:${key}`);
      const result = yield* threads.sendToThread({
        projectId: target.projectId,
        threadId,
        commandId: CommandId.make(`ticket:${key}`),
        messageId,
        text: `${formatComposerContextReference(context)}\n\n${input.text}`,
        context: { version: 1, records: [context] },
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "mcp",
      });
      return {
        ticket:
          ticket.status === "archived"
            ? ticket
            : yield* clearing.close({
                id: ticket.id,
                by: { type: "replied", threadId, messageId },
              }),
        threadId,
        messageId,
        runId: result.run.id,
      };
    },
    lock.withPermit,
    Effect.mapError(failure),
    Effect.uninterruptible,
  );

  const snapshot = Effect.fn("Inbox.snapshot")(function* (result: TicketListResult) {
    const serialized = yield* encodeList(result);
    const cursor = Hex.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(serialized)),
    );
    return { ...result, cursor };
  }, Effect.mapError(failure));
  const watch = Effect.fn("Inbox.watch")(function* (
    input: TicketListInput & { readonly after?: string | undefined },
  ) {
    const next = yield* tickets.subscribe(input).pipe(
      Stream.mapEffect(snapshot),
      Stream.filter((value) => value.cursor !== input.after),
      Stream.runHead,
      Effect.timeoutOption("20 seconds"),
    );
    return Option.isSome(next) && Option.isSome(next.value)
      ? next.value.value
      : yield* tickets.list(input).pipe(Effect.flatMap(snapshot));
  });
  return Inbox.of({ reply, watch });
});

export const layer = Layer.effect(Inbox, make);
