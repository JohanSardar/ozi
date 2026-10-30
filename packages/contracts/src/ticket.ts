import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  MessageId,
  NodeId,
  NonNegativeInt,
  ProviderSessionId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatAttachment, ChatFileAttachment } from "./chatAttachment.ts";

export const TicketId = TrimmedNonEmptyString.pipe(Schema.brand("TicketId"));
export type TicketId = typeof TicketId.Type;

export const TicketGroup = Schema.Literals(["Decide", "Do", "Review", "Read"]);
export const TicketChoice = Schema.Struct({
  label: TrimmedNonEmptyString,
  detail: TrimmedNonEmptyString,
});
export const TicketHtmlPage = Schema.Struct({
  title: TrimmedNonEmptyString,
  attachment: Schema.Struct({
    ...ChatFileAttachment.fields,
    mimeType: Schema.Literal("text/html"),
  }),
});
export const TicketContent = Schema.Struct({
  group: TicketGroup,
  title: TrimmedNonEmptyString,
  need: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  choices: Schema.Array(TicketChoice).check(Schema.isMaxLength(4)),
  markdown: Schema.String,
  attachments: Schema.Array(ChatAttachment),
  htmlPages: Schema.Array(TicketHtmlPage),
});
export const TicketOrigin = Schema.Struct({
  threadId: ThreadId,
  chatId: ThreadId,
  jobId: Schema.NullOr(NodeId),
  workerId: Schema.NullOr(ThreadId),
  sessionId: Schema.NullOr(ProviderSessionId),
  messageId: Schema.NullOr(MessageId),
  transcriptPath: TrimmedNonEmptyString,
});
export const TicketClearance = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("answered"),
    threadId: ThreadId,
    messageId: MessageId,
    choiceIndex: NonNegativeInt.check(Schema.isLessThan(4)),
  }),
  Schema.Struct({ type: Schema.Literal("replied"), threadId: ThreadId, messageId: MessageId }),
  Schema.Struct({ type: Schema.Literal("acknowledged") }),
  Schema.Struct({ type: Schema.Literal("agent"), threadId: ThreadId, messageId: MessageId }),
]);
const ticketFields = {
  id: TicketId,
  ...TicketContent.fields,
  origin: TicketOrigin,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
};
export const Ticket = Schema.Union([
  Schema.Struct({ ...ticketFields, status: Schema.Literal("open"), cleared: Schema.Null }),
  Schema.Struct({
    ...ticketFields,
    status: Schema.Literal("archived"),
    cleared: Schema.Struct({ at: IsoDateTime, by: TicketClearance }),
  }),
]);
export type Ticket = typeof Ticket.Type;
export const TicketCreateInput = Schema.Struct({
  ...TicketContent.fields,
  threadId: ThreadId,
  sessionId: Schema.optional(ProviderSessionId),
  messageId: Schema.optional(MessageId),
});
export type TicketCreateInput = typeof TicketCreateInput.Type;
export const TicketUpdateInput = Schema.Struct({
  id: TicketId,
  changes: Schema.Struct({
    group: Schema.optionalKey(TicketGroup),
    title: Schema.optionalKey(TrimmedNonEmptyString),
    need: Schema.optionalKey(TrimmedNonEmptyString),
    summary: Schema.optionalKey(TrimmedNonEmptyString),
    choices: Schema.optionalKey(TicketContent.fields.choices),
    markdown: Schema.optionalKey(Schema.String),
    attachments: Schema.optionalKey(TicketContent.fields.attachments),
    htmlPages: Schema.optionalKey(TicketContent.fields.htmlPages),
  }),
});
export type TicketUpdateInput = typeof TicketUpdateInput.Type;
export const TicketCloseInput = Schema.Struct({
  id: TicketId,
  by: TicketClearance,
  chatId: Schema.optional(ThreadId),
});
export type TicketCloseInput = typeof TicketCloseInput.Type;
export const TicketChooseInput = Schema.Struct({
  id: TicketId,
  choiceIndex: NonNegativeInt.check(Schema.isLessThan(4)),
  chatId: Schema.optional(ThreadId),
});
export type TicketChooseInput = typeof TicketChooseInput.Type;
export const TicketGetInput = Schema.Struct({ id: TicketId });
export const TicketListInput = Schema.Struct({
  status: Schema.optional(Schema.Literals(["open", "archived", "all"])),
  search: Schema.optional(TrimmedNonEmptyString),
  chatId: Schema.optional(ThreadId),
});
export type TicketListInput = typeof TicketListInput.Type;
export const TicketListResult = Schema.Struct({ tickets: Schema.Array(Ticket) });
export type TicketListResult = typeof TicketListResult.Type;
export class TicketError extends Schema.TaggedError<TicketError>()("TicketError", {
  reason: Schema.Literals([
    "not_found",
    "archived",
    "invalid_origin",
    "invalid_clearance",
    "storage",
    "delivery",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Ticket operation failed (${this.reason}).`;
  }
}

export const TicketReplyInput = Schema.Struct({
  id: TicketId,
  chatId: ThreadId,
  text: TrimmedNonEmptyString,
});
export type TicketReplyInput = typeof TicketReplyInput.Type;
export const TicketResponse = Schema.Struct({
  ticket: Ticket,
  threadId: ThreadId,
  messageId: MessageId,
  runId: RunId,
});
export type TicketResponse = typeof TicketResponse.Type;
export const InboxRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("list"), input: TicketListInput }),
  Schema.Struct({ action: Schema.Literal("get"), input: TicketGetInput }),
  Schema.Struct({ action: Schema.Literal("create"), input: TicketCreateInput }),
  Schema.Struct({ action: Schema.Literal("update"), input: TicketUpdateInput }),
  Schema.Struct({ action: Schema.Literal("close"), input: TicketCloseInput }),
  Schema.Struct({ action: Schema.Literal("choose"), input: TicketChooseInput }),
  Schema.Struct({ action: Schema.Literal("reply"), input: TicketReplyInput }),
  Schema.Struct({
    action: Schema.Literal("watch"),
    input: Schema.Struct({ ...TicketListInput.fields, after: Schema.optional(Schema.String) }),
  }),
]);
export type InboxRequest = typeof InboxRequest.Type;
export const InboxSnapshot = Schema.Struct({ ...TicketListResult.fields, cursor: Schema.String });
export const InboxResult = Schema.Union([Ticket, TicketResponse, InboxSnapshot, TicketListResult]);
