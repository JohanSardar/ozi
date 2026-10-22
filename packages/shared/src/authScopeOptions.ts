import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthDiagnosticsReadScope,
  AuthEnvironmentMaintainScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  type AuthGrantScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
} from "@t3tools/contracts";

export const AUTH_SCOPE_OPTIONS: ReadonlyArray<{
  readonly scope: AuthGrantScope;
  readonly title: string;
  readonly description: string;
}> = [
  {
    scope: AuthOrchestrationReadScope,
    title: "View environment",
    description: "Read threads, status, and configuration.",
  },
  {
    scope: AuthOrchestrationOperateScope,
    title: "Operate tasks",
    description: "Start, update, and stop tasks.",
  },
  {
    scope: AuthSettingsWriteScope,
    title: "Change environment settings",
    description: "Edit environment preferences and keybindings.",
  },
  {
    scope: AuthProvidersManageScope,
    title: "Manage providers",
    description: "Configure, install, sign in to, and update providers and usage sources.",
  },
  {
    scope: AuthEnvironmentMaintainScope,
    title: "Maintain environment",
    description: "Update the server and control environment processes.",
  },
  {
    scope: AuthPreviewOperateScope,
    title: "Control previews",
    description: "Open browser previews and host browser automation.",
  },
  {
    scope: AuthDiagnosticsReadScope,
    title: "View diagnostics and usage",
    description: "Read process diagnostics, resource history, and usage totals.",
  },
  {
    scope: AuthFilesystemReadScope,
    title: "Read files",
    description: "Browse host files, search workspaces, and inspect local changes.",
  },
  {
    scope: AuthFilesystemWriteScope,
    title: "Write files",
    description: "Edit workspace files and save plans to disk.",
  },
  {
    scope: AuthAccessReadScope,
    title: "View access",
    description: "Inspect pairing links and authorized clients.",
  },
  {
    scope: AuthAccessWriteScope,
    title: "Manage access",
    description: "Issue and revoke credentials for other clients.",
  },
];
