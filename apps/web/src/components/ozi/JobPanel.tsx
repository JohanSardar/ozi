import styles from "./ozi.module.css";
import { randomUUID } from "../../lib/utils";
import {
  CommandId,
  type OziJobCard,
  type OziJobColumn,
  type OziJobHandleInput,
  type OziJobRequest,
  type OziTodos,
  type ThreadId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

export type JobActions = {
  onAnswer: (request: OziJobRequest, value: string) => Promise<void>;
  onHandle: (input: OziJobHandleInput) => Promise<void>;
  onStop: (threadId: ThreadId) => Promise<void>;
  onOpen: (card: OziJobCard) => void;
};

const columns: readonly [OziJobColumn, string, string][] = [
  ["needs_you", "Needs you", "Nothing needs you"],
  ["running", "Running", "No jobs running"],
  ["ready", "Ready", "No reports yet"],
  ["done", "Done", "No closed jobs yet"],
];

export function NeedsYouPill({ cards }: { cards: readonly OziJobCard[] }) {
  const count = cards.filter((card) => card.column === "needs_you").length;
  return count > 0 ? <span className={styles["ozi-needs-pill"]}>Needs you · {count}</span> : null;
}

export function RequestForm({
  request,
  disabled,
  onAnswer,
}: {
  request: OziJobRequest;
  disabled: boolean;
  onAnswer: JobActions["onAnswer"];
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const secret = request.kind === "secret";
  const freeText = secret || request.options.length === 0;
  const answer = async (text: string) => {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onAnswer(request, text);
      setValue("");
      setSent(true);
    } catch (cause) {
      setError(secret ? "Could not send the private answer. Try again." : commandError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const locked = disabled || pending || sent;
  return (
    <form
      className={styles["ozi-request"]}
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) void answer(value);
      }}
    >
      <label>
        <span>{request.prompt}</span>
        {request.kind !== "approval" && freeText && (
          <input
            aria-label={secret ? "Private answer" : "Your answer"}
            type={secret ? "password" : "text"}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            value={value}
            disabled={locked}
            onChange={(event) => setValue(event.target.value)}
            placeholder={secret ? "Enter privately…" : "Write an answer…"}
          />
        )}
      </label>
      <div className={styles["ozi-options"]}>
        {request.kind === "approval" ? (
          <>
            <button
              type="button"
              className={styles["ozi-primary"]}
              disabled={locked}
              onClick={() => void answer("allow")}
            >
              Allow
            </button>
            <button type="button" disabled={locked} onClick={() => void answer("deny")}>
              Deny
            </button>
          </>
        ) : (
          <>
            {request.options.map((option) => (
              <button
                type="button"
                key={option}
                disabled={locked}
                onClick={() => void answer(option)}
              >
                {option}
              </button>
            ))}
            {freeText && (
              <button type="submit" disabled={locked || !value.trim()}>
                {secret ? "Send privately" : "Send answer"}
              </button>
            )}
          </>
        )}
      </div>
      {secret && <p className={styles["ozi-muted"]}>Kept out of the conversation.</p>}
      {pending && <p role="status">Sending…</p>}
      {sent && <p role="status">Sent. Waiting for an update…</p>}
      {error && (
        <p role="alert" className={styles["ozi-error"]}>
          {error}
        </p>
      )}
    </form>
  );
}

export function commandError(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "reason" in cause &&
    cause.reason === "StaleEvent"
  )
    return "This card changed. Review the latest update before closing it.";
  return cause instanceof Error ? cause.message : "Could not send the command. Try again.";
}

function JobCard({
  card,
  connected,
  onAnswer,
  onHandle,
  onStop,
  onOpen,
}: JobActions & { card: OziJobCard; connected: boolean }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const commandId = useRef(CommandId.make(randomUUID()));
  const eventId = card.eventId;
  const act = async (action: "close" | "stop") => {
    if (inFlight.current || !connected) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      if (action === "close") {
        if (!eventId) throw new Error("This card has no update to close.");
        await onHandle({
          commandId: commandId.current,
          jobId: card.jobId,
          eventId,
          evidence: { type: "close" },
        });
      } else await onStop(card.jobId);
      setSent(
        action === "close"
          ? "Close requested. Waiting for an update…"
          : "Stop requested. Waiting for an update…",
      );
    } catch (cause) {
      setError(commandError(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return (
    <article
      className={`${styles["ozi-job"]} ${styles[`ozi-job-${card.column}`]}`}
      data-job-id={card.jobId}
    >
      <div className={styles["ozi-job-heading"]}>
        <button type="button" className={styles["ozi-card-open"]} onClick={() => onOpen(card)}>
          {card.title}
        </button>
        <span className={styles["ozi-agent"]}>
          {card.agent.provider === "claudeAgent"
            ? "Claude"
            : card.agent.provider === "codex"
              ? "Codex"
              : card.agent.provider === "pi"
                ? "Pi"
                : card.agent.provider}
        </span>
      </div>
      {card.column === "running" && (
        <p className={styles["ozi-job-status"]}>
          <span
            className={`${styles["ozi-dot"]} ${card.checking ? styles["ozi-dot-checking"] : ""}`}
            aria-hidden
          />
          {card.checking ? "Double-checking it's fully done…" : card.status || "Working on it…"}
        </p>
      )}
      {card.column === "needs_you" && (
        <>
          {card.requests.length === 0 && <p className={styles["ozi-job-status"]}>{card.status}</p>}
          {card.requests.map((request) => (
            <RequestForm
              key={request.id}
              request={request}
              disabled={!connected}
              onAnswer={onAnswer}
            />
          ))}
        </>
      )}
      {card.column === "ready" && card.report && (
        <div className={styles["ozi-report"]}>{card.report.text}</div>
      )}
      {card.column === "done" ? (
        <p className={styles["ozi-job-status"]}>Closed</p>
      ) : (
        <div className={styles["ozi-actions"]}>
          <button
            type="button"
            className={card.column === "ready" ? styles["ozi-primary"] : ""}
            disabled={!connected || pending || sent !== null || !eventId}
            onClick={() => void act("close")}
          >
            {card.column === "ready" ? "Got it, close" : "Close"}
          </button>
          {card.column === "ready" ? (
            <button type="button" onClick={() => onOpen(card)}>
              Open
            </button>
          ) : (
            <button
              type="button"
              disabled={!connected || pending || sent !== null}
              onClick={() => void act("stop")}
            >
              Stop
            </button>
          )}
        </div>
      )}
      {pending && (
        <p role="status" className={styles["ozi-muted"]}>
          Sending…
        </p>
      )}
      {sent && (
        <p role="status" className={styles["ozi-muted"]}>
          {sent}
        </p>
      )}
      {error && (
        <p role="alert" className={styles["ozi-error"]}>
          {error}
        </p>
      )}
    </article>
  );
}

export function JobPanel({
  cards,
  connected,
  unavailable,
  todos,
  todosLoading,
  onRefreshTodos,
  ...actions
}: JobActions & {
  cards: readonly OziJobCard[];
  connected: boolean;
  unavailable?: string | undefined;
  todos?: OziTodos;
  todosLoading?: boolean;
  onRefreshTodos?: () => void;
}) {
  return (
    <aside className={styles["ozi-job-panel"]} aria-label="Jobs">
      {!connected && (
        <p role="status" className={styles["ozi-connection"]}>
          Disconnected. Cards may be out of date. Reconnect to answer or change a job.
        </p>
      )}
      {unavailable && (
        <p role="status" className={styles["ozi-connection"]}>
          {unavailable}
        </p>
      )}
      {columns.map(([column, title, empty]) => {
        const list = cards.filter((card) => card.column === column);
        return (
          <section
            key={column}
            aria-label={title}
            className={`${styles["ozi-column"]} ${styles[`ozi-column-${column}`]}`}
          >
            <h2>
              {title} <span>{list.length}</span>
            </h2>
            {list.length ? (
              list.map((card) => (
                <JobCard
                  key={`${card.jobId}:${card.eventId}`}
                  card={card}
                  connected={connected && !unavailable}
                  {...actions}
                />
              ))
            ) : (
              <p className={styles["ozi-empty"]}>
                {unavailable || !connected ? "Waiting for job updates" : empty}
              </p>
            )}
          </section>
        );
      })}
      {todos && (
        <section
          className={`${styles["ozi-column"]} ${styles["ozi-todos"]}`}
          aria-label="Your to-dos"
        >
          <h2>
            Your to-dos <span>· {todos.source}</span>
            <button
              type="button"
              disabled={!connected || todosLoading}
              onClick={() => void onRefreshTodos?.()}
            >
              {todosLoading ? "Refreshing…" : "Refresh"}
            </button>
          </h2>
          {todos.state !== "available" && (
            <p role="status" className={styles["ozi-connection"]}>
              {todos.state === "stale"
                ? "Unavailable · showing saved to-dos"
                : "To-dos unavailable"}
            </p>
          )}
          <p className={styles["ozi-muted"]}>
            {todos.fetchedAt
              ? `Last fetched ${new Date(todos.fetchedAt).toLocaleString()}`
              : `Last attempted ${new Date(todos.attemptedAt).toLocaleString()}`}
          </p>
          {todos.items?.map((todo) => (
            <div className={styles["ozi-todo"]} key={todo.id} data-todo-id={todo.id}>
              <i aria-hidden />
              {todo.link ? (
                <a href={todo.link} target="_blank" rel="noreferrer">
                  {todo.title}
                </a>
              ) : (
                <b>{todo.title}</b>
              )}
              <span>{todo.due ?? todo.status}</span>
            </div>
          ))}
          {todos.state === "available" && todos.items?.length === 0 && (
            <p className={styles["ozi-empty"]}>No to-dos</p>
          )}
        </section>
      )}
    </aside>
  );
}
