import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, Ticket } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  EllipsisIcon,
  ReplyIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { cn } from "../../lib/utils";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AppRouteModalClose } from "../AppRouteModal";
import ChatMarkdown from "../ChatMarkdown";
import { RichActionsContext } from "../chat/RichBlocks";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { TicketAttachment, TicketImage, TicketPages } from "./TicketMedia";

export function Age(props: { iso: string }) {
  const relative = useRelativeTimeState(props.iso);
  return relative.status === "relative" ? relative.value : null;
}

export function clearedBy(ticket: Ticket) {
  if (ticket.cleared === null) return "";
  const by = ticket.cleared.by;
  if (by.type === "answered") return `Answered: ${ticket.choices[by.choiceIndex]?.label ?? ""}`;
  if (by.type === "replied") return "Replied";
  if (by.type === "acknowledged") return "Got it";
  return "Closed from chat";
}

export function Choices(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  onChoose: (index: number) => void;
}) {
  const pictures = props.ticket.choices.some((choice) => choice.image);
  return (
    <div role="group" aria-label="Choices" className="grid gap-1.5">
      {props.ticket.choices.map((choice, index) =>
        pictures ? (
          <button
            key={choice.label}
            type="button"
            onClick={() => props.onChoose(index)}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-2 pe-3 text-left transition-colors hover:border-ring/40 hover:bg-accent"
          >
            {choice.image ? (
              <TicketImage
                environmentId={props.environmentId}
                ticket={props.ticket}
                image={choice.image}
                className="aspect-4/3 w-20 shrink-0 rounded-md"
              />
            ) : (
              <span className="block aspect-4/3 w-20 shrink-0 rounded-md bg-muted" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-5 font-medium">
                <span className="me-1.5 text-muted-foreground tabular-nums">{index + 1}</span>
                {choice.label}
              </span>
              <span className="mt-0.5 block text-xs leading-4.5 text-muted-foreground">
                {choice.detail}
              </span>
            </span>
          </button>
        ) : (
          <button
            key={choice.label}
            type="button"
            onClick={() => props.onChoose(index)}
            className="grid w-full grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 rounded-md border border-border py-2 pr-3 pl-2 text-left transition-colors hover:bg-accent"
          >
            <span className="h-5 rounded-sm bg-accent text-center text-xs leading-5 text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="text-sm leading-5">{choice.label}</span>
            <span className="col-start-2 text-xs leading-4.5 text-muted-foreground">
              {choice.detail}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

function Section(props: { label: string; children: ReactNode }) {
  return (
    <section aria-label={props.label}>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{props.label}</h3>
      {props.children}
    </section>
  );
}

const TICKET_COLUMN = cn(
  "mx-auto flex max-w-3xl flex-col gap-6 px-6 pt-6 [&_.max-w-xl]:max-w-none",
  "[&_[class*=media-reply]]:block [&_[class*=media-reply]]:max-w-none [&_[class*=media-reply]>span]:w-full [&_[class*=media-reply]>span]:max-w-none",
  "[&_[class*=media-reply]_:is(img,video)]:w-full [&_[class*=media-reply]_:is(img,video)]:max-w-none [&_[class*=media-reply]_:is(img,video)]:max-h-none [&_[class*=media-reply]_:is(img,video)]:aspect-auto",
);

export function TicketWindow(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  titles: ReadonlyMap<ThreadId, string>;
  onClose: () => void;
  onChoose: (index: number) => void;
  onReply: (text: string) => void;
  onGotIt: () => void;
  inline?: boolean;
}) {
  const { environmentId, ticket, titles, onClose, inline = false } = props;
  const [reply, setReply] = useState("");
  const navigate = useNavigate();
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, { refresh: true });
  const routeRef = useThreadRouteRef();
  const open = ticket.status === "open";
  const workerId = ticket.origin.workerId;
  const goTo = (threadId: ThreadId) => {
    onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };
  const openFile = async (attachment: Ticket["attachments"][number]) => {
    const connection = readPreparedConnection(environmentId);
    const result = await createAssetUrl({
      environmentId,
      input: {
        resource: {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
        },
      },
    });
    const src =
      connection && result._tag === "Success"
        ? resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl)
        : null;
    if (src !== null) window.open(src, "_blank", "noopener");
  };
  const [quoted, setQuoted] = useState<string | null>(null);
  const send = () => {
    if (!reply.trim()) return;
    props.onReply(
      quoted === null
        ? reply.trim()
        : `${quoted
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n${reply.trim()}`,
    );
    onClose();
  };

  const header = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2 text-sm">
      {inline ? (
        <Button variant="ghost" size="sm" className="-ms-3 me-1" onClick={onClose}>
          <ArrowLeftIcon />
          Inbox
        </Button>
      ) : null}
      <span className="font-medium">{open ? ticket.group : "Archived"}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        · {titles.get(ticket.origin.chatId) ?? ""} · <Age iso={ticket.createdAt} />
        {open ? null : ` · ${clearedBy(ticket)}`}
      </span>
      {inline ? null : <AppRouteModalClose />}
    </header>
  );
  const body = (
    <>
      <div>
        {inline ? (
          <h2 className="mb-2 wrap-anywhere text-xl font-semibold leading-none">{ticket.title}</h2>
        ) : (
          <DialogTitle className="mb-2">{ticket.title}</DialogTitle>
        )}
        <p className="font-semibold leading-snug">{ticket.need}</p>
      </div>
      <Section label="What happened">
        <p className="whitespace-pre-line text-sm leading-relaxed">{ticket.summary}</p>
      </Section>
      {ticket.markdown.trim() ? (
        <Section label="Details">
          <ChatMarkdown
            text={ticket.markdown}
            cwd={undefined}
            environmentId={environmentId}
            threadRef={scopeThreadRef(environmentId, ticket.origin.threadId)}
          />
        </Section>
      ) : null}
      {open && ticket.choices.length > 0 ? (
        <Section label="Pick one">
          <Choices
            environmentId={environmentId}
            ticket={ticket}
            onChoose={(index) => {
              props.onChoose(index);
              onClose();
            }}
          />
        </Section>
      ) : null}
      {ticket.htmlPages.length > 0 ? (
        <Section label="Pages">
          <div className="grid gap-3">
            <TicketPages environmentId={environmentId} ticket={ticket} />
          </div>
        </Section>
      ) : null}
      {ticket.attachments.length > 0 ? (
        <Section label="Files">
          <div className="grid gap-3">
            {ticket.attachments.map((attachment) => (
              <TicketAttachment
                key={attachment.id}
                environmentId={environmentId}
                ticket={ticket}
                attachment={attachment}
                onOpen={() => void openFile(attachment)}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
  const replyField = useRef<HTMLTextAreaElement>(null);
  const destination = inline
    ? (titles.get(ticket.origin.chatId) ?? "")
    : (routeRef && titles.get(routeRef.threadId)) || "a new chat";
  const footer = (
    <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center px-4 pt-6 pb-4">
      <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-end gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
        {quoted !== null ? (
          <div className="flex w-full items-center gap-2 rounded-md bg-accent/60 py-1.5 ps-3 pe-1 text-xs text-muted-foreground">
            <ReplyIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{quoted.replaceAll("\n", " · ")}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Remove quote"
              onClick={() => setQuoted(null)}
            >
              <XIcon />
            </Button>
          </div>
        ) : null}
        <textarea
          ref={replyField}
          autoFocus={!inline}
          rows={1}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            send();
          }}
          placeholder={`Reply to ${destination}…`}
          aria-label={`Reply to ${ticket.title}`}
          className="field-sizing-content max-h-40 min-h-9 min-w-0 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none wrap-anywhere"
        />
        <Menu>
          <MenuTrigger
            render={<Button aria-label="More" size="icon" variant="ghost" className="shrink-0" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end" side="top" sideOffset={8}>
            <MenuItem onClick={() => goTo(ticket.origin.threadId)}>
              Open chat · {titles.get(ticket.origin.threadId) ?? ""}
            </MenuItem>
            {workerId ? (
              <MenuItem onClick={() => goTo(workerId)}>
                Open job · {titles.get(workerId) ?? ""}
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
        {reply.trim() ? (
          <Button className="shrink-0" onClick={send}>
            <ArrowUpIcon />
            Send
          </Button>
        ) : open ? (
          <Button
            className="shrink-0"
            onClick={() => {
              props.onGotIt();
              onClose();
            }}
          >
            <CheckIcon />
            Got it
          </Button>
        ) : null}
      </div>
    </div>
  );
  const richActions = {
    send: (text: string) => {
      props.onReply(text);
      onClose();
    },
    quote: (text: string) => {
      setQuoted(text);
      replyField.current?.focus();
    },
    ...(inline ? {} : { done: onClose }),
  };
  if (inline)
    return (
      <section aria-label={ticket.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
          <div className={TICKET_COLUMN}>
            <RichActionsContext value={richActions}>{body}</RichActionsContext>
          </div>
          {footer}
        </div>
      </section>
    );
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup showCloseButton={false} className="max-w-[min(71rem,92vw)] sm:max-h-[88vh]">
        {header}
        <ScrollArea scrollFade={false}>
          <div className="space-y-4">
            <div className={TICKET_COLUMN}>
              <RichActionsContext value={richActions}>{body}</RichActionsContext>
            </div>
            {footer}
          </div>
        </ScrollArea>
      </DialogPopup>
    </Dialog>
  );
}
