import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ChatAttachment, EnvironmentId, Ticket } from "@t3tools/contracts";
import { FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";

const PREVIEW_ROWS = 8;

export function TicketTextFile(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  attachment: ChatAttachment;
  markdown: boolean;
  onOpen: () => void;
}) {
  const { attachment, environmentId } = props;
  const asset = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId: attachment.id,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
  });
  const url = asset._tag === "Success" ? asset.url : null;
  const [text, setText] = useState<string | null>(null);
  const [tall, setTall] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the start of the file for its preview
  useEffect(() => {
    if (url === null) return;
    let cancelled = false;
    void fetch(url)
      .then((response) => response.text())
      .then((body) => {
        if (!cancelled) setText(body.slice(0, 6000));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  const extension = attachment.name.toLowerCase().split(".").pop();
  const separator = extension === "csv" ? "," : extension === "tsv" ? "\t" : null;
  const rows =
    text !== null && separator !== null
      ? text
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, PREVIEW_ROWS)
          .map((line, row) => ({
            key: `${row}:${line}`,
            head: row === 0,
            cells: line.split(separator).map((cell, column) => ({ key: `${column}:${cell}`, cell })),
          }))
      : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onOpen();
      }}
      className="block w-full max-w-xl cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-ring/40"
    >
      <div
        ref={(node) => {
          if (node && text !== null) setTall(node.scrollHeight > node.clientHeight + 1);
        }}
        className={cn(
          "max-h-64 overflow-hidden px-5 py-4",
          tall && "[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
        )}
      >
        {text === null ? (
          <div className="h-24" />
        ) : rows ? (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((line) => (
                <tr key={line.key} className="border-b border-border last:border-0">
                  {line.cells.map((cell) => (
                    <td
                      key={cell.key}
                      className={line.head ? "py-1.5 pe-4 font-medium" : "py-1.5 pe-4 text-muted-foreground"}
                    >
                      {cell.cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : props.markdown ? (
          <ChatMarkdown
            text={text}
            cwd={undefined}
            environmentId={environmentId}
            threadRef={scopeThreadRef(environmentId, props.ticket.origin.threadId)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        )}
      </div>
      <div className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.name}</span>
        <span className="text-xs text-muted-foreground">Open</span>
      </div>
    </div>
  );
}
