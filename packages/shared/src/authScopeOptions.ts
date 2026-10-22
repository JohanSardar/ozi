import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthDiagnosticsReadScope,
  AuthEnvironmentMaintainScope,
  AuthFilesystemReadScope,
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
    description: "Control network access and environment processes.",
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
    description: "Read files attached to conversations.",
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
