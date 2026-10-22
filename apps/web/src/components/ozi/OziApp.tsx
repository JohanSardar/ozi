import { useAtomValue } from "@effect/atom-react";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { resolveShortcutCommand } from "../../keybindings";
import { dispatchPreviewAction } from "../preview/previewActionBus";
import styles from "./ozi.module.css";
import { OZI_MAIN_THREAD_ID, type OziJobCard } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Conversation } from "./Conversation";
import { JobDrawer } from "./JobDrawer";
import { JobPanel, NeedsYouPill } from "./JobPanel";
import { useJobActions } from "./useJobActions";
import { useOziJobs } from "./useOziJobs";
import { usePrimaryEnvironment } from "../../state/environments";
import { PreviewPanel } from "../preview/PreviewPanel";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { usePreviewSession } from "../preview/usePreviewSession";
import { useOziTodos } from "./useOziTodos";

export function OziApp() {
  const environment = usePrimaryEnvironment();
  return environment ? (
    <OziWorkspace environment={environment} />
  ) : (
    <main className={styles["ozi-app"]}>
      <p role="status">Connecting to Ozi…</p>
      <Link to="/settings/connections">Connections</Link>
    </main>
  );
}

function OziWorkspace({
  environment,
}: {
  environment: NonNullable<ReturnType<typeof usePrimaryEnvironment>>;
}) {
  const jobs = useOziJobs(environment.environmentId);
  const todos = useOziTodos(environment.environmentId);
  const cards = jobs.cards;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [opened, setOpened] = useState<OziJobCard | null>(null);
  const [browser, setBrowser] = useState(false);
  const [mobileJobs, setMobileJobs] = useState(false);
  const actions = useJobActions(environment.environmentId);
  const threadRef = scopeThreadRef(environment.environmentId, OZI_MAIN_THREAD_ID);
  usePreviewSession(threadRef);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpened(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          previewOpen: browser,
          previewFocus:
            document.activeElement instanceof HTMLElement &&
            Boolean(document.activeElement.closest(`.${styles["ozi-browser"]}`)),
        },
      });
      if (command === "preview.toggle") {
        event.preventDefault();
        setBrowser((value) => !value);
      } else if (browser && command?.startsWith("preview.")) {
        const action =
          command === "preview.refresh"
            ? "refresh"
            : command === "preview.focusUrl"
              ? "focus-url"
              : command === "preview.zoomIn"
                ? "zoom-in"
                : command === "preview.zoomOut"
                  ? "zoom-out"
                  : command === "preview.resetZoom"
                    ? "reset-zoom"
                    : null;
        if (action) {
          event.preventDefault();
          dispatchPreviewAction(action);
        }
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [browser, keybindings]);
  return (
    <main className={`${styles["ozi-app"]} ${mobileJobs ? styles["ozi-show-jobs"] : ""}`}>
      <header className={styles["ozi-titlebar"] + " drag-region"}>
        <b>Ozi</b>
        <span className={styles["ozi-title-spacer"]} />
        <NeedsYouPill cards={cards} />
        <button
          type="button"

          aria-pressed={mobileJobs}
          onClick={() => {
            if (!mobileJobs) todos.refresh();
            setMobileJobs((value) => !value);
          }}
        >
          Jobs
        </button>
        <button
          type="button"

          aria-pressed={browser}
          onClick={() => setBrowser((value) => !value)}
        >
          Browser
        </button>
        <Link to="/settings/appearance">Settings</Link>
      </header>
      <div
        className={styles["ozi-workspace"]}
        data-job-open={opened ? true : undefined}
        data-browser-open={browser ? true : undefined}
      >
        <Conversation environmentId={environment.environmentId} threadId={OZI_MAIN_THREAD_ID} />
        <JobPanel
          todos={todos.todos}
          todosLoading={todos.loading}
          onRefreshTodos={todos.refresh}
          cards={cards}
          connected={environment.connection.phase === "connected"}
          unavailable={jobs.unavailable}
          {...actions}
          onHandle={jobs.onHandle}
          onOpen={setOpened}
        />
      </div>
      {browser && (
        <section className={styles["ozi-browser"]} aria-label="Shared browser">
          <button type="button" onClick={() => setBrowser(false)}>
            Close browser
          </button>
          <PreviewPanel threadRef={threadRef} mode="embedded" visible />
        </section>
      )}
      {opened && (
        <JobDrawer
          key={opened.jobId}
          card={opened}
          environmentId={environment.environmentId}
          onClose={() => setOpened(null)}
        />
      )}
    </main>
  );
}
