import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { classifyMarkdownImageSource } from "@t3tools/client-runtime/markdown-images";
import type { AssetResource, ChatAttachment, EnvironmentId, Ticket } from "@t3tools/contracts";
import { filePreviewKind } from "@t3tools/shared/filePreview";
import { mediaKindFromPath } from "@t3tools/shared/mediaPreview";
import { ChevronDownIcon, FileIcon } from "lucide-react";
import { useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { ChatMarkdownAssetImage } from "../chat/ChatMarkdownMedia";
import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";

type TicketPicture = string | ChatAttachment;

const attachmentResource = (attachment: ChatAttachment) => ({
  _tag: "attachment" as const,
  attachmentId: attachment.id,
  fileName: attachment.name,
  mimeType: attachment.mimeType,
});

export function ticketThumbnail(ticket: Ticket): TicketPicture | null {
  for (const match of ticket.markdown.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)/g)) {
    const src = match[1] ?? "";
    const kind = mediaKindFromPath(src.split(/[?#]/, 1)[0] ?? "");
    if (kind === "image" || (kind === null && /^https?:/i.test(src))) return src;
  }
  return (
    ticket.choices.find((choice) => choice.image)?.image ??
    ticket.attachments.find((attachment) => attachment.mimeType.startsWith("image/")) ??
    null
  );
}

export function TicketImage(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  image: TicketPicture;
  className?: string;
}) {
  const source = typeof props.image === "string" ? classifyMarkdownImageSource(props.image) : null;
  const resource: AssetResource | null =
    typeof props.image !== "string"
      ? attachmentResource(props.image)
      : source?._tag === "WorkspaceFile"
        ? { _tag: "media-file", threadId: props.ticket.origin.threadId, path: source.path }
        : null;
  const asset = useAssetUrlState(resource ? props.environmentId : null, resource);
  const [failed, setFailed] = useState<string | null>(null);
  const src = source?._tag === "Direct" ? source.uri : asset._tag === "Success" ? asset.url : null;
  return src && failed !== src ? (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      ref={(image) => {
        if (image?.complete && image.naturalWidth === 0) setFailed(src);
      }}
      onError={() => setFailed(src)}
      className={cn("bg-muted object-cover", props.className)}
    />
  ) : (
    <span className={cn("block bg-muted", props.className)} />
  );
}

const PAGE_PREVIEW_HEIGHT = 320;

function TicketPage(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  page: Ticket["htmlPages"][number];
}) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const measure = (box: HTMLDivElement) =>
    observeResize(box, () => setTall(box.offsetHeight > PAGE_PREVIEW_HEIGHT * 1.4));
  return (
    <div>
      <p className="mb-2 text-sm leading-5 font-medium">{props.page.title}</p>
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-background px-4 py-3",
          tall && !open && "[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
        )}
        style={tall && !open ? { maxHeight: PAGE_PREVIEW_HEIGHT } : undefined}
      >
        <div ref={measure}>
          <HtmlRenderFrame
            environmentId={props.environmentId}
            htmlRender={{
              attachmentId: props.page.attachment.id,
              title: props.page.title,
              height: PAGE_PREVIEW_HEIGHT,
            }}
            threadRef={scopeThreadRef(props.environmentId, props.ticket.origin.threadId)}
          />
        </div>
      </div>
      {tall ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

export function TicketPages(props: { environmentId: EnvironmentId; ticket: Ticket }) {
  return props.ticket.htmlPages.map((page) => (
    <TicketPage
      key={page.attachment.id}
      environmentId={props.environmentId}
      ticket={props.ticket}
      page={page}
    />
  ));
}

export function TicketAttachment(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  attachment: ChatAttachment;
  onOpen: () => void;
}) {
  const { attachment, environmentId } = props;
  const kind = filePreviewKind(attachment);
  if (kind === "image")
    return (
      <ChatMarkdownAssetImage
        environmentId={environmentId}
        resource={attachmentResource(attachment)}
        alt={attachment.name}
        standalone
      />
    );
  if (["video", "audio", "pdf", "text", "markdown", "html"].includes(kind))
    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border border-border",
          kind === "audio" ? "h-28" : "h-96",
        )}
      >
        <AttachmentFilePreview
          name={attachment.name}
          mimeType={attachment.mimeType}
          sizeBytes={attachment.sizeBytes}
          asset={{ environmentId, attachmentId: attachment.id }}
          threadRef={scopeThreadRef(environmentId, props.ticket.origin.threadId)}
        />
      </div>
    );
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="flex w-full items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
    </button>
  );
}
