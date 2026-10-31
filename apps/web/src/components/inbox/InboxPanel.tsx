import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, Ticket } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  ReplyIcon,
  ScanEyeIcon,
  BookOpenIcon,
  InboxIcon,
  Maximize2Icon,
  PanelRightIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import {
  isRichTextMarkShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import { isEditableFocused } from "../../lib/editableFocus";
import { cn } from "../../lib/utils";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { environmentThreadShells } from "../../state/threads";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  ticketChoose,
  ticketClose,
  ticketList,
  toggleInbox,
  useInboxStore,
  useTicketReplyStore,
} from "../../state/tickets";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { RichActionsContext } from "../chat/RichBlocks";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TicketImage, TicketPages, ticketThumbnail } from "./TicketMedia";
import { Age, Choices, clearedBy, TicketWindow } from "./TicketWindow";

export interface TicketHooks {
  readonly choose?: (ticket: Ticket, index: number) => void;
  readonly reply?: (ticket: Ticket, text: string) => void;
}

const GROUPS = [
  ["Decide", "questions and approvals", MessageCircleQuestionIcon],
  ["Do", "only you can do these", ListChecksIcon],
  ["Review", "finished work", ScanEyeIcon],
  ["Read", "nothing to do", BookOpenIcon],
] as const;

export const orderTickets = (tickets: ReadonlyArray<Ticket>) =>
  GROUPS.flatMap(([group]) => tickets.filter((ticket) => ticket.group === group));

function useInboxShortcutLabel() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const label = shortcutLabelForCommand(keybindings, "inbox.toggle");
  return label ? ` (${label})` : "";
}

export function InboxPanel(props: TicketHooks) {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const hidden = useInboxStore((state) => state.hidden);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that toggles the inbox on its shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        isRichTextMarkShortcut(event, window.getSelection(), "i") &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      )
        return;
      if (resolveShortcutCommand(event, keybindings) !== "inbox.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      toggleInbox();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  const inboxPage = useLocation({ select: (location) => location.pathname === "/inbox" });
  return environmentId && !hidden && !inboxPage ? (
    <Inbox environmentId={environmentId} hooks={props} />
  ) : null;
}

export function InboxPage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const navigate = useNavigate();
  const reply = (ticket: Ticket, text: string) => {
    if (!environmentId) return;
    useTicketReplyStore.setState({ pending: { ticket, text } });
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, ticket.origin.chatId)),
    });
  };
  return environmentId ? <Inbox environmentId={environmentId} hooks={{ reply }} page /> : null;
}

export function ShowInboxButton() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const hidden = useInboxStore((state) => state.hidden);
  const shortcut = useInboxShortcutLabel();
  const count =
    useEnvironmentQuery(environmentId && hidden ? ticketList({ environmentId, input: {} }) : null)
      .data?.tickets.length ?? 0;
  if (!hidden) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="relative ms-2 hidden shrink-0 lg:inline-flex [-webkit-app-region:no-drag]"
            aria-label={`Show inbox${shortcut}`}
            onClick={toggleInbox}
          />
        }
      >
        <InboxIcon className="size-4" />
        {count > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">Show inbox{shortcut}</TooltipPopup>
    </Tooltip>
  );
}

function Inbox(props: { environmentId: EnvironmentId; hooks: TicketHooks; page?: boolean }) {
  const { environmentId, page = false } = props;
  const routeRef = useThreadRouteRef();
  const choose = useAtomCommand(ticketChoose);
  const chat = routeRef?.environmentId === environmentId ? { chatId: routeRef.threadId } : {};
  const hooks: TicketHooks = {
    ...props.hooks,
    choose: (ticket, choiceIndex) => {
      void choose({ environmentId, input: { id: ticket.id, choiceIndex, ...chat } });
    },
  };
  const { tab, selected } = useInboxStore();
  const setTab = (next: typeof tab) => useInboxStore.setState({ tab: next });
  const setSelected = (next: typeof selected) => useInboxStore.setState({ selected: next });
  const [search, setSearch] = useState("");
  const [workingOpen, setWorkingOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (group: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const [details, setDetails] = useState<Ticket | null>(null);
  const [archivedPick, setArchivedPick] = useState<string | null>(null);
  const shortcut = useInboxShortcutLabel();
  const navigate = useNavigate();
  const close = useAtomCommand(ticketClose);
  const threads = useAtomValue(environmentThreadShells.environmentThreadsAtom(environmentId));
  const open = useEnvironmentQuery(ticketList({ environmentId, input: {} })).data?.tickets ?? [];
  const query = search.trim();
  const archived =
    useEnvironmentQuery(
      tab === "archive"
        ? ticketList({
            environmentId,
            input: {
              status: "archived",
              ...(query ? { search: query } : {}),
            },
          })
        : null,
    ).data?.tickets ?? [];
  const ordered = orderTickets(open);
  const current = page
    ? ordered.find((ticket) => ticket.id === archivedPick)
    : selected.index < 0
      ? undefined
      : (ordered.find((ticket) => ticket.id === selected.id) ??
        ordered[Math.min(selected.index, ordered.length - 1)]);
  const shown = details && (open.find((ticket) => ticket.id === details.id) ?? details);
  const titles = new Map(threads.map((thread) => [thread.id, thread.title]));
  const jobs = threads.flatMap((thread) =>
    (thread.pendingBackgroundTasks ?? []).flatMap((task) =>
      task.kind === "subagent"
        ? [
            {
              id: task.taskId,
              threadId: task.childThreadId ?? thread.id,
              title: task.description ?? titles.get(task.childThreadId ?? thread.id) ?? "",
              chat: titles.get(thread.lineage.rootThreadId) ?? "",
            },
          ]
        : [],
    ),
  );
  const toggle = (ticket: Ticket) =>
    setSelected(
      current?.id === ticket.id
        ? { id: null, index: -1 }
        : { id: ticket.id, index: ordered.indexOf(ticket) },
    );
  const gotIt = (ticket: Ticket) => {
    setSelected({ id: null, index: ordered.indexOf(ticket) });
    void close({ environmentId, input: { id: ticket.id, by: { type: "acknowledged" }, ...chat } });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that picks a choice on the open ticket
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        tab !== "inbox" ||
        details ||
        !current ||
        (!page && collapsed.has(current.group)) ||
        !hooks.choose
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableFocused(event.target)) return;
      const index = Number(event.key) - 1;
      if (!(index >= 0 && index < current.choices.length)) return;
      event.preventDefault();
      hooks.choose(current, index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, details, current, hooks, collapsed, page]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that leaves the full-screen ticket on Escape
  useEffect(() => {
    if (!page || archivedPick === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isEditableFocused(event.target)) setArchivedPick(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, archivedPick]);

  if (page) {
    const expanded =
      tab === "inbox"
        ? ordered.find((ticket) => ticket.id === archivedPick)
        : archived.find((ticket) => ticket.id === archivedPick);
    const tile = (ticket: Ticket) => {
      const thumbnail = ticketThumbnail(ticket);
      return (
        <button
          key={ticket.id}
          type="button"
          onClick={() => setArchivedPick(ticket.id)}
          className="flex flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-ring/40 hover:bg-accent/40"
        >
          <span className="flex gap-3">
            <span className="min-w-0 flex-1">
              <span className="block wrap-anywhere text-sm font-medium">{ticket.title}</span>
              <span className="mt-1.5 block wrap-anywhere text-sm font-semibold leading-snug">
                {ticket.need}
              </span>
            </span>
            {thumbnail ? (
              <TicketImage
                environmentId={environmentId}
                ticket={ticket}
                image={thumbnail}
                className="size-16 shrink-0 rounded-md"
              />
            ) : null}
          </span>
          <span className="mt-1.5 block wrap-anywhere text-sm leading-relaxed text-muted-foreground">
            {ticket.summary}
          </span>
          <span className="mt-auto flex items-center gap-1 pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {ticket.status === "open" ? "" : `${clearedBy(ticket)} · `}
              {titles.get(ticket.origin.chatId) ?? ""}
            </span>
            <span className="shrink-0">
              · <Age iso={ticket.createdAt} />
            </span>
            {ticket.status === "open" && ticket.choices.length > 0 ? (
              <span className="ms-auto shrink-0 tabular-nums">{ticket.choices.length} choices</span>
            ) : null}
          </span>
        </button>
      );
    };
    const grid = "mx-auto grid w-full max-w-3xl gap-3";
    return (
      <main aria-label="Inbox" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {expanded ? (
          <TicketWindow
            key={expanded.id}
            inline
            environmentId={environmentId}
            ticket={expanded}
            titles={titles}
            onClose={() => setArchivedPick(null)}
            onChoose={(index) => hooks.choose?.(expanded, index)}
            onReply={(text) => hooks.reply?.(expanded, text)}
            onGotIt={() => gotIt(expanded)}
          />
        ) : (
          <>
            <div
              role="tablist"
              className="flex h-(--workspace-topbar-height) shrink-0 items-stretch gap-5 border-b border-border px-5"
            >
              {(["inbox", "archive"] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                  className={cn(
                    "inline-flex items-center gap-1.5 border-b-2 pt-0.5 text-sm font-medium transition-colors",
                    tab === name
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {name === "inbox" ? "Inbox" : "Archive"}
                  {name === "inbox" && open.length > 0 ? (
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {open.length}
                    </span>
                  ) : null}
                </button>
              ))}
              {tab === "archive" ? (
                <div className="relative ms-auto w-72 self-center">
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search archive"
                      aria-label="Search archive"
                    />
                  </InputGroup>
                </div>
              ) : null}
            </div>
            <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto px-6 pb-8">
              {tab === "inbox" ? (
                GROUPS.map(([group, hint, Glyph]) => {
                  const tickets = ordered.filter((ticket) => ticket.group === group);
                  return tickets.length === 0 ? null : (
                    <section key={group} aria-label={group} className="mx-auto max-w-3xl pt-5">
                      <GroupHeading
                        group={group}
                        hint={hint}
                        count={tickets.length}
                        collapsed={collapsed.has(group)}
                        onToggle={() => toggleGroup(group)}
                        glyph={Glyph}
                      />
                      {collapsed.has(group) ? null : (
                        <div className={grid}>{tickets.map(tile)}</div>
                      )}
                    </section>
                  );
                })
              ) : (
                <div className={cn(grid, "pt-6")}>{archived.map(tile)}</div>
              )}
              {(tab === "inbox" ? ordered : archived).length === 0 ? (
                <div className="py-24 text-center text-sm text-muted-foreground">
                  {tab === "inbox"
                    ? "You're all caught up"
                    : query
                      ? `Nothing matches “${query}”`
                      : "Cleared tickets show up here."}
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>
    );
  }

  return (
    <aside
      aria-label="Inbox"
      className="ms-auto hidden w-(--inbox-width) shrink-0 flex-col border-l border-border bg-sidebar text-sidebar-foreground lg:flex"
    >
      <div
        role="tablist"
        className="flex h-(--workspace-topbar-height) shrink-0 items-stretch gap-5 border-b border-border ps-3.5 pe-2.5"
      >
        {(["inbox", "archive"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 pt-0.5 text-sm font-medium transition-colors",
              tab === name
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {name === "inbox" ? "Inbox" : "Archive"}
            {name === "inbox" && open.length > 0 ? (
              <span className="font-normal text-muted-foreground tabular-nums">{open.length}</span>
            ) : null}
          </button>
        ))}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="ms-auto self-center"
                aria-label={`Hide inbox${shortcut}`}
                onClick={toggleInbox}
              />
            }
          >
            <PanelRightIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Hide inbox{shortcut}</TooltipPopup>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-0.5 pb-4">
        {tab === "inbox" ? (
          <>
            {GROUPS.map(([group, hint, Glyph]) => {
              const tickets = ordered.filter((ticket) => ticket.group === group);
              return tickets.length === 0 ? null : (
                <section key={group} aria-label={group} className="mt-3.5 first:mt-3">
                  <GroupHeading
                    group={group}
                    hint={hint}
                    count={tickets.length}
                    collapsed={collapsed.has(group)}
                    onToggle={() => toggleGroup(group)}
                    glyph={Glyph}
                  />
                  {collapsed.has(group)
                    ? null
                    : tickets.map((ticket) => (
                        <TicketRow
                          key={ticket.id}
                          environmentId={environmentId}
                          ticket={ticket}
                          chat={titles.get(ticket.origin.chatId) ?? ""}
                          open={current?.id === ticket.id}
                          reveal={current?.id === ticket.id && selected.reveal === true}
                          hooks={hooks}
                          onToggle={() => toggle(ticket)}
                          onGotIt={() => gotIt(ticket)}
                          onOpenDetails={() => setDetails(ticket)}
                        />
                      ))}
                </section>
              );
            })}
            {ordered.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                <b className="mb-1 block font-medium text-foreground">You're all caught up</b>
                New things that need you will show up here.
              </div>
            ) : null}
            {jobs.length > 0 ? (
              <section aria-label="Working" className="mt-3.5">
                <button
                  type="button"
                  aria-expanded={workingOpen}
                  onClick={() => setWorkingOpen(!workingOpen)}
                  className="flex w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", !workingOpen && "-rotate-90")}
                  />
                  Working ·
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {jobs.length}
                  </span>
                </button>
                {workingOpen ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {jobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() =>
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams(
                              scopeThreadRef(environmentId, job.threadId),
                            ),
                          })
                        }
                        className="flex w-full items-center gap-3 border-border px-3 py-2 text-left not-first:border-t hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{job.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {job.chat}
                          </span>
                        </span>
                        <Spinner size="xs" tone="muted" aria-label="Working" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : tab === "archive" ? (
          <>
            <div className="relative mt-3 mb-2.5">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search archive"
                  aria-label="Search archive"
                />
              </InputGroup>
            </div>
            {archived.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setDetails(ticket)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-card"
              >
                <span className="min-w-0 flex-1">
                  <span className="block wrap-anywhere text-sm font-medium">{ticket.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {clearedBy(ticket)} · {titles.get(ticket.origin.chatId) ?? ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticket.cleared ? <Age iso={ticket.cleared.at} /> : null}
                </span>
              </button>
            ))}
            {archived.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {query ? `Nothing matches “${query}”` : "Cleared tickets show up here."}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {shown ? (
        <TicketWindow
          environmentId={environmentId}
          ticket={shown}
          titles={titles}
          onClose={() => setDetails(null)}
          onChoose={(index) => hooks.choose?.(shown, index)}
          onReply={(text) => hooks.reply?.(shown, text)}
          onGotIt={() => gotIt(shown)}
        />
      ) : null}
    </aside>
  );
}

function GroupHeading(props: {
  group: string;
  hint: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  glyph: typeof InboxIcon;
}) {
  const Glyph = props.glyph;
  return (
    <h2>
      <button
        type="button"
        aria-expanded={!props.collapsed}
        onClick={props.onToggle}
        aria-description={props.hint}
        className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm font-medium hover:bg-accent"
      >
        <Glyph className="size-3.5 text-muted-foreground" />
        {props.group}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">
          {props.count}
        </span>
        <ChevronDownIcon
          className={cn(
            "ms-auto size-3.5 text-muted-foreground transition-transform",
            props.collapsed && "-rotate-90",
          )}
        />
      </button>
    </h2>
  );
}

function TicketRow(props: {
  environmentId: EnvironmentId;
  ticket: Ticket;
  chat: string;
  open: boolean;
  reveal: boolean;
  hooks: TicketHooks;
  onToggle: () => void;
  onGotIt: () => void;
  onOpenDetails: () => void;
}) {
  const { environmentId, ticket, hooks } = props;
  const [reply, setReply] = useState("");
  const thumbnail = ticketThumbnail(ticket);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const [quoted, setQuoted] = useState<string | null>(null);
  const quote = (text: string) => {
    setQuoted(text);
    requestAnimationFrame(() => replyField.current?.focus());
  };
  const send = () => {
    if (!reply.trim() || !hooks.reply) return;
    hooks.reply(
      ticket,
      quoted
        ? `${quoted
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n${reply.trim()}`
        : reply.trim(),
    );
    setQuoted(null);
    setReply("");
  };
  return (
    <article
      ref={
        props.reveal
          ? (element) => {
              element?.scrollIntoView({ block: "nearest" });
              useInboxStore.setState(({ selected }) => ({
                selected: { ...selected, reveal: false },
              }));
            }
          : undefined
      }
      aria-label={ticket.title}
      className="group/ticket relative mb-2 rounded-lg border border-border bg-card transition-colors focus-within:border-ring/40 hover:border-ring/40"
    >
      <div className="pointer-events-none absolute -top-3.5 end-2 z-10 flex gap-0.5 rounded-lg border border-border bg-popover p-0.5 opacity-0 shadow-md transition-opacity group-hover/ticket:pointer-events-auto group-hover/ticket:opacity-100 group-focus-within/ticket:pointer-events-auto group-focus-within/ticket:opacity-100">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (!props.open) props.onToggle();
            quote(ticket.need);
          }}
        >
          <ReplyIcon />
          Reply
        </Button>
        <Button variant="ghost" size="xs" onClick={props.onOpenDetails}>
          <Maximize2Icon />
          Open
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            void navigator.clipboard.writeText(
              [ticket.title, ticket.need, ticket.summary, ticket.markdown]
                .filter(Boolean)
                .join("\n\n"),
            )
          }
        >
          <CopyIcon />
          Copy
        </Button>
      </div>
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block wrap-anywhere text-sm font-medium leading-snug">
            {ticket.title}
          </span>
          <span className="mt-px block truncate text-xs text-muted-foreground">
            {props.chat} · <Age iso={ticket.createdAt} />
          </span>
        </span>
        {thumbnail ? (
          <TicketImage
            environmentId={environmentId}
            ticket={ticket}
            image={thumbnail}
            className="size-9 shrink-0 rounded-md"
          />
        ) : null}
      </button>
      {props.open ? (
        <div className="px-3.5 pb-3.5">
          <RichActionsContext value={{ quote, send: (text) => hooks.reply?.(ticket, text) }}>
            <p className="mb-1.5 wrap-anywhere text-sm font-semibold leading-snug">{ticket.need}</p>
            <p className="wrap-anywhere whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {ticket.summary}
            </p>
            {ticket.htmlPages.length > 0 ? (
              <div className="mt-3 grid gap-2">
                <TicketPages environmentId={environmentId} ticket={ticket} />
              </div>
            ) : null}
            {ticket.choices.length > 0 ? (
              <div className="mt-3">
                <Choices
                  environmentId={environmentId}
                  ticket={ticket}
                  onChoose={(index) => hooks.choose?.(ticket, index)}
                />
              </div>
            ) : null}
          </RichActionsContext>
          <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-end gap-1 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg">
            {quoted ? (
              <button
                type="button"
                onClick={() => setQuoted(null)}
                aria-label="Remove quote"
                className="flex w-full items-center gap-2 rounded-md bg-accent/60 px-3 py-1.5 text-left text-xs text-muted-foreground"
              >
                <ReplyIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{quoted}</span>
                <XIcon className="ms-auto size-3.5 shrink-0" />
              </button>
            ) : null}
            <Textarea
              ref={replyField}
              rows={1}
              unstyled
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                send();
              }}
              placeholder="Reply…"
              aria-label={`Reply to ${ticket.title}`}
              className="min-w-0 flex-1 [&_textarea]:max-h-40 [&_textarea]:min-h-9 [&_textarea]:resize-none"
            />
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="More ticket actions"
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end" side="top" sideOffset={8}>
                <MenuItem onClick={props.onOpenDetails}>
                  <Maximize2Icon />
                  Open details
                </MenuItem>
                <MenuItem onClick={() => void navigator.clipboard.writeText(ticket.summary)}>
                  <CopyIcon />
                  Copy summary
                </MenuItem>
                {reply.trim() ? (
                  <MenuItem onClick={props.onGotIt}>
                    <CheckIcon />
                    Got it
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
            <Button className="shrink-0" onClick={reply.trim() ? send : props.onGotIt}>
              {reply.trim() ? <ArrowUpIcon /> : <CheckIcon />}
              {reply.trim() ? "Send" : "Got it"}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
