import {
  AuthFilesystemReadScope,
  sessionGrantsScope,
  type SessionGrantInput,
} from "@t3tools/contracts";
import type { EnvironmentConnectionPresentation } from "../connection/presentation.ts";

export function resolveFileReadAccess(input: {
  readonly isCatalogReady: boolean;
  readonly connection: Pick<EnvironmentConnectionPresentation, "phase" | "error"> | null;
  readonly session: SessionGrantInput | null;
  readonly sessionError: string | null;
}) {
  if (input.sessionError !== null) {
    return { canReadFiles: false, isPending: false, error: input.sessionError };
  }
  if (input.session === null) {
    const isPending =
      !input.isCatalogReady ||
      input.connection?.phase === "connected" ||
      input.connection?.phase === "connecting" ||
      input.connection?.phase === "reconnecting";
    return {
      canReadFiles: false,
      isPending,
      error: isPending ? null : (input.connection?.error ?? "This environment is not connected."),
    };
  }
  return {
    canReadFiles: sessionGrantsScope(input.session, AuthFilesystemReadScope),
    isPending: false,
    error: null,
  };
}
