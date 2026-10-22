import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;
