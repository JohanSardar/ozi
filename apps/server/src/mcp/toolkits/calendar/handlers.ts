import * as Effect from "effect/Effect";
import * as Calendar from "../../../calendar/Calendar.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { CalendarToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(CalendarToolkit, {
  calendar_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      return yield* (yield* Calendar.Calendar).list(input);
    }),
  ),
  calendar_add: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      return yield* (yield* Calendar.Calendar).add(input);
    }),
  ),
});
