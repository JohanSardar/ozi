import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import {
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
  type OziJobCard,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { Conversation } from "./Conversation";
import styles from "./ozi.module.css";

const lead = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Job brief",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
});

export function JobDrawer({
  card,
  environmentId,
  onClose,
}: {
  card: OziJobCard;
  environmentId: EnvironmentId;
  onClose: () => void;
}) {
  const result = useAtomValue(lead({ environmentId, input: { threadId: card.jobId } }));
  const projection = Option.getOrNull(AsyncResult.value(result));
  const brief = projection?.messages.find((message) => message.role === "user")?.text;
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <aside className={styles["ozi-drawer"]} aria-label="Job details">
      <header>
        <b>{card.title}</b>
        <span className={styles["ozi-agent"]}>
          {card.agent.provider === "claudeAgent"
            ? "Claude"
            : card.agent.provider === "codex"
              ? "Codex"
              : "Pi"}
        </span>
        <button ref={closeButton} type="button" onClick={onClose}>
          Close drawer
        </button>
      </header>
      <div className={styles["ozi-brief"]}>
        <b>Brief from Ozi</b>
        {brief ??
          (result._tag === "Failure"
            ? "Could not load the brief. Reopen this job to try again."
            : "Loading brief…")}
      </div>
      <Conversation environmentId={environmentId} threadId={card.jobId} job />
    </aside>
  );
}
