import type { ChatAttachment, EnvironmentId } from "@t3tools/contracts";
import { FileTextIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { openPdf } from "../files/pdfDocument";

export default function TicketPdf(props: {
  environmentId: EnvironmentId;
  attachment: ChatAttachment;
  onOpen: () => void;
}) {
  const asset = useAssetUrlState(props.environmentId, {
    _tag: "attachment",
    attachmentId: props.attachment.id,
    fileName: props.attachment.name,
    mimeType: props.attachment.mimeType,
  });
  const url = asset._tag === "Success" ? asset.url : null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- renders the first PDF page into the preview canvas
  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    let task: ReturnType<typeof openPdf> | undefined;
    void (async () => {
      const bytes = await (await fetch(url)).arrayBuffer();
      if (cancelled) return;
      task = openPdf(bytes);
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const target = canvas.current;
      if (cancelled || !target) return;
      const viewport = page.getViewport({ scale: 1200 / page.getViewport({ scale: 1 }).width });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      await page.render({ canvas: target, viewport, background: "white" }).promise;
      if (!cancelled) setPages(pdf.numPages);
    })().catch(() => {});
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="group block w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-ring/40"
    >
      <span className="flex h-80 items-center justify-center overflow-hidden bg-muted p-6">
        <canvas
          ref={canvas}
          aria-label={props.attachment.name}
          className="max-h-full max-w-full rounded-sm bg-white shadow-lg transition-transform duration-200 group-hover:-translate-y-0.5"
        />
      </span>
      <span className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.attachment.name}</span>
        <span className="text-xs text-muted-foreground">
          {pages === null ? "PDF" : `${pages} ${pages === 1 ? "page" : "pages"}`} · Open
        </span>
      </span>
    </button>
  );
}
