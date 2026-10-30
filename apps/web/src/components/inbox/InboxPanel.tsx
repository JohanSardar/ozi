import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, Ticket } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { InboxIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
} from "../../state/tickets";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Age, Choices, clearedBy, TicketWindow } from "./TicketWindow";

export interface TicketHooks {
  readonly choose?: (ticket: Ticket, index: number) => void;
  readonly reply?: (ticket: Ticket, text: string) => void;
}

const GROUPS = [
  ["Decide", "questions and approvals"],
  ["Do", "only you can do these"],
  ["Review", "finished work"],
  ["Read", "nothing to do"],
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

  return environmentId && !hidden ? <Inbox environmentId={environmentId} hooks={props} /> : null;
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
            size="icon-sm"
            className="relative ms-2 hidden shrink-0 lg:inline-flex [-webkit-app-region:no-drag]"
            aria-label={`Show inbox${shortcut}`}
            onClick={toggleInbox}
          />
        }
      >
        <InboxIcon className="size-4" />
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-3xs font-semibold leading-4 text-primary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">Show inbox{shortcut}</TooltipPopup>
    </Tooltip>
  );
}

function Inbox(props: { environmentId: EnvironmentId; hooks: TicketHooks }) {
  const { environmentId } = props;
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
  const [details, setDetails] = useState<Ticket | null>(null);
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
            input: query ? { status: "archived", search: query } : { status: "archived" },
          })
        : null,
    ).data?.tickets ?? [];
  const ordered = orderTickets(open);
  const current =
    selected.index < 0
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
      if (tab !== "inbox" || details || !current || !hooks.choose) return;
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableFocused(event.target)) return;
      const index = Number(event.key) - 1;
      if (!(index >= 0 && index < current.choices.length)) return;
      event.preventDefault();
      hooks.choose(current, index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, details, current, hooks]);

  return (
    <aside
      aria-label="Inbox"
      className="hidden w-(--inbox-width) shrink-0 flex-col border-l border-border bg-sidebar text-sidebar-foreground lg:flex"
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
            {GROUPS.map(([group, hint]) => {
              const tickets = ordered.filter((ticket) => ticket.group === group);
              return tickets.length === 0 ? null : (
                <section key={group} aria-label={group} className="mt-3.5 first:mt-3">
                  <h2 className="flex items-baseline gap-2 px-1 pb-2 text-sm font-semibold">
                    {group}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {tickets.length}
                    </span>
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {hint}
                    </span>
                  </h2>
                  {tickets.map((ticket) => (
                    <TicketRow
                      key={ticket.id}
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
                  className="flex w-full items-baseline gap-2 px-1 pb-2 text-left text-sm font-semibold"
                >
                  Working
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
        ) : (
          <>
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search archive"
              aria-label="Search archive"
              className="mt-3 mb-2.5"
            />
            {archived.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setDetails(ticket)}
                className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-card"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ticket.title}</span>
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
        )}
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

function TicketRow(props: {
  ticket: Ticket;
  chat: string;
  open: boolean;
  reveal: boolean;
  hooks: TicketHooks;
  onToggle: () => void;
  onGotIt: () => void;
  onOpenDetails: () => void;
}) {
  const { ticket, hooks } = props;
  const [reply, setReply] = useState("");
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
      className="mb-1.5 overflow-hidden rounded-lg border border-border bg-card transition-colors focus-within:border-ring/40 hover:border-ring/40"
    >
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="block w-full px-3.5 py-2.5 text-left"
      >
        <span className="block truncate text-sm font-medium leading-snug">{ticket.title}</span>
        <span className="mt-px block truncate text-xs text-muted-foreground">
          {props.chat} · <Age iso={ticket.createdAt} />
        </span>
      </button>
      {props.open ? (
        <div className="px-3.5 pb-3.5">
          <p className="mb-1.5 text-sm font-semibold leading-snug">{ticket.need}</p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {ticket.summary}
          </p>
          {ticket.choices.length > 0 ? (
            <div className="mt-3">
              <Choices ticket={ticket} onChoose={(index) => hooks.choose?.(ticket, index)} />
            </div>
          ) : null}
          <div className="mt-2.5 flex items-center gap-2">
            <Input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || !reply.trim() || !hooks.reply)
                  return;
                event.preventDefault();
                hooks.reply(ticket, reply.trim());
                setReply("");
              }}
              placeholder="Reply…"
              aria-label={`Reply to ${ticket.title}`}
              className="flex-1"
            />
            <Button variant="outline" onClick={props.onGotIt}>
              Got it
            </Button>
          </div>
          <Button
            variant="ghost-muted"
            size="xs"
            className="mt-2 -ml-2"
            onClick={props.onOpenDetails}
          >
            Open details
          </Button>
        </div>
      ) : null}
    </article>
  );
}
