import { resolveFileReadAccess } from "@t3tools/client-runtime/state/file-access";
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentPresentation } from "./presentation";
import { useEnvironmentQuery } from "./query";
import { environmentSession } from "./session";

export function useFileReadAccess(environmentId: EnvironmentId | null) {
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const environment = useEnvironmentPresentation(environmentId);
  return resolveFileReadAccess({
    isCatalogReady: environment.isReady,
    connection: environment.presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
}
