import { Atom } from "effect/reactivity";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useRouter } from "@tanstack/react-router";
import { openThreadFind } from "./chat/threadFindStore";
import { composerPromptLink, copyPromptLink } from "./promptLinks/copyPromptLink";
import { openGuestShareDialog } from "./chat/guestShareDialogState";
import { canShareWithGuestAtom } from "./chat/guestShareAvailability";
import { useAtomCommand } from "../state/use-atom-command";
import { threadEnvironment } from "../state/threads";
import { serverEnvironment } from "../state/server";
import { useServerConfigs } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { toastManager } from "./ui/toast";
import { LinkIcon, UserPlusIcon, RotateCcwIcon } from "lucide-react";
import { MonitorIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChartNoAxesColumnIcon,
  FileSearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TextSearchIcon,
} from "lucide-react";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { useAtomValue } from "@effect/atom-react";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  queueWorkspaceFocusFromPalette,
  restoreWorkspaceFocusFromPalette,
} from "../lib/workspaceFocus";
import {
  dispatchCommandPalette,
  getCommandPaletteReturnFocus,
  useCommandPaletteMount,
  useCommandPaletteStore,
} from "../commandPaletteStore";
import { cn } from "../lib/utils";
import { useAvailableSettingsSearchItems } from "./settings/useAvailableSettingsSearchItems";
import {
  buildCommandPaletteRows,
  type CommandPaletteActionItem,
  type CommandPaletteOpenIntent,
  type CommandPaletteReturnContext,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  ITEM_ICON_CLASS,
  type CommandPaletteGroup,
  type SearchOverlayMode,
} from "./CommandPalette.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import { useCommandPaletteThreadItems } from "./CommandPaletteThreadItems";
import { useCommandPaletteThemeItems } from "./CommandPaletteThemeItems";
import {
  CommandPaletteVirtualizedResults,
  scrollCommandPaletteRowIntoView,
} from "./CommandPaletteResults";
import { WorkspaceFilePicker } from "./files/WorkspaceFilePicker";
import { WorkspaceContentSearchDialog } from "./search/WorkspaceContentSearchDialog";
import { primaryServerKeybindingsAtom } from "../state/server";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";

const NO_GUEST_SHARE = Atom.make(false);
export function CommandPalette({ children }: { children: ReactNode }) {
  useCommandPaletteMount();
  const state = useCommandPaletteStore();
  const setOpen = (open: boolean) => dispatchCommandPalette({ _tag: "SetOpen", open });
  const openChildSearch = (mode: "files" | "content", context: CommandPaletteReturnContext) =>
    dispatchCommandPalette({ _tag: "OpenChildSearch", mode, context });
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <CommandDialog
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            dispatchCommandPalette({ _tag: "BackToCommand" });
            return;
          }
          setOpen(open);
        }}
      >
        <div className="contents" inert={state.open}>
          {children}
        </div>
        <CommandPaletteDialog
          mode={state.mode}
          session={state.session}
          openIntent={state.openIntent}
          setOpen={setOpen}
          openChildSearch={openChildSearch}
          initialContext={state.restoredSearch}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly mode: SearchOverlayMode;
  readonly session: number;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openChildSearch: (
    mode: "files" | "content",
    context: CommandPaletteReturnContext,
  ) => void;
  readonly initialContext: CommandPaletteReturnContext | undefined;
}) {
  const composerHandleRef = useComposerHandleContext();

  return (
    <CommandDialogPopup
      aria-label={
        props.mode === "files"
          ? "File picker"
          : props.mode === "content"
            ? "Search file contents"
            : "Command palette"
      }
      className={cn("overflow-hidden", props.mode === "content" && "h-105")}
      data-command-palette="true"
      data-palette-mode={props.mode}
      data-testid="command-palette"
      finalFocus={() => {
        if (restoreWorkspaceFocusFromPalette()) return false;
        const returnFocus = getCommandPaletteReturnFocus();
        if (returnFocus === false) return false;
        const composer = composerHandleRef?.current;
        // Behind the Settings modal the composer is inert and cannot take focus.
        if (!composer || document.querySelector("[data-app-modal]")) return returnFocus;
        composer.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      {props.mode === "files" ? (
        <WorkspaceFilePicker setOpen={props.setOpen} />
      ) : props.mode === "content" ? (
        <WorkspaceContentSearchDialog onOpenChange={props.setOpen} />
      ) : (
        <OpenCommandPaletteDialog
          key={props.session}
          openIntent={props.openIntent}
          setOpen={props.setOpen}
          openChildSearch={props.openChildSearch}
          initialContext={props.initialContext}
        />
      )}
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openChildSearch: (
    mode: "files" | "content",
    context: CommandPaletteReturnContext,
  ) => void;
  readonly initialContext: CommandPaletteReturnContext | undefined;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(
    props.initialContext?.query ??
      (props.openIntent?.kind === "search" ? props.openIntent.query : ""),
  );
  const [views, setViews] = useState<ReadonlyArray<CommandPaletteView>>([]);
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const resultListRef = useRef<LegendListRef | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { activeDraftThread, activeThread, defaultEnvironmentId, handleNewThread } =
    useHandleNewThread();
  const { changeThemeItem, changeAppearanceItem, themeEditorItem } = useCommandPaletteThemeItems();
  const settingsSearchItems: CommandPaletteActionItem[] = useAvailableSettingsSearchItems().map(
    (item) => ({
      kind: "action",
      value: `setting:${item.id}`,
      title: item.title,
      searchTerms: [item.title, ...(item.searchTerms ?? [])],
      icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: item.to, hash: item.targetId ?? item.id });
      },
    }),
  );
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const { threadItems, threadMessageItems, isSearchPending } = useCommandPaletteThreadItems({
    activeThread: activeThread ?? null,
    threadSearchQuery: views.length || isActionsOnly ? "" : deferredQuery,
  });
  const context: CommandPaletteReturnContext = {
    query,
    linkedThreadSearch: props.initialContext?.linkedThreadSearch ?? null,
  };
  const environmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? defaultEnvironmentId;
  const stopSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const canShare = useAtomValue(
    environmentId === null ? NO_GUEST_SHARE : canShareWithGuestAtom(environmentId),
  );
  const providers = useEnvironmentProviders();
  const configs = useServerConfigs();
  const router = useRouter();
  const route = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const target =
    route?.kind === "server" ? route.threadRef : route?.kind === "draft" ? route.draftId : null;
  const promptLink =
    target === null
      ? null
      : composerPromptLink({
          target,
          providers: environmentId ? (providers.get(environmentId) ?? []) : [],
          threadModelSelection: activeThread?.modelSelection ?? null,
          withContext: false,
        });
  const actions: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [
    ...(activeThread
      ? [
          {
            kind: "action" as const,
            value: "action:find",
            title: "Find in current chat",
            searchTerms: ["search", "find", "messages"],
            icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
            shortcutCommand: "chat.find" as const,
            run: async () =>
              openThreadFind(
                scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id)),
              ),
          },
        ]
      : []),
    ...(promptLink
      ? [
          {
            kind: "action" as const,
            value: "action:copy-prompt-link",
            title: "Copy prompt link",
            searchTerms: ["copy", "prompt", "share", "link"],
            icon: <LinkIcon className={ITEM_ICON_CLASS} />,
            run: () => copyPromptLink(promptLink),
          },
        ]
      : []),
    ...(activeThread && canShare
      ? [
          {
            kind: "action" as const,
            value: "action:share",
            title: "Share with guest",
            searchTerms: ["invite", "share", "guest"],
            icon: <UserPlusIcon className={ITEM_ICON_CLASS} />,
            run: async () =>
              openGuestShareDialog(scopeThreadRef(activeThread.environmentId, activeThread.id)),
          },
        ]
      : []),
    ...(activeThread
      ? [
          {
            kind: "action" as const,
            value: "action:restart",
            title: "Restart agent session",
            searchTerms: ["restart", "agent", "session", "refresh"],
            icon: <RotateCcwIcon className={ITEM_ICON_CLASS} />,
            run: async () => {
              const thread = activeThread;
              if (thread.runtime !== null) {
                const result = await stopSession({
                  environmentId: thread.environmentId,
                  input: { threadId: thread.id },
                });
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              }
              toastManager.add({
                type: "success",
                title: "Agent session will restart",
                description: "Your next message starts a fresh session.",
              });
              const cwd = thread.workingDirectory ?? configs.get(thread.environmentId)?.cwd;
              if (cwd) {
                const result = await refreshProviders({
                  environmentId: thread.environmentId,
                  input: {
                    instanceId:
                      thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
                    cwd,
                    fresh: true,
                  },
                });
                if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              }
            },
          },
        ]
      : []),
    {
      kind: "action",
      value: "action:new-chat",
      title: "New chat",
      searchTerms: ["new", "chat"],
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        if (environmentId) await handleNewThread(environmentId);
      },
    },
    {
      kind: "action",
      value: "action:files",
      title: "Search files",
      searchTerms: ["file", "find", "open"],
      icon: <FileSearchIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => props.openChildSearch("files", context),
    },
    {
      kind: "action",
      value: "action:contents",
      title: "Search file contents",
      searchTerms: ["search", "text", "contents"],
      icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => props.openChildSearch("content", context),
    },
    changeThemeItem,
    changeAppearanceItem,
    themeEditorItem,
    {
      kind: "action",
      value: "action:usage",
      title: "Open usage",
      searchTerms: ["tokens", "cost", "usage"],
      icon: <ChartNoAxesColumnIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/usage" });
      },
    },
    {
      kind: "action",
      value: "action:settings",
      title: "Open settings",
      searchTerms: ["settings", "preferences"],
      icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings" });
      },
    },
    ...[1, -1].map((direction) => ({
      kind: "action" as const,
      value: "action:focus:" + direction,
      title: direction === 1 ? "Focus Next Workspace Area" : "Focus Previous Workspace Area",
      icon: <MonitorIcon className={ITEM_ICON_CLASS} />,
      searchTerms: ["focus", "navigation"],
      run: async () => {
        queueWorkspaceFocusFromPalette(direction as 1 | -1);
      },
    })),
  ];
  const rootGroups: CommandPaletteGroup[] = [
    { value: "actions", label: "Actions", items: actions },
  ];
  const currentView =
    views.at(-1) ?? (props.openIntent?.kind === "change-theme" ? changeThemeItem : undefined);
  const groups = filterCommandPaletteGroups({
    activeGroups: currentView?.groups ?? rootGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== undefined,
    settingsSearchItems,
    threadSearchItems: threadItems,
    threadMessageItems,
  });
  const resultRows = buildCommandPaletteRows(groups);
  const executeItem = async (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => {
    if (item.kind === "submenu") {
      setViews([...views, item]);
      setQuery(item.initialQuery ?? "");
      return;
    }
    if (!item.keepOpen) props.setOpen(false);
    await item.run();
  };
  return (
    <CommandPaletteContent
      aria-label="Command palette"
      autoHighlight="always"
      footerActionLabel="Open"
      footerTrailing={isSearchPending ? "Searching messages…" : undefined}
      inputProps={{
        placeholder: "Search chats, settings and actions…",
        onKeyDown: (event) => {
          if (event.key === "Backspace" && !query && views.length) setViews(views.slice(0, -1));
        },
      }}
      mode="none"
      items={resultRows.itemValues}
      virtualized
      value={query}
      onValueChange={setQuery}
      onItemHighlighted={(value, details) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
        const row = resultRows.rowIndexByItemIndex[details.index];
        if (details.reason === "keyboard" && row !== undefined)
          scrollCommandPaletteRowIntoView(resultListRef.current, row);
      }}
      showBackHint={views.length > 0}
    >
      <CommandPaletteVirtualizedResults
        rows={resultRows.rows}
        listRef={resultListRef}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={executeItem}
      />
    </CommandPaletteContent>
  );
}
