import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { type ReactNode } from "react";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";

export function AndroidWorkspaceSidebar(props: {
  readonly children: ReactNode;
  readonly onRequestVisibility: () => void;
}) {
  const workspace = useWorkspaceTabs()!;
  const enabled = useEnabledNavigationTabs();
  if (enabled.length === 0) return <WorkspaceNoTabs />;
  return (
    <WorkspaceTabPanes
      tabs={NAVIGATION_TAB_ORDER}
      selected={workspace.state.selectedTab}
      renderTab={() => props.children}
    />
  );
}
