import {
  calendarDate,
  calendarEnd,
  calendarKey,
  type CalendarEvent,
  type CalendarEventInput,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import "./calendar.css";
import { calendarAdd, calendarList } from "./state";

const subscribeClock = (refresh: () => void) => {
  const timer = window.setInterval(refresh, 60_000);
  return () => window.clearInterval(timer);
};
const clockSnapshot = () => Math.floor(Date.now() / 60_000);
const DAY = 60 * 24;
const localDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const shift = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const weekOf = (date: Date) => shift(localDay(date), -((date.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const clock = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const minute = (date: Date) => date.getHours() * 60 + date.getMinutes();
const hiddenScroll = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function googleUrl(event: CalendarEventInput) {
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const allDay = event.start.length === 10;
  const end = calendarEnd(event);
  const localStamp = (date: Date) =>
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const dates = allDay
    ? `${event.start.replaceAll("-", "")}/${localStamp(end)}`
    : `${stamp(calendarDate(event.start))}/${stamp(end)}`;
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: event.title, dates, location: event.location ?? "", details: event.notes ?? "" })}`;
}

function MonthSwitch({ week, select }: { week: Date; select: (date: Date) => void }) {
  const [month, setMonth] = useState(new Date(week.getFullYear(), week.getMonth(), 1));
  const first = weekOf(month);
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" />}
        onClick={() => setMonth(new Date(week.getFullYear(), week.getMonth(), 1))}
      >
        {week.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        <ChevronDownIcon className="size-4" />
      </MenuTrigger>
      <MenuPopup width="content" align="start">
        <div className="w-64 p-3">
          <div className="mb-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <span className="text-sm font-medium">
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <span key={day} className="pb-2 text-muted-foreground">
                {day.slice(0, 1)}
              </span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const date = shift(first, i);
              const active = date >= week && date < shift(week, 7);
              return (
                <MenuItem
                  key={date.toISOString()}
                  onClick={() => select(weekOf(date))}
                  className="justify-center"
                  data-calendar-month-active={active || undefined}
                  data-calendar-month-muted={date.getMonth() !== month.getMonth() || undefined}
                >
                  {date.getDate()}
                </MenuItem>
              );
            })}
          </div>
        </div>
      </MenuPopup>
    </Menu>
  );
}

function dayLayout(events: readonly CalendarEvent[], day: Date) {
  const next = shift(day, 1);
  const blocks = events
    .filter(
      (event) =>
        event.start.length !== 10 && calendarDate(event.start) < next && calendarEnd(event) > day,
    )
    .map((event) => ({
      event,
      start: calendarDate(event.start) < day ? 0 : minute(calendarDate(event.start)),
      end: calendarEnd(event) >= next ? DAY : minute(calendarEnd(event)),
      lane: 0,
      lanes: 1,
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof blocks = [];
  let boundary = -1;
  const finish = () => {
    const lanes = Math.max(1, ...group.map((block) => block.lane + 1));
    for (const block of group) block.lanes = lanes;
  };
  for (const block of blocks) {
    if (block.start >= boundary) {
      finish();
      group = [];
      boundary = -1;
    }
    const used = new Set(
      group.filter((other) => other.end > block.start).map((other) => other.lane),
    );
    while (used.has(block.lane)) block.lane++;
    group.push(block);
    boundary = Math.max(boundary, block.end);
  }
  finish();
  return blocks;
}

export function CalendarWindow({
  event,
  environmentId,
  download,
  close,
}: {
  event: CalendarEventInput;
  environmentId: EnvironmentId | null;
  download: () => void;
  close: () => void;
}) {
  const [week, setWeek] = useState(() => weekOf(calendarDate(event.start)));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const now = new Date(useSyncExternalStore(subscribeClock, clockSnapshot) * 60_000);
  const query = useEnvironmentQuery(
    environmentId
      ? calendarList({
          environmentId,
          input: { start: week.toISOString(), end: shift(week, 7).toISOString() },
        })
      : null,
  );
  const eventWeek = weekOf(calendarDate(event.start));
  const eventQuery = useEnvironmentQuery(
    environmentId
      ? calendarList({
          environmentId,
          input: { start: eventWeek.toISOString(), end: shift(eventWeek, 7).toISOString() },
        })
      : null,
  );
  const add = useAtomCommand(calendarAdd, { reportFailure: false });
  const selectedKey = calendarKey(event);
  const isAdded =
    saved ||
    !!eventQuery.data?.events.some((item) => item.added && calendarKey(item) === selectedKey);
  const selected: CalendarEvent = { ...event, id: selectedKey, source: "ozi", added: isAdded };
  const events = [
    ...(query.data?.events.filter((item) => calendarKey(item) !== selectedKey) ?? []),
    selected,
  ];
  const days = Array.from({ length: 7 }, (_, i) => shift(week, i));
  const hasAllDay = events.some(
    (item) =>
      item.start.length === 10 &&
      calendarDate(item.start) < shift(week, 7) &&
      calendarEnd(item) > week,
  );
  const scroll = (node: HTMLDivElement | null) => {
    if (node)
      node.scrollTop =
        Math.max(0, Math.min(9, (calendarDate(event.start).getHours() || 9) - 1)) * 60;
  };
  const submit = async () => {
    if (!environmentId || saving || isAdded) return;
    setSaving(true);
    setFailure(null);
    const result = await add({ environmentId, input: event });
    setSaving(false);
    if (result._tag === "Success") {
      setSaved(true);
      query.refresh();
      if (week.getTime() !== eventWeek.getTime()) eventQuery.refresh();
    } else setFailure("Could not add this event. Try again.");
  };
  const blockStyle = (item: CalendarEvent) =>
    calendarKey(item) === selectedKey && !isAdded ? "proposed" : "event";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup
        bottomStickOnMobile={false}
        data-calendar-window
        className="h-[88vh] max-w-[min(71rem,92vw)] overflow-hidden"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-4 pr-12">
          <CalendarDaysIcon className="mr-1 size-5" data-calendar-blue />
          <DialogTitle className="sr-only">Calendar</DialogTitle>
          <DialogDescription className="sr-only">
            Week view. Review the proposed event, then add it to your Ozi calendar.
          </DialogDescription>
          <MonthSwitch week={week} select={setWeek} />
          <Button variant="outline" className="ml-2" onClick={() => setWeek(weekOf(new Date()))}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous week"
            onClick={() => setWeek(shift(week, -7))}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next week"
            onClick={() => setWeek(shift(week, 7))}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {shortDate(week)} – {shortDate(shift(week, 6))}
          </span>
          <span className="ml-3 text-sm">Week</span>
        </header>
        <div className="grid shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border bg-background/50">
          <span className="self-end px-2 pb-3 text-3xs text-muted-foreground">
            {
              new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
                .formatToParts(now)
                .find((part) => part.type === "timeZoneName")?.value
            }
          </span>
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="border-l border-border/60 px-2 py-3 text-center"
            >
              <div
                className="text-xs text-muted-foreground"
                data-calendar-blue={sameDay(day, now) || undefined}
              >
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div
                data-calendar-toolbar
                data-calendar-today={sameDay(day, now) || undefined}
                className="mx-auto mt-1 flex size-9 items-center justify-center text-xl"
              >
                {day.getDate()}
              </div>
            </div>
          ))}
          {hasAllDay && (
            <>
              <span className="px-2 py-2 text-3xs text-muted-foreground">All day</span>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className="space-y-1 border-l border-border/60 px-1 pb-2"
                >
                  {events
                    .filter(
                      (item) =>
                        item.start.length === 10 &&
                        calendarDate(item.start) < shift(day, 1) &&
                        calendarEnd(item) > day,
                    )
                    .map((item) => (
                      <Tooltip key={item.id}>
                        <TooltipTrigger
                          render={
                            <div
                              data-calendar-block={blockStyle(item)}
                              className="rounded-md px-2 py-1 text-xs"
                            />
                          }
                        >
                          {item.title}
                        </TooltipTrigger>
                        <TooltipPopup>{item.title}</TooltipPopup>
                      </Tooltip>
                    ))}
                </div>
              ))}
            </>
          )}
        </div>
        <div
          key={week.toISOString()}
          ref={scroll}
          className={`min-h-0 flex-1 overflow-auto ${hiddenScroll}`}
          aria-label="Week hour grid"
        >
          <div className="relative grid min-h-[1440px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <div className="relative">
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  key={hour}
                  style={{ top: hour * 60 }}
                  className="absolute right-2 -translate-y-1/2 text-3xs text-muted-foreground"
                >
                  {hour ? clock(new Date(2026, 0, 1, hour)).replace(":00", "") : ""}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className="relative border-l border-border/60"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
                  backgroundSize: "100% 60px",
                }}
              >
                {dayLayout(events, day).map(({ event: item, start, end, lane, lanes }) => (
                  <Tooltip key={item.id}>
                    <TooltipTrigger
                      render={
                        <div
                          style={{
                            top: start,
                            height: Math.max(24, end - start - 2),
                            left: `calc(${(lane / lanes) * 100}% + 3px)`,
                            width: `calc(${100 / lanes}% - 6px)`,
                          }}
                          data-calendar-block={blockStyle(item)}
                          className="absolute overflow-hidden rounded-md px-2 py-1 text-xs"
                        />
                      }
                    >
                      <p className="font-medium leading-tight">{item.title}</p>
                      {end - start > 35 && (
                        <p className="mt-1 text-3xs opacity-80">
                          {clock(calendarDate(item.start))}–{clock(calendarEnd(item))}
                        </p>
                      )}
                      {end - start > 65 && item.location && (
                        <p className="mt-1 text-3xs opacity-80">{item.location}</p>
                      )}
                    </TooltipTrigger>
                    <TooltipPopup>
                      <p>{item.title}</p>
                      <p>
                        {clock(calendarDate(item.start))}–{clock(calendarEnd(item))}
                      </p>
                      {item.location && <p>{item.location}</p>}
                    </TooltipPopup>
                  </Tooltip>
                ))}
                {sameDay(day, now) && (
                  <div
                    style={{ top: minute(now) }}
                    data-calendar-now
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2"
                  >
                    <span className="absolute -left-1 -top-1 size-1.5 rounded-sm" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <footer className="shrink-0 border-t border-border bg-background/70 p-4">
          <div
            data-calendar-toolbar
            className="mx-auto flex max-w-3xl items-center gap-4 border border-border bg-popover p-3 shadow-lg"
          >
            <div className="min-w-0 flex-1 pl-1">
              <p className="text-sm font-medium">{event.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shortDate(calendarDate(event.start))} ·{" "}
                {event.start.length === 10 ? "All day" : clock(calendarDate(event.start))}
                {event.location ? ` · ${event.location}` : ""}
              </p>
              {(failure || query.error || !environmentId) && (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {failure ?? query.error ?? "Connect to an environment to save this event."}
                </p>
              )}
            </div>
            <Menu>
              <MenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Event options" />}
              >
                <MoreHorizontalIcon className="size-5" />
              </MenuTrigger>
              <MenuPopup align="end" side="top">
                <MenuItem onClick={download}>
                  <DownloadIcon className="size-4" />
                  Download .ics
                </MenuItem>
                <MenuItem
                  onClick={() => window.open(googleUrl(event), "_blank", "noopener,noreferrer")}
                >
                  <ExternalLinkIcon className="size-4" />
                  Open in Google Calendar
                </MenuItem>
              </MenuPopup>
            </Menu>
            <Button
              data-calendar-primary
              className="shrink-0"
              disabled={isAdded || saving || !environmentId || query.isPending}
              onClick={() => void submit()}
            >
              {isAdded ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
              {isAdded ? "Added to calendar" : saving ? "Adding…" : "Add to calendar"}
            </Button>
          </div>
        </footer>
      </DialogPopup>
    </Dialog>
  );
}
