import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const calendarDate = (value: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
const CalendarDate = TrimmedNonEmptyString.check(
  Schema.isPattern(
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,
  ),
  Schema.makeFilter((value) => {
    const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return (
      Number.isFinite(calendarDate(value).getTime()) &&
      Number.isFinite(day.getTime()) &&
      day.toISOString().slice(0, 10) === value.slice(0, 10)
    );
  }),
);
export const CalendarEventInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  start: CalendarDate,
  end: Schema.optional(CalendarDate),
  location: Schema.optional(TrimmedNonEmptyString),
  notes: Schema.optional(TrimmedNonEmptyString),
  source: Schema.optional(TrimmedNonEmptyString),
});
export type CalendarEventInput = typeof CalendarEventInput.Type;
export const calendarEnd = (event: CalendarEventInput) => {
  if (event.end) return calendarDate(event.end);
  const end = calendarDate(event.start);
  if (event.start.length === 10) end.setDate(end.getDate() + 1);
  else end.setTime(end.getTime() + 3_600_000);
  return end;
};
export const calendarKey = (event: CalendarEventInput) => {
  const end = calendarEnd(event);
  const allDay = event.start.length === 10 && (!event.end || event.end.length === 10);
  return JSON.stringify([
    event.title,
    allDay ? event.start : calendarDate(event.start).toISOString(),
    allDay
      ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`
      : end.toISOString(),
    event.location ?? "",
  ]);
};
export const CalendarEvent = Schema.Struct({
  ...CalendarEventInput.fields,
  id: Schema.String,
  source: TrimmedNonEmptyString,
  added: Schema.Boolean,
});
export type CalendarEvent = typeof CalendarEvent.Type;
export const CalendarListInput = Schema.Struct({ start: CalendarDate, end: CalendarDate });
export type CalendarListInput = typeof CalendarListInput.Type;
export const CalendarListResult = Schema.Struct({ events: Schema.Array(CalendarEvent) });
export type CalendarListResult = typeof CalendarListResult.Type;
export class CalendarError extends Schema.TaggedError<CalendarError>()("CalendarError", {
  message: Schema.String,
}) {}
