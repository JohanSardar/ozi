import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { BotIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { RefreshIcon } from "../ui/refresh-icon";
import { cn } from "../../lib/utils";
import { T3Wordmark } from "../T3Wordmark";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarUpdateArchitectureWarning } from "./SidebarUpdatePill";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
  newChatShortcut,
  onNewChat,
}: {
  isElectron: boolean;
  newChatShortcut: string | null;
  onNewChat: (() => void) | null;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center justify-end gap-0.5 pr-2.5",
        isElectron && "drag-region",
      )}
      style={{ paddingLeft: "var(--workspace-controls-left)" }}
    >
      {pillLabel ? (
        <div className="relative z-10 mr-auto flex h-7 items-center">
          <Badge data-environment-identification="pill" size="sm" variant="secondary">
            {pillLabel}
          </Badge>
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              variant="ghost"
              className="relative top-auto z-10 translate-y-0 [-webkit-app-region:no-drag]"
              aria-label="Hide sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">Hide sidebar</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="New chat"
              className="relative top-auto z-10 size-[var(--workspace-titlebar-control-size)]! translate-y-0 [-webkit-app-region:no-drag]"
              disabled={onNewChat === null}
              onClick={() => onNewChat?.()}
              size="icon-sm"
              variant="ghost"
            >
              <SquarePenIcon className="size-4" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          New chat{newChatShortcut ? ` (${newChatShortcut})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-3"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-titlebar-content-left)] flex">
        <SidebarBrandMark onBackdrop={false} />
      </div>
    </div>
  );
}

function SidebarBrandMark(_props: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-sm font-medium tracking-tight">
      <T3Wordmark aria-label="Ozi" className="h-5 w-auto shrink-0" />
    </span>
  );
}

function SidebarUtilityItem({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} disabled={disabled} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const environmentId = usePrimaryEnvironmentId();
  const canRefreshProviders = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [refreshing, setRefreshing] = useState(false);

  const goTo = (to: "/settings" | "/settings/providers") => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to });
  };

  const handleRefreshClick = () => {
    if (refreshing || !environmentId) return;
    setRefreshing(true);
    void refreshServerProviders({ environmentId, input: { refreshModels: true } }).finally(() =>
      setRefreshing(false),
    );
  };

  return (
    <SidebarMenu className="flex-row items-center">
      <SidebarUtilityItem
        icon={<SettingsIcon />}
        label="Settings"
        onClick={() => goTo("/settings")}
      />
      <SidebarUtilityItem
        icon={<BotIcon />}
        label="Providers"
        onClick={() => goTo("/settings/providers")}
      />
      <SidebarUtilityItem
        disabled={refreshing || !environmentId || !canRefreshProviders}
        icon={<RefreshIcon refreshing={refreshing} />}
        label={refreshing ? "Refreshing providers" : "Refresh providers"}
        onClick={handleRefreshClick}
      />
      <SidebarThreadUndoNotice />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter>
      <SidebarUpdateArchitectureWarning />
      <SidebarUtilityMenu />
    </SidebarFooter>
  );
});
