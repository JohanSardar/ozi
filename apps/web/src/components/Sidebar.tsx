import { useStableCallback } from "../hooks/useStableCallback";
import { registerSettleAndAdvance } from "../settleAndAdvance";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { createSidebarListMotion } from "./Sidebar.motion";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  moveThreadContextDrag,
  endThreadContextDrag,
  dropThreadContext,
} from "./chat/threadContextDrag";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { deriveProviderEntriesByEnvironment } from "../providerInstances";
import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
  sortSettledThreads,
  pinOrderKeyBetween,
} from "@t3tools/client-runtime/state/thread-sort";
import { type ScopedThreadRef, type EnvironmentId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { SearchIcon, SquarePenIcon } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { isElectron } from "../env";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useThreadActionMenu } from "../hooks/useThreadActionMenu";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import { useClientSettings } from "../hooks/useSettings";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { useDelegatedUnderParent, useQuietThreadShells, useServerConfigs } from "../state/entities";
import {
  useEnvironmentMachines,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { ticketList } from "../state/tickets";
import { useThreadSearch } from "../state/queries";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../threadRoutes";
import { attachSidebarTree, SIDEBAR_TREE_PROPS } from "../lib/sidebarTree";
import {
  filterSidebarV2VisibleThreads,
  isSidebarNestedLinkClick,
  useSnoozeWakeClock,
  resolveSidebarThreadStatus,
  sidebarThreadKeyAtY,
  resolveSidebarSweepKeys,
} from "./Sidebar.logic";
import { SidebarPointerSensor } from "./Sidebar.pointer";
import { SidebarChromeHeader, SidebarChromeFooter } from "./sidebar/SidebarChrome";
import {
  SortableThreadRow,
  type SidebarSweepAction,
  type SidebarProviderEntry,
} from "./sidebar/SidebarThreadRow";
import { SidebarDraftBlock } from "./sidebar/SidebarDraftBlock";
import { useActiveRowReveal, type SidebarRouteReveal } from "./sidebar/routeReveal";
import { canShareWithGuestAtom } from "./chat/guestShareAvailability";
import { Button } from "./ui/button";
import { Kbd } from "./ui/kbd";
import { SidebarContent, SidebarGroup, SidebarInput, useSidebar } from "./ui/sidebar";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "../state/olderSettledShelf";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { readLocalApi } from "../localApi";

function ChatRow(props: {
  thread: EnvironmentThreadShell;
  active: boolean;
  now: number;
  defaultCwd: string | null;
  providers: ReadonlyMap<string, SidebarProviderEntry>;
  machine: ReturnType<typeof useEnvironmentMachines> extends ReadonlyMap<EnvironmentId, infer M>
    ? M
    : never;
  environmentLabel: string | null;
  onOpen: (ref: ScopedThreadRef, event?: MouseEvent) => void;
  onSweep: (ref: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => void;
  reveal: (row: HTMLElement, key: string) => void;
  onBulkMenu: (refs: ReadonlyArray<ScopedThreadRef>, position: { x: number; y: number }) => void;
}) {
  const { thread } = props;
  const ref = scopeThreadRef(thread.environmentId, thread.id);
  const key = scopedThreadKey(ref);
  const [title, setTitle] = useState<string | null>(null);
  const actions = useThreadActions();
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(thread.environmentId));
  const menu = useThreadActionMenu({
    threadRef: ref,
    defaultCwd: props.defaultCwd,
    onStartRename: () => setTitle(thread.title),
    canShareWithGuest,
  });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const snoozed = effectiveSnoozed(thread, { now: new Date(props.now).toISOString() });
  const settled = thread.settledOverride === "settled";
  return (
    <SortableThreadRow
      thread={thread}
      variant="slim"
      sortableId={key}
      sortableDisabled={false}
      contextDrag={false}
      variantAction={snoozed ? "unsnooze" : settled ? "unsettle" : "settle"}
      settlementSupported
      snoozeSupported
      pinningSupported
      isPinned={thread.pinnedAt !== null}
      dropVerb={null}
      dragOverPinned={false}
      sweepAction={null}
      snoozeWakeLabelText={thread.snoozedUntil ?? null}
      wokeAt={threadWokeAt(thread, { now: new Date(props.now).toISOString() })}
      isActive={props.active}
      isRouteThread={props.active}
      revealRef={props.reveal}
      jumpLabel={null}
      currentEnvironmentId={thread.environmentId}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.machine}
      providerEntryByInstanceId={props.providers}
      timestampFormat={timestampFormat}
      onThreadClick={(event, target) => props.onOpen(target, event)}
      onThreadActivate={props.onOpen}
      onStartRename={(_, value) => setTitle(value)}
      onRenameTitleChange={setTitle}
      onCommitRename={(_, value, original) => {
        setTitle(null);
        if (value.trim() && value.trim() !== original)
          void update({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, title: value.trim() },
          });
      }}
      onCancelRename={() => setTitle(null)}
      isRenaming={title !== null}
      renamingTitle={title ?? ""}
      onContextMenu={(_, position) => {
        const selected = useThreadSelectionStore.getState().selectedThreadKeys;
        if (selected.has(key) && selected.size > 1)
          props.onBulkMenu(
            [...selected].flatMap((key) => {
              const ref = parseScopedThreadKey(key);
              return ref ? [ref] : [];
            }),
            position,
          );
        else menu.openMenu(position);
      }}
      onSettle={(target) => {
        void actions.settleThread(target);
      }}
      onActionSweepStart={props.onSweep}
      onUnsettle={(target) => {
        void actions.unsettleThread(target);
      }}
      onSnooze={(target, preset) => {
        void actions.snoozeThread(target, preset.snoozedUntil);
      }}
      onUnsnooze={(target) => {
        void actions.unsnoozeThread(target);
      }}
      onUnpin={(target) => {
        void actions.confirmAndUnpinThread(target);
      }}
      onAcknowledgeWoke={acknowledgeWoke}
      onFileDropThreads={(target, files) => {
        useSidebarPendingFileDropStore
          .getState()
          .queuePendingFileDrop({ threadRef: target, files });
        props.onOpen(target);
      }}
    />
  );
}

export default function Sidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { environments } = useEnvironments();
  const configs = useServerConfigs();
  const providers = useEnvironmentProviders();
  const machines = useEnvironmentMachines();
  const byEnvironment = deriveProviderEntriesByEnvironment(
    [...providers].map(
      ([id, entries]) =>
        [id, entries, configs.get(id)?.settings ?? { providerInstances: {} }] as const,
    ),
  );
  const delegated = useDelegatedUnderParent();
  const threads = filterSidebarV2VisibleThreads(useQuietThreadShells(), delegated);
  const now = useSnoozeWakeClock(threads);
  const actions = useThreadActions();
  const { handleNewThread, defaultEnvironmentId } = useHandleNewThread();
  const [query, setQuery] = useState("");
  const [settledLimit, setSettledLimit] = useState(50);
  const search = useThreadSearch(
    environments.map((environment) => environment.environmentId),
    query,
  );
  const matches = new Set(
    search.matches.map((match) => `${match.environmentId}:${match.threadId}`),
  );
  const listed = query.trim()
    ? threads.filter(
        (thread) =>
          thread.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
          matches.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
      )
    : threads;
  const route = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const routeKey = route?.kind === "server" ? scopedThreadKey(route.threadRef) : null;
  const reveal = useActiveRowReveal(routeReveal, routeKey);
  const settledShelf = useOlderSettledShelf({
    scopes: environments.map((environment) => ({ environmentId: environment.environmentId })),
    expanded: true,
    visibleCount: settledLimit,
  });
  const ticketEnvironmentId = usePrimaryEnvironmentId();
  const ticketChats = new Set(
    (
      useEnvironmentQuery(
        ticketEnvironmentId ? ticketList({ environmentId: ticketEnvironmentId, input: {} }) : null,
      ).data?.tickets ?? []
    ).map((ticket) => `${ticketEnvironmentId}:${ticket.origin.chatId}`),
  );
  const groups = new Map<string, EnvironmentThreadShell[]>([
    ["Needs you", []],
    ["Working", []],
    ["Pinned", []],
    ["Recent", []],
  ]);
  const settled: EnvironmentThreadShell[] = [];
  for (const thread of listed) {
    const status = resolveSidebarThreadStatus(thread);
    const section =
      ticketChats.has(`${thread.environmentId}:${thread.id}`) ||
      ["approval", "input", "request"].includes(status)
        ? "Needs you"
        : status === "working"
          ? "Working"
          : thread.pinnedAt !== null
            ? "Pinned"
            : "Recent";
    if (section === "Recent" && thread.settledOverride === "settled") {
      if (settledShelf.isListed(thread)) settled.push(thread);
    } else groups.get(section)!.push(thread);
  }
  for (const [label, group] of groups)
    groups.set(
      label,
      label === "Pinned" ? sortPinnedThreadsByOrderKey(group) : sortActiveThreadsByOrderKey(group),
    );
  const settledSorted = sortSettledThreads(settled);
  useOlderSettledShelfGrowth(settledShelf, settledSorted);
  const settledCount = settledSorted.length + settledShelf.unloadedCount(threads);
  groups.set("Recent", [...groups.get("Recent")!, ...settledSorted.slice(0, settledLimit)]);
  const onBulkMenu = async (
    refs: ReadonlyArray<ScopedThreadRef>,
    position: { x: number; y: number },
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const action = await api.contextMenu.show(
      [
        { id: "settle", label: "Settle selected", icon: "check" },
        { id: "archive", label: "Archive selected", icon: "archive" },
        { id: "delete", label: "Delete selected", icon: "trash" },
      ],
      position,
    );
    if (action === null) return;
    if (
      action === "delete" &&
      !(await api.dialogs.confirm(
        "Delete " + refs.length + " chats? This permanently clears their conversation history.",
        { variant: "destructive" },
      ))
    )
      return;
    for (const ref of refs)
      await (action === "delete"
        ? actions.deleteThread(ref)
        : action === "archive"
          ? actions.archiveThread(ref)
          : actions.settleThread(ref));
    useThreadSelectionStore.getState().clearSelection();
  };
  const ordered = [...groups.values()].flat();
  const keys = ordered.map((thread) =>
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
  );
  const list = useRef<HTMLUListElement | null>(null);
  const sensor = useRef<SidebarPointerSensor | null>(null);
  const motion = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);

  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const terminalFocused = useTerminalFocus();
  const newChatShortcut = shortcutLabelForCommand(keybindings, "chat.new");
  function onOpen(ref: ScopedThreadRef, event?: MouseEvent) {
    if (event && isSidebarNestedLinkClick(event.target)) return;
    const key = scopedThreadKey(ref);
    const selection = useThreadSelectionStore.getState();
    if (event?.shiftKey) {
      selection.rangeSelectTo(key, keys);
      return;
    }
    if (event?.metaKey || event?.ctrlKey) {
      selection.toggleThread(key);
      return;
    }
    selection.clearSelection();
    selection.setAnchor(key);
    void router.navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
    setOpenMobile(false);
  }
  const navigateKey = (key: string | undefined) => {
    const ref = key ? parseScopedThreadKey(key) : null;
    if (ref) onOpen(ref);
  };
  const keydown = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || terminalFocused || isModelPickerOpen()) return;
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: {
        terminalFocus: isTerminalFocused(),
        terminalOpen: false,
        modelPickerOpen: isModelPickerOpen(),
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    });
    const direction = threadTraversalDirectionFromCommand(command);
    const index = threadJumpIndexFromCommand(command ?? "");
    if (direction !== null) {
      event.preventDefault();
      const current = routeKey === null ? -1 : keys.indexOf(routeKey);
      navigateKey(keys[(current + (direction === "next" ? 1 : -1) + keys.length) % keys.length]);
    } else if (index !== null) {
      event.preventDefault();
      navigateKey(keys[index]);
    }
  });

  const settle = useStableCallback((ref: ScopedThreadRef) => {
    const index = keys.indexOf(scopedThreadKey(ref));
    const next =
      keys.slice(index + 1).find((key) => key !== scopedThreadKey(ref)) ?? keys[index - 1];
    void actions.settleThread(ref).then((result) => {
      if (result._tag === "Success" && routeKey === scopedThreadKey(ref)) navigateKey(next);
    });
  });

  const dragPoint = (event: DragEndEvent) => {
    const origin = event.activatorEvent;
    return "clientX" in origin && "clientY" in origin
      ? { x: Number(origin.clientX) + event.delta.x, y: Number(origin.clientY) + event.delta.y }
      : null;
  };
  const dragRefs = (id: string) => {
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    return (selected.has(id) ? [...selected] : [id]).flatMap((key) => {
      const ref = parseScopedThreadKey(key);
      return ref ? [ref] : [];
    });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onSweep = (ref: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
    const origin = scopedThreadKey(ref);
    const apply = (key: string) => {
      const target = parseScopedThreadKey(key);
      if (target)
        void (action === "settle"
          ? actions.settleThread(target)
          : action === "unsettle"
            ? actions.unsettleThread(target)
            : actions.unsnoozeThread(target));
    };
    let swept: string[] = [];
    const sensorInstance = new SidebarPointerSensor({
      active: origin,
      event,
      options: {
        distance: 6,
        onAttach: () => {
          list.current?.setAttribute("data-sweeping", action);
        },
        onFinish: () => {
          list.current?.removeAttribute("data-sweeping");
          list.current?.removeAttribute("data-pending-sweep");
          sensor.current = null;
        },
      },
      onPending: () => {
        list.current?.setAttribute("data-pending-sweep", origin);
      },
      onStart: () => {
        swept = [origin];
      },
      onMove: ({ y }) => {
        const target = list.current && sidebarThreadKeyAtY(list.current, y);
        if (target)
          swept = resolveSidebarSweepKeys(keys, origin, target, (key) => keys.includes(key));
      },
      onEnd: () => {
        for (const key of swept) apply(key);
      },
      onCancel: () => {
        list.current?.removeAttribute("data-pending-sweep");
      },
      onAbort: () => {
        list.current?.removeAttribute("data-pending-sweep");
      },
    });
    sensor.current = sensorInstance;
  };
  const onDrop = (event: DragEndEvent) => {
    const { active, over } = event;
    const point = dragPoint(event);
    const dropped = point !== null && dropThreadContext(point, dragRefs(String(active.id)));
    endThreadContextDrag();
    if (dropped) return;
    if (!over || active.id === over.id) return;
    const from = ordered.find(
      (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === active.id,
    );
    const to = ordered.find(
      (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === over.id,
    );
    if (!from || !to) return;
    const ref = scopeThreadRef(from.environmentId, from.id);
    if (to.pinnedAt !== null) {
      const pinned = groups.get("Pinned")!.filter((thread) => thread !== from);
      const index = pinned.indexOf(to);
      const key = pinOrderKeyBetween(
        pinned[index - 1]?.pinOrderKey ?? null,
        to.pinOrderKey ?? null,
      );
      if (key)
        void (from.pinnedAt === null
          ? actions.pinThread(ref, { orderKey: key })
          : actions.reorderPinnedThread(ref, key));
    } else if (from.pinnedAt !== null) void actions.confirmAndUnpinThread(ref);
    else if (to.settledOverride === "settled") void actions.settleThread(ref);
    else if (from.settledOverride === "settled") void actions.unsettleThread(ref);
    else {
      const recent = groups.get("Recent")!.filter((thread) => thread !== from);
      const index = recent.indexOf(to);
      const key = pinOrderKeyBetween(
        recent[index - 1]?.activeOrderKey ?? null,
        to.activeOrderKey ?? null,
      );
      if (key) void actions.reorderActiveThread(ref, key);
    }
  };
  return (
    <>
      <ThreadContextDragGhost />
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup>
            <div className="flex items-center gap-2">
              <SearchIcon className="size-4" />
              <SidebarInput
                aria-label="Search chats"
                placeholder="Search chats"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
            <Button
              className="mt-2 justify-start"
              variant="ghost"
              disabled={defaultEnvironmentId === null}
              onClick={() => {
                if (defaultEnvironmentId) void handleNewThread(defaultEnvironmentId);
              }}
            >
              <SquarePenIcon className="size-4" />
              New chat
              {newChatShortcut ? <Kbd className="ml-auto">{newChatShortcut}</Kbd> : null}
            </Button>
          </SidebarGroup>
        }
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDrop}
          onDragCancel={endThreadContextDrag}
          onDragMove={(event) => {
            const point = dragPoint(event);
            const bounds = list.current?.getBoundingClientRect();
            if (point && bounds && (point.x < bounds.left || point.x > bounds.right)) {
              const thread = ordered.find(
                (thread) =>
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                  event.active.id,
              );
              if (thread)
                moveThreadContextDrag(point, {
                  title: thread.title,
                  count: dragRefs(String(event.active.id)).length,
                });
            } else endThreadContextDrag();
          }}
        >
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <ul
              {...SIDEBAR_TREE_PROPS}
              ref={(element) => {
                list.current = element;
                const tree = attachSidebarTree(element);
                if (!element) return tree;
                const controller = createSidebarListMotion(element);
                motion.current = controller;
                controller.update(false);
                const observer = new MutationObserver(() => controller.update(true));
                observer.observe(element, { childList: true, subtree: true });
                window.addEventListener("keydown", keydown);
                const unregister = registerSettleAndAdvance(settle);
                return () => {
                  window.removeEventListener("keydown", keydown);
                  unregister();
                  observer.disconnect();
                  tree?.();
                  controller.dispose();
                  sensor.current?.cancel();
                  endThreadContextDrag();
                  motion.current = null;
                };
              }}
              className="relative px-2"
            >
              <SidebarDraftBlock
                routeDraftId={route?.kind === "draft" ? route.draftId : null}
                onNavigateToDraft={(draftId) => {
                  void router.navigate({ to: "/draft/$draftId", params: { draftId } });
                }}
                onDraftContextMenu={(draftId, position) => {
                  void readLocalApi()
                    ?.contextMenu.show(
                      [{ id: "discard", label: "Discard draft", icon: "trash" }],
                      position,
                    )
                    .then((action) => {
                      if (action === "discard") discardComposerDraft(draftId);
                    });
                }}
              />
              {[...groups].map(([label, rows]) =>
                rows.length === 0 ? null : (
                  <li key={label} className="list-none">
                    <h2 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </h2>
                    <ul>
                      {rows.map((thread) => {
                        const key = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        return (
                          <ChatRow
                            key={key}
                            thread={thread}
                            active={key === routeKey}
                            now={now}
                            defaultCwd={configs.get(thread.environmentId)?.cwd ?? null}
                            providers={byEnvironment.get(thread.environmentId) ?? new Map()}
                            machine={machines.get(thread.environmentId) ?? "server"}
                            environmentLabel={
                              environments.length > 1
                                ? (environments.find(
                                    (environment) =>
                                      environment.environmentId === thread.environmentId,
                                  )?.label ?? null)
                                : null
                            }
                            onOpen={onOpen}
                            onSweep={onSweep}
                            reveal={reveal}
                            onBulkMenu={onBulkMenu}
                          />
                        );
                      })}
                    </ul>
                  </li>
                ),
              )}
              {settledCount > settledLimit ? (
                <li className="list-none">
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => setSettledLimit((limit) => limit + 50)}
                  >
                    Show more settled chats
                  </Button>
                </li>
              ) : null}
            </ul>
          </SortableContext>
        </DndContext>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
