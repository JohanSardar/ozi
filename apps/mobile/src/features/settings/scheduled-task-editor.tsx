import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, type Dispatch, type SetStateAction } from "react";

import { useServerConfigs } from "../../state/entities";
import { createDraft, scheduledTaskDefaultModel } from "./scheduledTaskDraft";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

import {
  scheduledTaskEditorHasChanges,
  scheduledTaskEditorSessionAtom,
  startScheduledTaskEditor,
  updateScheduledTaskEditor,
  readScheduledTaskEditor,
  type ScheduledTaskEditor,
} from "./scheduled-task-editor-state";

/** The form draft lives in an atom, so it survives while its native picker routes are on top. */
export function useScheduledTaskEditor() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const configs = useServerConfigs();
  const defaultTarget = selectedTargets[0];
  const draftForEnvironment = (environmentId: EnvironmentId) =>
    createDraft(scheduledTaskDefaultModel(configs.get(environmentId) ?? null));
  // Direct links can open the new-task form before environments have connected.
  const defaultEditor = useMemo(
    () =>
      defaultTarget
        ? {
            environmentId: defaultTarget.environmentId,
            environmentLabel: defaultTarget.label,
            draft: draftForEnvironment(defaultTarget.environmentId),
          }
        : null,
    [defaultTarget, draftForEnvironment],
  );
  const session = useAtomValue(scheduledTaskEditorSessionAtom);
  const voiceOwnerKey = `scheduled-task:${session?.id ?? 0}`;
  const editor = session ? session.current : defaultEditor;
  const initial = session ? session.initial : defaultEditor;
  const hasChanges = scheduledTaskEditorHasChanges(initial, editor);
  const setEditor: Dispatch<SetStateAction<ScheduledTaskEditor | null>> = (update) => {
    updateScheduledTaskEditor(update, defaultEditor);
  };
  const startEditor = startScheduledTaskEditor;
  const resetEditor = () => startEditor(defaultEditor);
  const readEditor = () => readScheduledTaskEditor(voiceOwnerKey, defaultEditor);
  return {
    editor,
    voiceOwnerKey,
    readEditor,
    setEditor,
    startEditor,
    hasChanges,
    resetEditor,
    draftForEnvironment,
  };
}
