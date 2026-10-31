import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, Ticket } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowUpIcon, CheckIcon, ReplyIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AppRouteModalClose } from "../AppRouteModal";
import ChatMarkdown from "../ChatMarkdown";
import { RichActionsContext } from "../chat/RichBlocks";
import { Button } from "../ui/button";
import { Dialog, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";
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
    <div
      role="group"
      aria-label="Choices"
      className={
        pictures ? "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2" : "grid gap-1.5"
      }
    >
      {props.ticket.choices.map((choice, index) =>
        pictures ? (
          <button
            key={choice.label}
            type="button"
            onClick={() => props.onChoose(index)}
            className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-ring/40 hover:bg-accent"
          >
            {choice.image ? (
              <TicketImage
                environmentId={props.environmentId}
                ticket={props.ticket}
                image={choice.image}
                className="aspect-video w-full"
              />
            ) : (
              <span className="block aspect-video w-full bg-muted" />
            )}
            <span className="absolute top-1.5 left-1.5 h-5 min-w-5 rounded-sm bg-background/85 px-1 text-center text-xs leading-5 text-muted-foreground tabular-nums backdrop-blur">
              {index + 1}
            </span>
            <span className="px-2.5 pt-2 text-sm leading-5 font-medium">{choice.label}</span>
            <span className="px-2.5 pb-2.5 text-xs leading-4.5 text-muted-foreground">
              {choice.detail}
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

function Source(props: { label: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="truncate text-xs text-muted-foreground">{props.detail}</span>
    </button>
  );
}

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
  const send = () => {
    if (!reply.trim()) return;
    props.onReply(reply.trim());
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
      <Section label="Sources">
        <div className="grid gap-1.5">
          <Source
            label="Session transcript"
            detail={titles.get(ticket.origin.threadId) ?? ""}
            onClick={() => goTo(ticket.origin.threadId)}
          />
          {workerId ? (
            <Source
              label={`Job · ${titles.get(workerId) ?? ""}`}
              detail="Worker"
              onClick={() => goTo(workerId)}
            />
          ) : null}
        </div>
      </Section>
    </>
  );
  const footer = (
    <footer className="shrink-0 border-t px-4 pt-3 pb-4">
      <p className="mx-1 mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ReplyIcon className="size-3.5" />
        <span className="shrink-0">Your reply goes to</span>
        <b className="min-w-0 truncate font-medium text-foreground">
          {inline
            ? (titles.get(ticket.origin.chatId) ?? "")
            : (routeRef && titles.get(routeRef.threadId)) || "New chat"}
        </b>
        <span className="shrink-0">with this ticket attached</span>
      </p>
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            autoFocus={!inline}
            rows={1}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              send();
            }}
            placeholder="Reply…"
            aria-label={`Reply to ${ticket.title}`}
            className="[&_textarea]:min-h-9 [&_textarea]:pe-9"
          />
          {reply.trim() ? (
            <Button
              size="icon-xs"
              aria-label="Send reply"
              className="absolute end-1.5 bottom-1.5"
              onClick={send}
            >
              <ArrowUpIcon />
            </Button>
          ) : null}
        </div>
        {open ? (
          <Button
            variant="outline"
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
    </footer>
  );
  const richActions = {
    send: (text: string) => {
      props.onReply(text);
      onClose();
    },
    ...(inline ? {} : { done: onClose }),
  };
  if (inline)
    return (
      <section aria-label={ticket.title} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
            <RichActionsContext value={richActions}>{body}</RichActionsContext>
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl">{footer}</div>
      </section>
    );
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup showCloseButton={false} className="max-w-190 sm:max-h-[86vh]">
        {header}
        <DialogPanel>
          <RichActionsContext value={richActions}>{body}</RichActionsContext>
        </DialogPanel>
        {footer}
      </DialogPopup>
    </Dialog>
  );
}
