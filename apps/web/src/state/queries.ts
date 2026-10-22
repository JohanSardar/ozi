import type { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";

import { orchestrationEnvironment } from "./orchestration";
import { useEnvironmentQuery } from "./query";

export function useTurnItemDetail(
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
    readonly revision: string;
  } | null,
) {
  return useEnvironmentQuery(
    target === null
      ? null
      : orchestrationEnvironment.turnItem({
          environmentId: target.environmentId,
          input: { threadId: target.threadId, itemId: target.itemId, revision: target.revision },
        }),
  );
}
