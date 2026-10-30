import type { ComposerHandleRef } from "../../composerHandleContext";
import type { ChatComposerHandle } from "./ChatComposer";
import type { ChatShortcutCommands } from "./useChatShortcuts";

const openControl =
  (composerRef: ComposerHandleRef, control: Parameters<ChatComposerHandle["openControl"]>[0]) =>
  ({ event }: { readonly event: KeyboardEvent }) => {
    if (!event.repeat) composerRef.current?.openControl(control);
  };

/** Chords that open or step the composer's controls and its branch toolbar. Held keys do not repeat them. */
export function composerShortcutCommands(composerRef: ComposerHandleRef): ChatShortcutCommands {
  return {
    "modelPicker.toggle": ({ event }) => {
      if (!event.repeat) composerRef.current?.toggleModelPicker();
    },
    "composer.increaseEffort": ({ event }) => {
      if (!event.repeat) composerRef.current?.stepReasoningEffort(1);
    },
    "composer.decreaseEffort": ({ event }) => {
      if (!event.repeat) composerRef.current?.stepReasoningEffort(-1);
    },
    "composer.host": openControl(composerRef, "composer.host"),
    "composer.effort": openControl(composerRef, "composer.effort"),
    "composer.mode": openControl(composerRef, "composer.mode"),
    "composer.workspace": openControl(composerRef, "composer.workspace"),
  } satisfies ChatShortcutCommands;
}
