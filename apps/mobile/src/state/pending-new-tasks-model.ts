import type { EnvironmentId } from "@t3tools/contracts";

import { deriveThreadTitleFromPrompt } from "../lib/threadStartTurn";
import type { QueuedThreadCreation, QueuedThreadMessage } from "./thread-outbox-model";
import { isNewTaskDraftKey } from "./new-task-draft-key";
import type { ComposerDraft } from "./use-composer-drafts";

export type PendingNewTask = PendingQueuedTask | PendingDraftTask;

export interface PendingQueuedTask {
  readonly kind: "pending";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly defaultCwd: string | undefined;
  readonly title: string;
  readonly createdAt: string;
  readonly message: QueuedThreadMessage;
  readonly creation: QueuedThreadCreation;
}

export interface PendingDraftTask {
  readonly kind: "draft";
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly defaultCwd: undefined;
  readonly title: string;
  readonly createdAt: string;
  readonly draftKey: string;
  readonly draft: ComposerDraft;
}

function composerDraftHasUserContent(draft: ComposerDraft): boolean {
  return draft.text.trim().length > 0 || draft.attachments.length > 0;
}

function draftTitle(draft: ComposerDraft): string {
  if (draft.text.trim().length > 0) {
    return deriveThreadTitleFromPrompt(draft.text);
  }
  const count = draft.attachments.length;
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

/** A project's new-task defaults, as useNewTaskProjectDefaults resolves them. */
export interface PendingDraftDefaults {
  readonly canChooseWorkspace: boolean;
  readonly defaultMode: "local";
  readonly defaultModeSettled: boolean;
}

export function buildPendingNewTasks(input: {
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
  readonly drafts: Readonly<Record<string, ComposerDraft>>;
}): ReadonlyArray<PendingNewTask> {
  const tasks: PendingNewTask[] = [];
  for (const message of input.queuedMessages) {
    if (!message.creation) {
      continue;
    }
    tasks.push({
      kind: "pending",
      key: `pending-task:${message.messageId}`,
      environmentId: message.environmentId,
      defaultCwd: message.creation.defaultCwd,
      title: deriveThreadTitleFromPrompt(message.text),
      createdAt: message.createdAt,
      message,
      creation: message.creation,
    });
  }
  for (const [draftKey, draft] of Object.entries(input.drafts)) {
    if (
      !isNewTaskDraftKey(draftKey) ||
      !draft.environmentStamp ||
      !composerDraftHasUserContent(draft)
    ) {
      continue;
    }
    tasks.push({
      kind: "draft",
      key: `draft-task:${draftKey}`,
      environmentId: draft.environmentStamp.environmentId,
      defaultCwd: undefined,
      title: draftTitle(draft),
      createdAt: draft.environmentStamp.createdAt,
      draftKey,
      draft,
    });
  }
  tasks.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "draft" ? -1 : 1;
    }
    return right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key);
  });
  return tasks;
}
