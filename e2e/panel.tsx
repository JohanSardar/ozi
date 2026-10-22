import { createRoot } from "react-dom/client";
import * as DateTime from "effect/DateTime";
import { EventId, RuntimeRequestId, ThreadId, type OziJobCard } from "@t3tools/contracts";
import { JobPanel, NeedsYouPill } from "../apps/web/src/components/ozi/JobPanel";
import styles from "../apps/web/src/components/ozi/ozi.module.css";

const state = new URL(location.href).searchParams.get("state") ?? "running";
const base: OziJobCard = {
  jobId: ThreadId.make("preview-job"),
  eventId: EventId.make("preview-update"),
  title: "Arrange a visit",
  column: "running",
  agent: { provider: "codex", model: "gpt-6.1-sol" },
  status: "Looking for available times…",
  checking: false,
  requestEventId: EventId.make("preview-request"),
  report: null,
  requests: [],
  handledEventId: null,
  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
};
const request = {
  id: RuntimeRequestId.make("preview-question"),
  threadId: ThreadId.make("preview-helper"),
  kind: "question" as const,
  prompt: "Which time works for you?",
  options: ["Thursday at 9 am", "Friday at 2 pm", "Look for another time"],
};
const card: OziJobCard =
  state === "checking"
    ? { ...base, checking: true }
    : state === "question"
      ? { ...base, column: "needs_you", requests: [request] }
      : state === "free-text"
        ? { ...base, column: "needs_you", requests: [{ ...request, options: [] }] }
        : state === "approval"
          ? {
              ...base,
              title: "Cancel an unused subscription",
              column: "needs_you",
              requests: [
                {
                  ...request,
                  kind: "approval",
                  prompt: "Cancel the monthly subscription?",
                  options: [],
                },
              ],
            }
          : state === "secret"
            ? {
                ...base,
                title: "Connect your account",
                column: "needs_you",
                requests: [
                  {
                    ...request,
                    kind: "secret",
                    prompt: "Enter the account key privately",
                    options: [],
                  },
                ],
              }
            : state === "ready"
              ? {
                  ...base,
                  column: "ready",
                  report: {
                    eventId: EventId.make("preview-report"),
                    text: "Your visit is booked for Thursday at 9 am. The confirmation and a reminder are in your calendar.",
                    useful: true,
                  },
                }
              : state === "done"
                ? { ...base, column: "done", handledEventId: EventId.make("preview-report") }
                : base;
const cards = state === "empty" ? [] : [card];
const unavailable = async () => {
  throw new Error("This picture preview cannot send commands.");
};

createRoot(document.getElementById("root")!).render(
  <main className={styles["ozi-app"]}>
    <header className={styles["ozi-titlebar"]}>
      <b>Ozi</b>
      <span className={styles["ozi-title-spacer"]} />
      <NeedsYouPill cards={cards} />
    </header>
    <div className={styles["ozi-workspace"]}>
      <section className={styles["ozi-conversation"]} aria-label="Main conversation">
        <div className={styles["ozi-messages"]}>
          <div className={`${styles["ozi-message"]} ${styles["ozi-message-user"]}`}>
            Find an available time for my visit.
          </div>
          <div className={styles["ozi-message"]}>
            <div className={styles["ozi-who"]}>Ozi</div>I’ve started a job. I’ll let you know when
            it needs you.
          </div>
        </div>
        <div className={styles["ozi-composer"]}>
          <textarea aria-label="Message Ozi" placeholder="Tell Ozi anything…" />
          <div className={styles["ozi-composer-actions"]}>
            <button type="button">Attach</button>
            <button type="button" className={styles["ozi-primary"]}>
              Send
            </button>
          </div>
        </div>
      </section>
      <JobPanel
        cards={cards}
        connected={state !== "disconnected"}
        onAnswer={unavailable}
        onHandle={unavailable}
        onStop={unavailable}
        onOpen={() => {
          location.hash = "job";
        }}
      />
    </div>
  </main>,
);
