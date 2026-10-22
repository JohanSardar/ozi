import type { ServerConfig } from "@t3tools/contracts";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

import { APP_VERSION } from "./branding";

export interface VersionMismatch {
  readonly clientVersion: string;
  readonly serverVersion: string;
  readonly hint: string;
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function versionCore(version: string): string {
  return version.replace(/[-+].*$/, "");
}

function resolveVersionMismatch(
  serverVersion: string | null | undefined,
  clientVersion: string = APP_VERSION,
): VersionMismatch | null {
  const normalizedClientVersion = normalizeVersion(clientVersion);
  const normalizedServerVersion = normalizeVersion(serverVersion);
  if (!normalizedClientVersion || !normalizedServerVersion) {
    return null;
  }

  const clientCore = versionCore(normalizedClientVersion);
  const serverCore = versionCore(normalizedServerVersion);
  const compareNightlyBuilds =
    parseSemver(normalizedClientVersion)?.prerelease[0] === "nightly" &&
    parseSemver(normalizedServerVersion)?.prerelease[0] === "nightly";
  const serverIsBehind =
    parseSemver(clientCore) && parseSemver(serverCore)
      ? compareSemverVersions(
          compareNightlyBuilds ? normalizedServerVersion : serverCore,
          compareNightlyBuilds ? normalizedClientVersion : clientCore,
        ) < 0
      : normalizedServerVersion !== normalizedClientVersion;
  if (!serverIsBehind) {
    return null;
  }

  return {
    clientVersion: normalizedClientVersion,
    serverVersion: normalizedServerVersion,
    hint: "Version mismatch. Try syncing the client and server to the same Ozi version.",
  };
}

export function resolveServerConfigVersionMismatch(
  serverConfig: Pick<ServerConfig, "environment"> | null | undefined,
): VersionMismatch | null {
  return resolveVersionMismatch(serverConfig?.environment.serverVersion);
}
