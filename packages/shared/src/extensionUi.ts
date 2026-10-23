import type { OrchestrationV2DomainEvent, OrchestrationV2ExtensionUi } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

function entry<T>(entries: Readonly<Record<string, T>>, key: string, value: T | undefined) {
  if (value !== undefined) return { ...entries, [key]: value };
  return Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key));
}

export function applyExtensionUiEvent(
  current: OrchestrationV2ExtensionUi | undefined,
  event: Extract<OrchestrationV2DomainEvent, { type: "thread.extension-ui-updated" }>,
): OrchestrationV2ExtensionUi {
  const state = current ?? {
    statuses: {},
    widgets: {},
    title: null,
    notices: [],
    editorText: null,
  };
  const update = event.payload;
  const at = DateTime.formatIso(event.occurredAt);
  switch (update.method) {
    case "notify":
      return {
        ...state,
        notices: [
          ...state.notices,
          { id: event.id, message: update.message, type: update.notifyType ?? "info", at },
        ].slice(-20),
      };
    case "setStatus":
      return { ...state, statuses: entry(state.statuses, update.statusKey, update.statusText) };
    case "setWidget":
      return {
        ...state,
        widgets: entry(
          state.widgets,
          update.widgetKey,
          update.widgetLines === undefined
            ? undefined
            : { lines: update.widgetLines, placement: update.widgetPlacement ?? "aboveEditor" },
        ),
      };
    case "setTitle":
      return { ...state, title: update.title };
    case "set_editor_text":
      return { ...state, editorText: { text: update.text, at } };
  }
}
