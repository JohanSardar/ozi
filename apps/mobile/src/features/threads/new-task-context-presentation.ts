import type { ComposerDraftWorkspaceSelection } from "../../state/use-composer-drafts";

export function resolveNewTaskWorkspaceSelection(input: {
  readonly selection: ComposerDraftWorkspaceSelection | undefined;
  readonly fallback: ComposerDraftWorkspaceSelection;
}): ComposerDraftWorkspaceSelection {
  return input.selection ?? input.fallback;
}

export function resolveNewTaskWorkspaceLabel(input: {
  readonly workspaceMode: "local";
  readonly workingDirectory: string | null;
}): string {
  return input.workingDirectory ?? "Project folder";
}

export function resolveNewTaskLocalWorkspaceSelection(input: { readonly projectCwd: string }): {
  readonly workingDirectory: string | null;
} {
  return { workingDirectory: input.projectCwd };
}

export function resolveNewTaskDraftWorkspace(input: {
  readonly selection: ComposerDraftWorkspaceSelection | undefined;
  readonly canChooseWorkspace: boolean;
  readonly defaultMode: "local";
  readonly defaultModeSettled: boolean;
  readonly projectCwd: string | null;
}): ComposerDraftWorkspaceSelection {
  return input.selection ?? { mode: "local", workingDirectory: input.projectCwd };
}
