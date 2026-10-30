import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as ProjectService from "../project/ProjectService.ts";

export const layer = Layer.mock(ProjectService.ProjectService)({
  getById: () => Effect.succeedNone,
});
