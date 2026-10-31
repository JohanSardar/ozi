import { AudioStrip } from "../media/AudioStrip";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeFileHighlights } from "./fileSheetHighlights";
import { useState, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowUpIcon,
  BoldIcon,
  ItalicIcon,
  HeadingIcon,
  ListIcon,
  LinkIcon,
  HighlighterIcon,
  MessageSquareIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  DownloadIcon,
  CopyIcon,
  ExternalLinkIcon,
  PencilIcon,
  XIcon,
  CheckIcon,
  UndoIcon,
} from "lucide-react";
import {
  WS_METHODS,
  type AttachmentVersion,
  type AttachmentVersionNote,
  type AttachmentVersionsInput,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn, randomUUID } from "~/lib/utils";
import VirtualTablePreview from "./VirtualTablePreview";
import { PREVIEW_PAGE_ROWS } from "./largeTextProtocol";
import PdfViewer from "./PdfViewer";
import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { type FileSheetTarget } from "./fileSheetState";
import {
  readEditable,
  writeEditable,
  fromBase64,
  toBase64,
  type EditableFile,
} from "./fileSheetFormats";

const versionsCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "file-sheet:versions",
  tag: WS_METHODS.attachmentVersions,
});
const actionClass =
  "flex shrink-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-foreground/10 disabled:opacity-40";

export function FileSheet({ target, onClose }: { target: FileSheetTarget; onClose: () => void }) {
  const refresh = useAssetUrlRefresh(target.environmentId ?? null, target.resource ?? null);
  const runVersions = useAtomCommand(versionsCommand, { reportFailure: false });
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(target.file ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [versions, setVersions] = useState<readonly AttachmentVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editable, setEditable] = useState<EditableFile | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<readonly AttachmentVersionNote[]>([]);
  const [selection, setSelection] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [menu, setMenu] = useState<"more" | "versions" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const objectUrl = useRef<string | null>(null);
  const releaseFile = useStableCallback((node: HTMLDivElement | null) =>
    node
      ? () => {
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        }
      : undefined,
  );
  const extension = target.name.split(".").at(-1)?.toLowerCase();
  const canEdit = ["md", "txt", "docx", "csv", "xlsx"].includes(extension ?? "");
  const grid = extension === "csv" || extension === "xlsx";
  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    editable: true,
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: { class: "min-h-full outline-none prose prose-sm dark:prose-invert max-w-none" },
    },
  });
  const canVersion = !!(target.environmentId && target.attachment && target.threadRef);
  const call = async (
    input: Pick<AttachmentVersionsInput, "action"> & Partial<AttachmentVersionsInput>,
  ) => {
    if (!target.environmentId || !target.attachment || !target.threadRef)
      throw new Error("This file has no saved origin chat.");
    const result = await runVersions({
      environmentId: target.environmentId,
      input: { threadId: target.threadRef.threadId, attachment: target.attachment, ...input },
    });
    if (result._tag !== "Success") throw squashAtomCommandFailure(result);
    setVersions(result.value.versions);
    setSourcePath(result.value.sourcePath);
    return result.value;
  };
  const load = async (file: Blob) => {
    setBlob(file);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setUrl(objectUrl.current);
    if (canEdit) {
      const data = await readEditable(file, target.name);
      setEditable(data);
      setRows(data.rows ?? []);
      editor?.commands.setContent(
        data.html ||
          data.text
            .split("\n")
            .map((line) => `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p>`)
            .join(""),
      );
    }
    setDirty(false);
  };
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this file.");
    } finally {
      setBusy(false);
    }
  };
  const initialize = () => {
    if (!editor || started.current) return;
    started.current = true;
    void attempt(async () => {
      if (canVersion) {
        const result = await call({ action: "read" });
        const latest = result.versions.at(-1)!;
        setSelectedId(latest.id);
        setNotes(latest.notes);
        if (result.contentBase64) await load(fromBase64(result.contentBase64, target.mimeType));
      } else {
        const src = target.src ?? (await refresh());
        if (
          src &&
          !target.file &&
          !target.resource &&
          /^(image|audio|video)\//.test(target.mimeType)
        ) {
          setUrl(src);
          return;
        }
        const response =
          target.file ??
          (src
            ? await fetch(src).then((result) => {
                if (!result.ok) throw new Error("Could not load file.");
                return result.blob();
              })
            : null);
        if (response) await load(response);
      }
    });
  };
  const poll = async () => {
    if (!canVersion || editing || busy) return;
    try {
      const result = await call({ action: "list" });
      setError(null);
      const latest = result.versions.at(-1);
      if (latest && latest.id !== versions.at(-1)?.id) {
        const next = await call({ action: "read", versionId: latest.id });
        setSelectedId(latest.id);
        setNotes(latest.notes);
        if (next.contentBase64) await load(fromBase64(next.contentBase64, target.mimeType));
      }
    } catch {
      return;
    }
  };
  const save = async (nextNotes = notes) => {
    const file =
      editing && editable && editor
        ? await writeEditable(
            editable,
            target.name,
            editor.getHTML(),
            editor.getText({ blockSeparator: "\n" }),
            rows,
          )
        : blob;
    if (!file) return;
    const result = await call({
      action: "create",
      contentBase64: await toBase64(file),
      notes: nextNotes,
    });
    setSelectedId(result.versions.at(-1)!.id);
    setNotes(nextNotes);
    setEditing(false);
    setDirty(false);
    await load(file);
  };
  const mark = (text: string) => {
    if (!selection.trim()) {
      setError("Select text in the file first.");
      return;
    }
    const next = [...notes, { id: randomUUID(), quote: selection, comment: text }];
    void attempt(() => save(next));
    setCommenting(false);
    setComment("");
  };
  const showVersion = (version: AttachmentVersion) =>
    void attempt(async () => {
      const result = await call({ action: "read", versionId: version.id });
      if (!result.contentBase64) return;
      const file = fromBase64(result.contentBase64, target.mimeType);
      if (["md", "txt", "csv"].includes(extension ?? "") && blob) {
        const before = (await blob.text()).split("\n");
        const after = (await file.text()).split("\n");
        setDiff(
          before
            .flatMap((line, index) =>
              line === after[index]
                ? [`  ${line}`]
                : [`− ${line}`, ...(after[index] === undefined ? [] : [`+ ${after[index]}`])],
            )
            .concat(after.slice(before.length).map((line) => `+ ${line}`))
            .join("\n"),
        );
      } else setDiff(null);
      setSelectedId(version.id);
      setNotes(version.notes);
      await load(file);
    });
  const download = () => {
    if (!url) return;
    void attempt(async () => {
      let file = blob;
      if (!file) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Could not download this file.");
        file = await response.blob();
      }
      const source = URL.createObjectURL(file);
      setTimeout(() => URL.revokeObjectURL(source), 30000);
      const anchor = document.createElement("a");
      anchor.href = source;
      anchor.download = target.name;
      anchor.click();
      setMenu(null);
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !dirty) onClose();
      }}
    >
      <DialogPopup
        variant="media"
        showCloseButton={false}
        className="flex h-[88vh] w-[92vw] max-w-[min(71rem,92vw)] flex-col overflow-hidden [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden"
      >
        <div
          ref={releaseFile}
          className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
          style={{ borderRadius: 10 }}
        >
          <header
            ref={() => {
              initialize();
              const timer = window.setInterval(() => {
                void poll();
              }, 3000);
              return () => window.clearInterval(timer);
            }}
            className="flex items-center gap-3 border-b border-border px-6 py-4"
          >
            <div className="min-w-0 flex-1">
              <DialogTitle>{target.name}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {versions.find((version) => version.id === selectedId)?.author ?? "Attachment"}
                {versions.length
                  ? ` · ${versions.length} version${versions.length === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>
            {canEdit && !editing ? (
              <FileAction
                label={"Edit file"}
                Icon={PencilIcon}
                onClick={() => {
                  setEditing(true);
                  setDiff(null);
                }}
                disabled={!editable || !canVersion}
              />
            ) : null}
            {
              <FileAction
                label={"Close file"}
                Icon={XIcon}
                onClick={() => {
                  if (dirty) {
                    setError("Save your changes or cancel editing before closing.");
                    return;
                  }
                  onClose();
                }}
              />
            }
          </header>
          {error ? (
            <p role="alert" className="px-6 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <style>{"::highlight(ozi-file-notes) { background: #fbbf2480; color: inherit; }"}</style>
          <div
            ref={(node) => {
              content.current = node;
              if (node) return observeFileHighlights(node, notes);
            }}
            onMouseUp={() => {
              const selected = window.getSelection();
              if (selected && content.current?.contains(selected.anchorNode))
                setSelection(selected.toString());
            }}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {diff !== null ? (
              <pre className="flex-1 overflow-auto whitespace-pre-wrap p-8 text-sm">{diff}</pre>
            ) : editing && grid ? (
              <VirtualTablePreview
                name={target.name}
                count={rows.length}
                columns={Math.max(1, ...rows.map((row) => row.length))}
                getRows={(page) =>
                  rows.slice(page * PREVIEW_PAGE_ROWS, (page + 1) * PREVIEW_PAGE_ROWS)
                }
                onCellEdit={(index, column, value) => {
                  setRows((current) =>
                    current.map((row, rowIndex) =>
                      rowIndex === index
                        ? Array.from({ length: Math.max(row.length, column + 1) }, (_, cell) =>
                            cell === column ? value : (row[cell] ?? ""),
                          )
                        : row,
                    ),
                  );
                  setDirty(true);
                }}
              />
            ) : editing ? (
              <EditorContent editor={editor} className="flex-1 overflow-auto px-12 py-8" />
            ) : url && extension === "pdf" ? (
              <PdfViewer src={url} title={target.name} />
            ) : url && !blob && target.mimeType.startsWith("image/") ? (
              <img src={url} alt={target.name} className="min-h-0 flex-1 object-contain p-6" />
            ) : url && !blob && target.mimeType.startsWith("video/") ? (
              <MediaVideoPlayer
                src={url}
                label={target.name}
                preload="metadata"
                className="min-h-0 flex-1"
              />
            ) : url && !blob && target.mimeType.startsWith("audio/") ? (
              <div className="m-auto w-full max-w-2xl p-8">
                <AudioStrip src={url} name={target.name} />
              </div>
            ) : blob ? (
              <AttachmentFilePreview
                name={target.name}
                mimeType={target.mimeType}
                sizeBytes={blob.size}
                file={blob}
                {...(target.threadRef ? { threadRef: target.threadRef } : {})}
                sheetContent
              />
            ) : (
              <p className="p-8 text-sm text-muted-foreground">Loading file…</p>
            )}
          </div>
          {notes.length ? (
            <div className="max-h-28 overflow-auto border-t border-border px-6 py-2">
              {notes.map((note) => (
                <p key={note.id} className="py-1 text-xs">
                  <span className="bg-warning/20 px-1">{note.quote}</span>
                  {note.comment ? `: ${note.comment}` : ""}
                </p>
              ))}
            </div>
          ) : null}
          <div className="relative px-6 pb-5 pt-3">
            {menu ? (
              <div className="absolute bottom-full left-6 z-20 mb-2 max-h-80 min-w-60 overflow-auto rounded-lg border border-border bg-popover p-2 shadow-xl">
                {menu === "more" ? (
                  <>
                    <button
                      type="button"
                      className={cn(actionClass, "w-full justify-start")}
                      onClick={download}
                    >
                      <DownloadIcon className="size-4" />
                      Download
                    </button>
                    <button
                      type="button"
                      className={cn(actionClass, "w-full justify-start")}
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          target.resource && "path" in target.resource
                            ? target.resource.path
                            : (sourcePath ?? target.attachment?.id ?? target.name),
                        );
                        setMenu(null);
                      }}
                    >
                      <CopyIcon className="size-4" />
                      Copy path
                    </button>
                    <button
                      type="button"
                      className={cn(actionClass, "w-full justify-start")}
                      onClick={() => {
                        if (target.threadRef)
                          window.location.assign(
                            `/${target.threadRef.environmentId}/${target.threadRef.threadId}`,
                          );
                      }}
                    >
                      <ExternalLinkIcon className="size-4" />
                      Open chat
                    </button>
                  </>
                ) : (
                  <>
                    <p className="px-3 py-2 text-sm font-medium">Versions</p>
                    {versions.toReversed().map((version) => (
                      <div key={version.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          className={cn(
                            actionClass,
                            "flex-1 justify-start text-left",
                            version.id === selectedId && "bg-primary/10",
                          )}
                          onClick={() => showVersion(version)}
                        >
                          <span>
                            <span className="block">{version.author}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(version.createdAt).toLocaleString()}
                            </span>
                          </span>
                        </button>
                        {
                          <FileAction
                            label={"Restore as new version"}
                            Icon={UndoIcon}
                            onClick={() =>
                              void attempt(async () => {
                                const result = await call({
                                  action: "restore",
                                  versionId: version.id,
                                });
                                const latest = result.versions.at(-1)!;
                                showVersion(latest);
                              })
                            }
                            disabled={busy}
                          />
                        }
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : null}
            {commenting ? (
              <form
                className="mb-2 flex gap-2 rounded-lg border border-border bg-popover p-2 shadow"
                onSubmit={(event) => {
                  event.preventDefault();
                  mark(comment);
                }}
              >
                <input
                  autoFocus
                  aria-label="Comment on selection"
                  placeholder="Comment on selected text…"
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
                <button type="submit" className={actionClass}>
                  Add comment
                </button>
              </form>
            ) : null}
            {link !== null ? (
              <form
                className="mb-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (/^https?:\/\//.test(link))
                    editor?.chain().focus().setLink({ href: link }).run();
                  setLink(null);
                }}
              >
                <input
                  autoFocus
                  aria-label="Link URL"
                  placeholder="https://…"
                  className="flex-1 rounded-lg border border-border bg-transparent px-3 text-sm"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
                <button type="submit" className={actionClass}>
                  Add link
                </button>
              </form>
            ) : null}
            <div
              style={{ borderRadius: 10 }}
              className={cn(
                "mx-auto flex w-fit max-w-full items-center gap-1 rounded-lg p-2 shadow-lg",
                editing ? "bg-primary text-primary-foreground" : "border border-border bg-popover",
              )}
            >
              {editing ? (
                <>
                  {!grid ? (
                    <>
                      {
                        <FileAction
                          label={"Bold"}
                          Icon={BoldIcon}
                          onClick={() => editor?.chain().focus().toggleBold().run()}
                        />
                      }
                      {
                        <FileAction
                          label={"Italic"}
                          Icon={ItalicIcon}
                          onClick={() => editor?.chain().focus().toggleItalic().run()}
                        />
                      }
                      {
                        <FileAction
                          label={"Heading"}
                          Icon={HeadingIcon}
                          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                        />
                      }
                      {
                        <FileAction
                          label={"List"}
                          Icon={ListIcon}
                          onClick={() => editor?.chain().focus().toggleBulletList().run()}
                        />
                      }
                      {<FileAction label={"Link"} Icon={LinkIcon} onClick={() => setLink("")} />}
                    </>
                  ) : (
                    <span className="px-3 text-sm">Edit cells</span>
                  )}
                  <button
                    type="button"
                    className={cn(actionClass, "text-primary-foreground hover:bg-primary-foreground/15")}
                    onClick={() => {
                      setEditing(false);
                      setDirty(false);
                      if (blob) void load(blob);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(actionClass, "bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
                    onClick={() => void attempt(() => save())}
                  >
                    <CheckIcon className="size-4" />
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!canVersion || busy}
                    className={actionClass}
                    onClick={() => mark("")}
                  >
                    <HighlighterIcon className="size-4" />
                    <span className="hidden sm:inline">Highlight</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canVersion}
                    className={actionClass}
                    onClick={() => setCommenting(!commenting)}
                  >
                    <MessageSquareIcon className="size-4" />
                    <span className="hidden sm:inline">Comment</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canVersion}
                    className={actionClass}
                    onClick={() => setMenu(menu === "versions" ? null : "versions")}
                  >
                    <HistoryIcon className="size-4" />
                    <span className="hidden sm:inline">Versions</span>
                  </button>
                  <input
                    aria-label="Ask Ozi to change"
                    placeholder="Ask Ozi to change…"
                    className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none sm:w-64"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && message.trim() && !busy && canVersion)
                        void attempt(async () => {
                          await call({
                            action: "send",
                            versionId: selectedId ?? undefined,
                            notes: [
                              ...notes,
                              ...(selection
                                ? [
                                    {
                                      id: randomUUID(),
                                      quote: selection,
                                      comment: "Selected text",
                                    },
                                  ]
                                : []),
                            ],
                            message: message.trim(),
                          });
                          setMessage("");
                        });
                    }}
                  />
                  {
                    <FileAction
                      label={"More file actions"}
                      Icon={MoreHorizontalIcon}
                      onClick={() => setMenu(menu === "more" ? null : "more")}
                    />
                  }
                  <button
                    type="button"
                    aria-label="Send file request"
                    disabled={!message.trim() || busy || !canVersion}
                    className={cn(
                      actionClass,
                      "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                    onClick={() =>
                      void attempt(async () => {
                        await call({
                          action: "send",
                          versionId: selectedId ?? undefined,
                          notes: [
                            ...notes,
                            ...(selection
                              ? [
                                  {
                                    id: randomUUID(),
                                    quote: selection,
                                    comment: "Selected text",
                                  },
                                ]
                              : []),
                          ],
                          message: message.trim(),
                        });
                        setMessage("");
                      })
                    }
                  >
                    <ArrowUpIcon className="size-4" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function FileAction({
  label,
  Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  Icon: typeof BoldIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={actionClass}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" />
    </button>
  );
}
