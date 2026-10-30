import type { OrchestrationV2ExtensionUi, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";

export function ExtensionUiLines(props: {
  ui: OrchestrationV2ExtensionUi | null;
  placement: "aboveEditor" | "belowEditor";
}) {
  const { ui, placement } = props;
  if (ui === null) return null;
  const statuses = Object.values(ui.statuses);
  const lines = [
    ...(placement === "aboveEditor"
      ? ui.notices.map((notice) => ({ key: `notice:${notice.id}`, text: notice.message }))
      : []),
    ...Object.entries(ui.widgets)
      .filter(([, widget]) => widget.placement === placement)
      .map(([key, widget]) => ({ key: `widget:${key}`, text: widget.lines.join("\n") })),
    ...(placement === "belowEditor" && statuses.length > 0
      ? [{ key: "statuses", text: statuses.join(" · ") }]
      : []),
  ];
  if (lines.length === 0) return null;
  return (
    <div
      aria-label={placement === "aboveEditor" ? "Extension widgets" : "Extension status"}
      className="whitespace-pre-wrap px-3 py-1 text-muted-foreground text-xs"
    >
      {lines.map((line) => (
        <div key={line.key}>{line.text}</div>
      ))}
    </div>
  );
}

export function useExtensionEditorText(
  ui: OrchestrationV2ExtensionUi | null,
  threadId: string | null,
  target: ScopedThreadRef | DraftId,
) {
  const editorText = ui?.editorText ?? null;
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies each extension editor text once per browser, so reopening a chat keeps the user's draft
  useEffect(() => {
    if (editorText === null || threadId === null) return;
    const key = `ozi:extension-editor-text:${threadId}`;
    if (localStorage.getItem(key) === editorText.at) return;
    localStorage.setItem(key, editorText.at);
    setPrompt(target, editorText.text);
  }, [editorText, threadId, target, setPrompt]);
}
