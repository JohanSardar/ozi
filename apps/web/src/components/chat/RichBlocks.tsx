import { useAtomValue } from "@effect/atom-react";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  ReplyIcon,
  SendIcon,
} from "lucide-react";
import { createContext, use, useState, type ReactNode } from "react";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentQuery } from "../../state/query";
import { linkPreview } from "../../state/tickets";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { openTerminalLinkInPreview } from "../preview/openTerminalLinkInPreview";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export const RichActionsContext = createContext<{
  readonly send?: (text: string) => void;
  readonly done?: () => void;
  readonly quote?: (text: string) => void;
}>({});

const Text = TrimmedNonEmptyString;
const MapBlock = Schema.Struct({
  name: Text,
  address: Text,
  lat: Schema.optional(Schema.Number),
  lon: Schema.optional(Schema.Number),
});
const EventBlock = Schema.Struct({
  title: Text,
  start: Text,
  end: Schema.optional(Text),
  location: Schema.optional(Text),
  notes: Schema.optional(Text),
});
const DraftBlock = Schema.Struct({
  kind: Schema.Literals(["email", "message"]),
  to: Text,
  subject: Schema.optional(Text),
  body: Text,
});
const BrowserBlock = Schema.Struct({
  url: Text.check(Schema.isPattern(/^https?:\/\//i)),
  label: Schema.optional(Text),
  note: Schema.optional(Text),
});

function card<S extends Schema.Decoder<unknown>>(
  schema: S,
  code: string,
  render: (value: S["Type"]) => ReactNode,
): ReactNode | null {
  try {
    return Option.match(Schema.decodeUnknownOption(schema)(JSON.parse(code)), {
      onNone: () => null,
      onSome: render,
    });
  } catch {
    return null;
  }
}

export function richBlock(language: string, code: string): ReactNode | null {
  if (language === "map") return card(MapBlock, code, (value) => <MapCard {...value} />);
  if (language === "event") return card(EventBlock, code, (value) => <EventCard {...value} />);
  if (language === "draft") return card(DraftBlock, code, (value) => <DraftCard {...value} />);
  if (language === "browser")
    return card(BrowserBlock, code, (value) => <BrowserCard {...value} />);
  return null;
}

const CARD_CLASS =
  "group/card relative my-3 max-w-xl rounded-[10px] border border-border bg-card text-card-foreground transition-colors";

function HoverAction(props: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function Card(props: {
  children: ReactNode;
  summary: string;
  onOpen?: (() => void) | undefined;
  className?: string;
}) {
  const { quote } = use(RichActionsContext);
  const [copied, setCopied] = useState(false);
  const { onOpen } = props;
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && event.target === event.currentTarget && event.key === "Enter") onOpen();
      }}
      className={cn(CARD_CLASS, onOpen && "cursor-pointer hover:border-ring/40", props.className)}
    >
      <div className="pointer-events-none absolute -top-4 end-2 z-10 flex gap-0.5 rounded-lg border border-border bg-popover p-0.5 opacity-0 shadow-md transition-opacity group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100">
        {quote ? (
          <HoverAction icon={<ReplyIcon />} label="Reply" onClick={() => quote(props.summary)} />
        ) : null}
        {onOpen ? <HoverAction icon={<ExternalLinkIcon />} label="Open" onClick={onOpen} /> : null}
        <HoverAction
          icon={copied ? <CheckIcon /> : <CopyIcon />}
          label={copied ? "Copied" : "Copy"}
          onClick={() => {
            void navigator.clipboard.writeText(props.summary);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        />
      </div>
      <div className="overflow-hidden rounded-[inherit]">{props.children}</div>
    </div>
  );
}

function Heading(props: { icon: ReactNode; title: string; detail?: string | undefined }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">{props.icon}</span>
      <span className="min-w-0">
        <span className="block font-medium leading-snug">{props.title}</span>
        {props.detail ? (
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {props.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function MapCard(props: typeof MapBlock.Type) {
  const query =
    props.lat !== undefined && props.lon !== undefined
      ? `${props.lat},${props.lon}`
      : props.address;
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${props.name}, ${props.address}`)}`;
  return (
    <Card
      summary={`${props.name}, ${props.address}`}
      onOpen={() => window.open(href, "_blank", "noopener")}
    >
      <div className="relative h-44 overflow-hidden border-b border-border">
        <iframe
          title={`Map of ${props.name}`}
          src={`https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`}
          loading="lazy"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          className="pointer-events-none absolute inset-x-0 -top-14 h-[calc(100%+7rem)] w-full border-0"
        />
      </div>
      <div className="p-3">
        <Heading icon={<MapPinIcon />} title={props.name} detail={props.address} />
      </div>
    </Card>
  );
}

const dateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const icsTime = (value: string) =>
  dateOnly(value)
    ? `;VALUE=DATE:${value.replaceAll("-", "")}`
    : `:${new Date(value)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`;
const icsText = (value: string) => value.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

function downloadIcs(event: typeof EventBlock.Type) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ozi//EN",
    "BEGIN:VEVENT",
    `UID:${btoa(encodeURIComponent(`${event.start}${event.title}`)).slice(0, 48)}@ozi`,
    `DTSTAMP${icsTime(new Date().toISOString())}`,
    `DTSTART${icsTime(event.start)}`,
    ...(event.end ? [`DTEND${icsTime(event.end)}`] : []),
    `SUMMARY:${icsText(event.title)}`,
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    ...(event.notes ? [`DESCRIPTION:${icsText(event.notes)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.replace(/[^\w -]+/g, "").trim() || "event"}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function EventCard(props: typeof EventBlock.Type) {
  const start = new Date(props.start);
  const valid = !Number.isNaN(start.getTime());
  const allDay = dateOnly(props.start);
  const end = props.end ? new Date(props.end) : null;
  const time = (date: Date) => date.toLocaleTimeString(undefined, { timeStyle: "short" });
  const when = valid
    ? `${start.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        ...(allDay ? { timeZone: "UTC" } : {}),
      })}${
        allDay ? "" : ` · ${time(start)}${end && !Number.isNaN(end.getTime()) ? `–${time(end)}` : ""}`
      }`
    : props.start;
  return (
    <Card
      summary={[props.title, when, props.location].filter(Boolean).join(" · ")}
      onOpen={valid ? () => downloadIcs(props) : undefined}
    >
      <div className="flex gap-3.5 p-3.5">
        {valid ? (
          <div className="flex w-14 shrink-0 flex-col items-center self-start overflow-hidden rounded-md border border-border bg-background">
            <span className="w-full bg-primary py-0.5 text-center text-3xs font-semibold tracking-wide text-primary-foreground uppercase">
              {start.toLocaleDateString(undefined, {
                month: "short",
                ...(allDay ? { timeZone: "UTC" } : {}),
              })}
            </span>
            <span className="py-1 text-xl font-semibold leading-none tabular-nums">
              {start.toLocaleDateString(undefined, {
                day: "numeric",
                ...(allDay ? { timeZone: "UTC" } : {}),
              })}
            </span>
          </div>
        ) : null}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium leading-snug">{props.title}</p>
          <p className="text-muted-foreground">{when}</p>
          {props.location ? <p className="text-muted-foreground">{props.location}</p> : null}
          {props.notes ? (
            <p className="mt-1.5 text-xs text-muted-foreground">{props.notes}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const draftReply = (lead: string, draft: typeof DraftBlock.Type, body: string) =>
  [
    lead,
    "",
    `To: ${draft.to}`,
    ...(draft.subject ? [`Subject: ${draft.subject}`] : []),
    "",
    ...body.split("\n").map((line) => `> ${line}`),
  ].join("\n");

function DraftCard(props: typeof DraftBlock.Type) {
  const { send } = use(RichActionsContext);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.body);
  const [sent, setSent] = useState(false);
  const submit = () => {
    if (!send || !body.trim()) return;
    send(
      body === props.body
        ? draftReply("Send it as written:", props, props.body)
        : draftReply("Send this edited version:", props, body.trim()),
    );
    setEditing(false);
    setSent(true);
  };
  const editor = (
    <Textarea
      autoFocus
      value={body}
      onChange={(event) => setBody(event.target.value)}
      aria-label="Edit draft"
      className="[&_textarea]:min-h-32"
    />
  );
  const actions = send ? (
    <div className="flex items-center justify-end gap-1.5">
      {sent ? <span className="me-auto text-xs text-muted-foreground">Sent to Ozi</span> : null}
      {editing ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setBody(props.body);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <PencilIcon />
          Edit
        </Button>
      )}
      <Button size="sm" onClick={submit} disabled={!body.trim()}>
        <SendIcon />
        Send
      </Button>
    </div>
  ) : null;
  const summary = [`To ${props.to}`, props.subject, body].filter(Boolean).join("\n");
  if (props.kind === "message")
    return (
      <Card summary={summary}>
        <div className="border-b border-border px-4 py-2.5 text-center">
          <span className="mx-auto mb-1 flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {props.to.slice(0, 1).toUpperCase()}
          </span>
          <span className="text-xs text-muted-foreground">{props.to}</span>
        </div>
        <div className="flex flex-col items-end gap-2 px-4 py-4">
          {editing ? (
            <div className="w-full">{editor}</div>
          ) : (
            <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground">
              {body}
            </p>
          )}
          <span className="text-2xs text-muted-foreground">{sent ? "Sent to Ozi" : "Not sent"}</span>
        </div>
        {actions ? <div className="border-t border-border px-3 py-2">{actions}</div> : null}
      </Card>
    );
  return (
    <Card summary={summary}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <MailIcon className="size-3.5" />
        New email
      </div>
      <dl className="divide-y divide-border border-b border-border px-4 text-sm">
        <div className="flex gap-3 py-2">
          <dt className="w-14 shrink-0 text-muted-foreground">To</dt>
          <dd className="min-w-0 truncate">{props.to}</dd>
        </div>
        {props.subject ? (
          <div className="flex gap-3 py-2">
            <dt className="w-14 shrink-0 text-muted-foreground">Subject</dt>
            <dd className="min-w-0 font-medium">{props.subject}</dd>
          </div>
        ) : null}
      </dl>
      <div className="px-4 py-3.5">
        {editing ? editor : <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>}
      </div>
      {actions ? <div className="border-t border-border px-3 py-2">{actions}</div> : null}
    </Card>
  );
}

function BrowserCard(props: typeof BrowserBlock.Type) {
  const { done } = use(RichActionsContext);
  const threadRef = useThreadRouteRef();
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const host = URL.parse(props.url)?.hostname.replace(/^www\./, "") ?? props.url;
  const fallbackToBrowser = () => window.open(props.url, "_blank", "noopener");
  const open = () => {
    done?.();
    if (!threadRef) return fallbackToBrowser();
    void openTerminalLinkInPreview({
      url: props.url,
      threadRef,
      openPreview,
      fallbackToBrowser,
      forceBrowser: false,
      forceApp: true,
    });
  };
  return (
    <Card summary={`${props.label ?? host}: ${props.url}`} onOpen={open}>
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <Heading icon={<GlobeIcon />} title={props.label ?? host} detail={props.note ?? host} />
        </div>
        <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5" />
      </div>
    </Card>
  );
}

export function LinkCard(props: { url: string; children: ReactNode }) {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const preview = useEnvironmentQuery(
    environmentId ? linkPreview({ environmentId, input: { url: props.url } }) : null,
  ).data;
  if (!preview?.title) return <p>{props.children}</p>;
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noreferrer"
      className="my-3 flex max-w-xl overflow-hidden rounded-[10px] border border-border bg-card text-card-foreground no-underline transition-colors hover:border-ring/40"
    >
      <span className="min-w-0 flex-1 p-3">
        <span className="block truncate text-xs text-muted-foreground">{preview.site}</span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-medium leading-snug text-foreground">
          {preview.title}
        </span>
        {preview.description ? (
          <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
            {preview.description}
          </span>
        ) : null}
      </span>
      {preview.image ? (
        <img
          src={preview.image}
          alt=""
          referrerPolicy="no-referrer"
          className="w-32 shrink-0 border-s border-border object-cover"
        />
      ) : null}
    </a>
  );
}
