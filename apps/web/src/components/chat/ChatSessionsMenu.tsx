import { useState } from "react";
import type {
  ChatSessionInput,
  ChatSessionResult,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useComposerDraftStore } from "../../composerDraftStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";

const sessionCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Chat session",
  tag: "chatSessions.execute",
});

export function ChatSessionsMenu({
  environmentId,
  threadId,
  onOpenThread,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const execute = useOrchestrationCommand(sessionCommand);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [sessions, setSessions] = useState<NonNullable<ChatSessionResult["sessions"]>>([]);
  const [messages, setMessages] = useState<NonNullable<ChatSessionResult["messages"]>>([]);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const run = async (input: ChatSessionInput) => {
    setBusy(true);
    try {
      const result = await execute({ environmentId, input });
      if (result._tag !== "Success") return;
      const value = result.value;
      if (value.sessions !== undefined) setSessions(value.sessions);
      if (value.messages !== undefined) setMessages(value.messages);
      if (value.content !== undefined) {
        const url = URL.createObjectURL(
          new Blob([value.content], {
            type: value.filename?.endsWith("html") ? "text/html" : "application/jsonl",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = value.filename ?? "session.jsonl";
        link.click();
        URL.revokeObjectURL(url);
      }
      if (input.action === "reload") setOpen(false);
      if (value.threadId !== undefined && input.action !== "inspect" && input.action !== "reload") {
        if (value.editorText !== undefined)
          setPrompt(scopeThreadRef(environmentId, value.threadId), value.editorText);
        onOpenThread(value.threadId);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
          void run({ action: "list" });
        }}
      >
        Sessions
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Chat sessions</DialogTitle>
            <DialogDescription>
              Start a chat, branch its history, or resume a saved conversation.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-wrap gap-2 py-3">
              <Button disabled={busy} onClick={() => void run({ action: "new", threadId })}>
                New chat
              </Button>
              <Button disabled={busy} onClick={() => void run({ action: "clone", threadId })}>
                Clone
              </Button>
              <Button disabled={busy} onClick={() => void run({ action: "inspect", threadId })}>
                Fork
              </Button>
              <Button disabled={busy} onClick={() => void run({ action: "reload", threadId })}>
                Reload
              </Button>
              <Button
                disabled={busy}
                onClick={() => void run({ action: "export", threadId, format: "jsonl" })}
              >
                Export JSONL
              </Button>
              <Button
                disabled={busy}
                onClick={() => void run({ action: "export", threadId, format: "html" })}
              >
                Export HTML
              </Button>
              <label className="cursor-pointer rounded-md border px-3 py-2 text-sm">
                Import Pi session
                <input
                  aria-label="Import Pi session"
                  type="file"
                  accept=".jsonl,.ndjson"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined)
                      void file
                        .text()
                        .then((content) => run({ action: "import", threadId, content }));
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {messages.length > 0 && (
              <div className="max-h-40 overflow-auto border-y py-2">
                <p className="mb-2 text-sm text-muted-foreground">
                  Fork before a message and put it in the composer
                </p>
                {messages.map((message) => (
                  <Button
                    key={message.id}
                    variant="ghost"
                    className="block w-full text-left"
                    disabled={busy}
                    onClick={() => void run({ action: "fork", threadId, messageId: message.id })}
                  >
                    <span className="block truncate">{message.text.slice(0, 100)}</span>
                  </Button>
                ))}
              </div>
            )}
            <input
              aria-label="Search sessions"
              className="my-3 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Search sessions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="max-h-64 overflow-auto">
              {sessions
                .filter((session) =>
                  `${session.title} ${session.threadId}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((session) => (
                  <Button
                    key={session.threadId}
                    variant="ghost"
                    className="flex w-full justify-between"
                    disabled={busy}
                    onClick={() => void run({ action: "resume", threadId: session.threadId })}
                  >
                    <span className="truncate">{session.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {session.threadId === threadId ? "Current" : "Resume"}
                    </span>
                  </Button>
                ))}
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
