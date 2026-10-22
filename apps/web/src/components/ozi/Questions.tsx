import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { commandError } from "./JobPanel";
import { requireCommand } from "./useJobActions";
import styles from "./ozi.module.css";

export function Questions({
  item,
  environmentId,
  connected,
}: {
  item: Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>;
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const respond = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(
      item.questions.map((question) => [question.id, question.initialAnswer ?? ""]),
    ),
  );
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  return (
    <form
      className={styles["ozi-request"]}
      onSubmit={(event) => {
        event.preventDefault();
        if (inFlight.current || !connected) return;
        inFlight.current = true;
        setPending(true);
        setError(null);
        void respond({
          environmentId,
          input: { threadId: item.threadId, requestId: item.requestId, answers },
        })
          .then((result) => {
            requireCommand(result);
            setSent(true);
          })
          .catch((cause) => setError(commandError(cause)))
          .finally(() => {
            inFlight.current = false;
            setPending(false);
          });
      }}
    >
      {item.questions.map((question) => (
        <fieldset key={question.id} disabled={!connected || pending || sent}>
          <legend>{question.question}</legend>
          <div className={styles["ozi-options"]}>
            {question.options.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={answers[question.id] === option.label}
                onClick={() =>
                  setAnswers((previous) => ({ ...previous, [question.id]: option.label }))
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          {question.allowCustomAnswer !== false && (
            <input
              aria-label={question.question}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))
              }
            />
          )}
        </fieldset>
      ))}
      <div className={styles["ozi-actions"]}>
        <button
          type="submit"
          disabled={
            !connected ||
            pending ||
            sent ||
            item.questions.some((question) => !answers[question.id]?.trim())
          }
        >
          Send answers
        </button>
      </div>
      {sent && <p role="status">Sent. Waiting for an update…</p>}
      {error && (
        <p role="alert" className={styles["ozi-error"]}>
          {error}
        </p>
      )}
    </form>
  );
}
