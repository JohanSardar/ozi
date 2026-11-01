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

const RichText = TrimmedNonEmptyString;
const EventTime = RichText.check(
  Schema.makeFilter(
    (value) =>
      /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))$/.test(
        value,
      ) && Number.isFinite(Date.parse(value)),
    {
      message:
        "Use an ISO date (2026-11-01) or timestamp with timezone (2026-11-01T19:30:00-06:00).",
    },
  ),
);
export const TicketRichBlocks = {
  map: Schema.Struct({
    name: RichText,
    address: RichText,
    lat: Schema.optional(
      Schema.Number.check(Schema.isGreaterThanOrEqualTo(-90), Schema.isLessThanOrEqualTo(90)),
    ),
    lon: Schema.optional(
      Schema.Number.check(Schema.isGreaterThanOrEqualTo(-180), Schema.isLessThanOrEqualTo(180)),
    ),
  }),
  event: Schema.Struct({
    title: RichText,
    start: EventTime,
    end: Schema.optional(EventTime),
    location: Schema.optional(RichText),
    notes: Schema.optional(RichText),
  }),
  draft: Schema.Struct({
    kind: Schema.Literals(["email", "message"]),
    from: Schema.optional(RichText),
    to: RichText,
    subject: Schema.optional(RichText),
    body: RichText,
  }),
  browser: Schema.Struct({
    url: RichText.check(
      Schema.makeFilter(
        (value) => {
          try {
            return ["http:", "https:"].includes(new URL(value).protocol);
          } catch {
            return false;
          }
        },
        { message: "Use a complete http:// or https:// URL." },
      ),
    ),
    label: Schema.optional(RichText),
    note: Schema.optional(RichText),
  }),
};

export const TICKET_MEDIA_GUIDE = [
  "Use closed fenced blocks: opening line ```map, ```event, ```draft or ```browser, then JSON on its own line, then ```.",
  'map: {"name":"Cafe","address":"12 Main St","lat":41.88,"lon":-87.63}; name and address required, coordinates optional.',
  'event: {"title":"Dinner","start":"2026-11-01T19:30:00-06:00","end":"2026-11-01T21:00:00-06:00","location":"Cafe","notes":"Patio"}; title/start required; ISO date or timestamp with timezone. A card proposes an event; it does not book it.',
  'draft: {"kind":"email","from":"me@example.com","to":"team@example.com","subject":"Dinner","body":"See you at seven."}; kind is email or message; from is the account or number that will send it, set it whenever known; subject optional. A draft is unsent; user Send asks the agent to send it.',
  'browser: {"url":"https://example.com/checkout","label":"Finish checkout","note":"Confirm the total"}; url required, label/note optional. Opens the shared browser for a user-only step.',
  "A URL alone on a line becomes a link card. ![Cafe](https://example.com/cafe.jpg) embeds a real photo; first image is the thumbnail. Use real photos or evidence screenshots, never illustrations, emoji, vector art or drawn placeholders; omit a picture if unavailable.",
  "![Demo](/absolute/demo.mp4) and ![Recording](/absolute/recording.wav) use app video/audio players. [Report](/absolute/report.pdf) opens a file; PDF, docx, xlsx, csv, md and txt attachments open the in-app file sheet. Use actual uploaded attachment IDs, never invented IDs.",
  'Choices are numbered by the app: {"label":"Choose Cafe","detail":"Patio at seven","image":"https://example.com/cafe.jpg"}; up to four, omit numbers in labels; use real photos for visual choices.',
  'htmlPages: [{"title":"Cafe wins on price and availability","attachment":{"type":"file","id":"uploaded_id","name":"comparison.html","mimeType":"text/html","sizeBytes":123}}]. Title states the takeaway; page repeats no title. Transparent background, app fonts, responsive one column about 768px, no scrollbars, no viewport heights. Prefer native cards for places/events/drafts/browser steps.',
].join(" ");

export const TicketMarkdown = Schema.String.check(
  Schema.makeFilter((markdown) => {
    const fence =
      /^[ \t]{0,3}(`{3,}|~{3,})(map|event|draft|browser)[ \t]*\r?\n([\s\S]*?)(?:^[ \t]{0,3}\1[ \t]*$|(?![\s\S]))/gm;
    for (const match of markdown.matchAll(fence)) {
      const kind = match[2] as keyof typeof TicketRichBlocks;
      const schema = TicketRichBlocks[kind];
      try {
        Schema.decodeUnknownSync(schema)(JSON.parse(match[3] ?? ""));
        if (!match[0].trimEnd().endsWith(match[1]!))
          return `${kind} block: close the JSON fence with ${match[1]}.`;
      } catch (error) {
        return `${kind} block: ${String(error)}`;
      }
    }
    return true;
  }),
).annotate({ description: TICKET_MEDIA_GUIDE });

export const TicketId = TrimmedNonEmptyString.pipe(Schema.brand("TicketId"));
export type TicketId = typeof TicketId.Type;

export const TicketGroup = Schema.Literals(["Decide", "Do", "Review", "Read"]);
export const TicketChoice = Schema.Struct({
  label: TrimmedNonEmptyString.annotate({
    description: 'A short action in plain words, e.g. "Book Nella at 7:30".',
  }),
  detail: TrimmedNonEmptyString.annotate({
    description: "One plain line on what happens if the user picks it.",
  }),
  image: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Optional real photo of this option (never an illustration or drawn placeholder): an absolute file path or https URL, e.g. a photo of the restaurant or the product. Give every choice one when the options are things to look at.",
    }),
  ),
});
export const TicketHtmlPage = Schema.Struct({
  title: TrimmedNonEmptyString.annotate({
    description:
      "The page's takeaway in a few words, readable at a glance, e.g. 'Piccolo Sogno leads: best rated, free at 7:30', not 'Restaurant comparison'. The page itself repeats no title.",
  }),
  attachment: Schema.Struct({
    ...ChatFileAttachment.fields,
    mimeType: Schema.Literal("text/html"),
  }),
});
export const TICKET_WRITING =
  "Write it like a short note to a busy person who wasn't watching: plain everyday words, short sentences, no jargon. Leave out IDs, error codes, check names, tool names, file paths and commands unless the user needs one to act; then give just that one.";

export const TicketContent = Schema.Struct({
  group: TicketGroup,
  title: TrimmedNonEmptyString.annotate({
    description:
      'What happened or what\'s needed, like a good email subject: "Your habit tracker is ready to try", "Pick a restaurant for tonight". Never internal names like "sleep 30 job finished".',
  }),
  need: TrimmedNonEmptyString.annotate({
    description:
      "One plain sentence saying exactly what the user should do, or that there is nothing to do.",
  }),
  summary: TrimmedNonEmptyString.annotate({
    description:
      "Two to four short plain sentences: what happened, why it matters and anything the user should know before acting.",
  }),
  choices: Schema.Array(TicketChoice).check(Schema.isMaxLength(4)),
  markdown: TicketMarkdown,
  attachments: Schema.Array(ChatAttachment).annotate({
    description:
      'Uploaded file references: {"type":"file","id":"uploaded_id","name":"report.pdf","mimeType":"application/pdf","sizeBytes":123}. Images/video/audio use app viewers; PDF/docx/xlsx/csv/md/txt open in the file sheet.',
  }),
  htmlPages: Schema.Array(TicketHtmlPage).annotate({
    description:
      "Uploaded HTML pages with takeaway titles. Repeat no title inside; transparent background, app fonts, responsive column about 768px, no scrollbars or viewport heights.",
  }),
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
  markdown: Schema.String,
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
    markdown: Schema.optionalKey(TicketMarkdown),
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
  text: TrimmedNonEmptyString.annotate({
    description:
      'Reply in chatId. To quote a card, prefix its visible text with Markdown > lines, a blank line, then your reply, e.g. "> Cafe, 12 Main St\\n\\nIs there parking?".',
  }),
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
