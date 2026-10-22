import { useAtomValue } from "@effect/atom-react";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { resolveShortcutCommand } from "../../keybindings";
import styles from "./ozi.module.css";
import { newMessageId } from "../../lib/utils";
import {
  MessageId,
  RuntimeRequestId,
  type ChatAttachment,
  type EnvironmentId,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
  isProviderSendTurnSupportedImageMimeType,
  getProviderAttachmentLimitError,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef, useState } from "react";
import * as Option from "effect/Option";
import { useEnvironmentThread, threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useAtomCommand } from "../../state/use-atom-command";
import { attachmentEnvironment } from "../../state/attachments";
import { usePreparedConnection } from "../../state/session";
import { useAssetUrlState } from "../../assets/assetUrls";
import { HtmlRenderFrame } from "../chat/HtmlRenderFrame";
import { McpAppFrame } from "../chat/McpAppFrame";
import { htmlRenderFromToolItem, mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import ChatMarkdown from "../ChatMarkdown";
import { Questions } from "./Questions";
import { RequestForm, commandError } from "./JobPanel";
import { requireCommand, useJobActions } from "./useJobActions";

function Attachment({
  attachment,
  environmentId,
}: {
  attachment: ChatAttachment;
  environmentId: EnvironmentId;
}) {
  const asset = useAssetUrlState(environmentId, {
    _tag: "attachment",
    attachmentId: attachment.id,
    fileName: attachment.name,
    mimeType: attachment.mimeType,
    disposition: "inline",
  });
  return asset._tag === "Success" ? (
    <a href={asset.url} target="_blank" rel="noreferrer">
      {attachment.type === "image" ? (
        <img src={asset.url} alt={attachment.name} className="max-h-64 rounded-lg" />
      ) : (
        attachment.name
      )}
    </a>
  ) : (
    <span>
      {attachment.name} · {asset._tag === "Failure" ? "Unavailable" : "Loading…"}
    </span>
  );
}

function ConversationHistory({
  projection,
  environmentId,
  send,
}: {
  projection: OrchestrationV2ThreadProjection;
  environmentId: EnvironmentId;
  send: (text: string) => Promise<void>;
}) {
  const threadRef = scopeThreadRef(environmentId, projection.thread.id);
  return (
    <>
      {projection.visibleTurnItems.map((row) => {
        const item = row.item;
        if (item.type === "user_message" || item.type === "assistant_message")
          return (
            <div
              key={item.id}
              className={`${styles["ozi-message"]} ${item.type === "user_message" ? styles["ozi-message-user"] : ""}`}
            >
              {item.type === "assistant_message" && (
                <div className={styles["ozi-who"]}>
                  Ozi
                  {projection.runs.find((run) => run.id === item.runId)?.completionCheck?.state ===
                  "checking"
                    ? " · Unchecked"
                    : ""}
                </div>
              )}
              <ChatMarkdown text={item.text} threadRef={threadRef} environmentId={environmentId} />
              {item.attachments?.map((attachment) => (
                <Attachment
                  key={attachment.id}
                  attachment={attachment}
                  environmentId={environmentId}
                />
              ))}
            </div>
          );
        if (item.type === "dynamic_tool") {
          const html = htmlRenderFromToolItem(item);
          const app = mcpAppFromToolItem(item);
          if (html)
            return (
              <HtmlRenderFrame
                key={item.id}
                environmentId={environmentId}
                htmlRender={html}
                threadRef={threadRef}
              />
            );
          if (app)
            return (
              <McpAppFrame
                key={item.id}
                environmentId={environmentId}
                threadId={item.threadId}
                conversationThreadId={projection.thread.id}
                itemId={item.id}
                revision={String(item.updatedAt)}
                app={app}
                onSendMessage={send}
              />
            );
        }
        if (item.type === "error")
          return (
            <p key={item.id} role="alert" className={styles["ozi-error"]}>
              {item.failure.message}
            </p>
          );
        return null;
      })}
    </>
  );
}

export function Conversation({
  environmentId,
  threadId,
  job = false,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  job?: boolean;
}) {
  const state = useEnvironmentThread(environmentId, threadId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projection = Option.getOrNull(state.data);
  const prepared = usePreparedConnection(environmentId);
  const start = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const earlier = useAtomCommand(threadEnvironment.loadEarlierHistory, { reportFailure: false });
  const upload = useAtomCommand(attachmentEnvironment.createUploadUrl, { reportFailure: false });
  const remove = useAtomCommand(attachmentEnvironment.remove, { reportFailure: false });
  const { onAnswer, onStop } = useJobActions(environmentId);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatchMode, setDispatchMode] = useState<"queue" | "steer">("queue");
  const inFlight = useRef(false);
  const history = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const connected = state.status === "live";
  const running =
    projection?.runs.some((run) =>
      ["preparing", "starting", "running", "waiting"].includes(run.status),
    ) ?? false;
  useEffect(() => {
    if (projection && following.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [projection]);

  const send = async (
    message: string,
    attachments: readonly ChatAttachment[] = [],
    intent = dispatchMode,
  ) => {
    if (!connected || !projection) throw new Error("Reconnect before sending a message.");
    requireCommand(
      await start({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: MessageId.make(newMessageId()),
            role: "user",
            text: message,
            attachments,
          },
          runtimeMode: projection.thread.runtimeMode,
          interactionMode: projection.thread.interactionMode,
          dispatchMode: running ? intent : "auto",
        },
      }),
    );
  };
  const submit = async (intent = dispatchMode) => {
    if (inFlight.current || !connected || (!text.trim() && !files.length)) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const attachments: ChatAttachment[] = [];
    try {
      if (Option.isNone(prepared)) throw new Error("Reconnect before sending a message.");
      const limit = getProviderAttachmentLimitError(
        files.map((file) => ({
          type: isProviderSendTurnSupportedImageMimeType(file.type) ? "image" : "file",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        })),
      );
      if (limit) throw new Error(limit);
      for (const file of files) {
        const image = isProviderSendTurnSupportedImageMimeType(file.type);
        const minted = requireCommand(
          await upload({
            environmentId,
            input: isProviderSendTurnSupportedImageMimeType(file.type)
              ? {
                  type: "image",
                  name: file.name,
                  mimeType: file.type as "image/gif" | "image/jpeg" | "image/png" | "image/webp",
                  sizeBytes: file.size,
                }
              : {
                  type: "file",
                  name: file.name,
                  mimeType: file.type || "application/octet-stream",
                  sizeBytes: file.size,
                },
          }),
        );
        const response = await fetch(new URL(minted.relativeUrl, prepared.value.httpBaseUrl), {
          method: "POST",
          body: file,
        });
        if (!response.ok) {
          await remove({ environmentId, input: { attachmentId: minted.attachmentId } });
          throw new Error(`Could not attach ${file.name}. Try again.`);
        }
        attachments.push({
          type: image ? "image" : "file",
          id: minted.attachmentId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
      }
      await send(text, attachments, intent);
      setText((current) => (current === text ? "" : current));
      setFiles([]);
      following.current = true;
    } catch (cause) {
      setError(commandError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <section
      className={styles["ozi-conversation"]}
      aria-label={job ? "Job conversation" : "Main conversation"}
    >
      <div
        className={styles["ozi-messages"]}
        ref={history}
        onScroll={() => {
          const el = history.current;
          if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {state.history.hasMoreHistory && (
          <button
            type="button"
            disabled={!connected || state.history.loading}
            onClick={async () => {
              try {
                requireCommand(await earlier({ environmentId, input: { threadId } }));
              } catch (cause) {
                setError(commandError(cause));
              }
            }}
          >
            Earlier messages
          </button>
        )}
        {state.history.error && (
          <p role="alert" className={styles["ozi-error"]}>
            {state.history.error}
          </p>
        )}
        {projection && (
          <ConversationHistory projection={projection} environmentId={environmentId} send={send} />
        )}
        {!projection && (
          <p role="status" className={styles["ozi-muted"]}>
            {state.status === "deleted"
              ? "This conversation is unavailable."
              : "Loading conversation…"}
          </p>
        )}
        {projection?.turnItems
          .filter(
            (item) =>
              item.type === "approval_request" &&
              projection.runtimeRequests.some(
                (request) => request.id === item.requestId && request.status === "pending",
              ),
          )
          .map(
            (item) =>
              item.type === "approval_request" && (
                <RequestForm
                  key={item.id}
                  request={{
                    id: item.requestId,
                    threadId: item.threadId,
                    kind: "approval",
                    prompt: item.prompt || "Allow this action?",
                    options: [],
                  }}
                  disabled={!connected}
                  onAnswer={onAnswer}
                />
              ),
          )}
        {projection?.turnItems
          .filter(
            (item) =>
              item.type === "user_input_request" &&
              projection.runtimeRequests.some(
                (request) => request.id === item.requestId && request.status === "pending",
              ),
          )
          .map(
            (item) =>
              item.type === "user_input_request" && (
                <Questions
                  key={item.id}
                  item={item}
                  environmentId={environmentId}
                  connected={connected}
                />
              ),
          )}
        {projection?.turnItems.map(
          (item) =>
            item.type === "secret_request" &&
            item.secretStatus === "pending" && (
              <RequestForm
                key={item.id}
                request={{
                  id: RuntimeRequestId.make(item.id),
                  threadId: item.threadId,
                  kind: "secret",
                  prompt: item.label,
                  options: [],
                }}
                disabled={!connected}
                onAnswer={onAnswer}
              />
            ),
        )}
      </div>
      {!connected && (
        <p role="status" className={styles["ozi-connection"]}>
          {Option.getOrNull(state.error) ??
            "Reconnecting… Messages will stay here until you can send them."}
        </p>
      )}
      {running && (
        <div className={styles["ozi-running"]}>
          <span className={styles["ozi-dot"]} aria-hidden />
          Working…
          <button
            type="button"
            disabled={!connected}
            onClick={() => void onStop(threadId).catch((cause) => setError(commandError(cause)))}
          >
            Stop
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles["ozi-error"]}>
          {error}
        </p>
      )}
      <form
        className={styles["ozi-composer"]}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {files.length > 0 && (
          <div className={styles["ozi-attachments"]}>
            {files.map((file, i) => (
              <button
                type="button"
                disabled={pending}
                key={`${file.name}:${file.lastModified}:${file.size}`}
                onClick={() => setFiles((items) => items.filter((_, index) => index !== i))}
              >
                Remove {file.name} ×
              </button>
            ))}
          </div>
        )}
        <textarea
          aria-label={job ? "Message this job" : "Message Ozi"}
          placeholder={job ? "Message this job directly…" : "Tell Ozi anything…"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            const command = resolveShortcutCommand(event.nativeEvent, keybindings, {
              context: { composerFocus: true, turnRunning: running },
            });
            if (command === "thread.stop") {
              event.preventDefault();
              void onStop(threadId).catch((cause) => setError(commandError(cause)));
            } else if (command === "composer.sendAlternate" && running) {
              event.preventDefault();
              void submit(dispatchMode === "queue" ? "steer" : "queue");
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className={styles["ozi-composer-actions"]}>
          <label className={styles["ozi-attach"]}>
            Attach
            <input
              className="sr-only"
              aria-label="Attach files"
              type="file"
              multiple
              disabled={pending}
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                setFiles((items) => [...items, ...selected]);
              }}
            />
          </label>
          {running && (
            <select
              aria-label="When to send"
              value={dispatchMode}
              onChange={(event) => setDispatchMode(event.target.value as "queue" | "steer")}
            >
              <option value="queue">Send next</option>
              <option value="steer">Guide now</option>
            </select>
          )}
          <button
            className={styles["ozi-primary"]}
            type="submit"
            aria-label="Submit message"
            disabled={!connected || pending || (!text.trim() && !files.length)}
          >
            {pending
              ? "Sending…"
              : running
                ? dispatchMode === "queue"
                  ? "Send next"
                  : "Guide now"
                : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
