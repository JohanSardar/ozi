import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, Ticket } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { assetEnvironment } from "../../state/assets";
import { readPreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { buildThreadRouteParams } from "../../threadRoutes";
import { AppRouteModalClose } from "../AppRouteModal";
import ChatMarkdown from "../ChatMarkdown";
import { HtmlRenderDialog } from "../chat/HtmlRenderDialog";
import { Button } from "../ui/button";
import { Dialog, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";

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

export function Choices(props: { ticket: Ticket; onChoose: (index: number) => void }) {
  return (
    <div role="group" aria-label="Choices" className="grid gap-1.5">
      {props.ticket.choices.map((choice, index) => (
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
      ))}
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
}) {
  const { environmentId, ticket, titles, onClose } = props;
  const [reply, setReply] = useState("");
  const [page, setPage] = useState<{ src: string; title: string } | null>(null);
  const navigate = useNavigate();
  const createAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, { refresh: true });
  const routeRef = useThreadRouteRef();
  const open = ticket.status === "open";
  const workerId = ticket.origin.workerId;
  const files = [
    ...ticket.htmlPages.map((page) => ({ title: page.title, attachment: page.attachment })),
    ...ticket.attachments.map((attachment) => ({ title: attachment.name, attachment })),
  ];
  const goTo = (threadId: ThreadId) => {
    onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };
  const openFile = async (file: (typeof files)[number]) => {
    const connection = readPreparedConnection(environmentId);
    const result = await createAssetUrl({
      environmentId,
      input: {
        resource: {
          _tag: "attachment",
          attachmentId: file.attachment.id,
          fileName: file.attachment.name,
          mimeType: file.attachment.mimeType,
        },
      },
    });
    const src =
      connection && result._tag === "Success"
        ? resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl)
        : null;
    if (src === null) return;
    if (file.attachment.mimeType === "text/html") setPage({ src, title: file.title });
    else window.open(src, "_blank", "noopener");
  };
  const send = () => {
    if (!reply.trim()) return;
    props.onReply(reply.trim());
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup showCloseButton={false} className="max-w-190 sm:max-h-[86vh]">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2 text-sm">
          <span className="font-medium">{open ? ticket.group : "Archived"}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            · {titles.get(ticket.origin.chatId) ?? ""} · <Age iso={ticket.createdAt} />
            {open ? null : ` · ${clearedBy(ticket)}`}
          </span>
          <AppRouteModalClose />
        </header>
        <DialogPanel>
          <div>
            <DialogTitle className="mb-2">{ticket.title}</DialogTitle>
            <p className="font-semibold leading-snug">{ticket.need}</p>
          </div>
          <Section label="What happened">
            <p className="whitespace-pre-line text-sm leading-relaxed">{ticket.summary}</p>
          </Section>
          {ticket.markdown.trim() ? (
            <Section label="Details">
              <ChatMarkdown text={ticket.markdown} cwd={undefined} />
            </Section>
          ) : null}
          {open && ticket.choices.length > 0 ? (
            <Section label="Pick one">
              <Choices
                ticket={ticket}
                onChoose={(index) => {
                  props.onChoose(index);
                  onClose();
                }}
              />
            </Section>
          ) : null}
          {files.length > 0 ? (
            <Section label="Files">
              <div className="grid gap-1.5">
                {files.map((file) => (
                  <Source
                    key={file.attachment.id}
                    label={file.title}
                    detail={file.attachment.name}
                    onClick={() => void openFile(file)}
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
        </DialogPanel>
        <footer className="shrink-0 border-t px-4 pt-3 pb-4">
          <p className="mx-1 mb-2 text-xs text-muted-foreground">
            Your reply goes to{" "}
            <b className="font-medium text-foreground">
              {(routeRef && titles.get(routeRef.threadId)) || "New chat"}
            </b>{" "}
            with this ticket attached
          </p>
          <div className="flex items-end gap-2">
            <Textarea
              autoFocus
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
              className="flex-1 [&_textarea]:min-h-9"
            />
            <Button disabled={!reply.trim()} onClick={send}>
              Send
            </Button>
            {open ? (
              <Button
                variant="outline"
                onClick={() => {
                  props.onGotIt();
                  onClose();
                }}
              >
                Got it
              </Button>
            ) : null}
          </div>
        </footer>
        {page ? (
          <HtmlRenderDialog src={page.src} title={page.title} onClose={() => setPage(null)} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
