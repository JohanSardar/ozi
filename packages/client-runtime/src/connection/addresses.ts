import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";

export function connectionAddressKey(entry: ConnectionCatalogEntry): string | null {
  const routes = [
    { target: entry.target, profile: entry.profile },
    ...(entry.alternateRoutes ?? []),
  ].filter((route) => {
    const profile = Option.getOrNull(route.profile);
    return !(profile?._tag === "BearerConnectionProfile" && profile.learned === true);
  });
  if (routes.length === 1) return routeConnectionKey(routes[0]!.target, routes[0]!.profile);
  const keys = routes.map((route) => routeConnectionKey(route.target, route.profile));
  return keys.every((key) => key !== null) ? JSON.stringify([...keys].sort()) : null;
}

function routeConnectionKey(
  target: ConnectionCatalogEntry["target"],
  routeProfile: ConnectionCatalogEntry["profile"],
): string | null {
  const entry = { profile: routeProfile };
  const profile = Option.getOrNull(entry.profile);
  if (target._tag === "SshConnectionTarget") {
    if (profile?._tag !== "SshConnectionProfile") return null;
    const { alias, hostname, username, port } = profile.target;
    return JSON.stringify([target._tag, target.environmentId, alias, hostname, username, port]);
  }
  const baseUrls =
    target._tag === "PrimaryConnectionTarget"
      ? [target.httpBaseUrl, target.wsBaseUrl]
      : profile?._tag === "BearerConnectionProfile"
        ? [profile.httpBaseUrl, profile.wsBaseUrl]
        : null;
  if (baseUrls === null) return null;
  try {
    const urls = baseUrls.map((baseUrl) => new URL(baseUrl));
    if (
      !["http:", "https:"].includes(urls[0]!.protocol) ||
      !["ws:", "wss:"].includes(urls[1]!.protocol) ||
      urls.some((url) => url.username || url.password)
    )
      return null;
    return JSON.stringify([
      target._tag,
      target.environmentId,
      ...urls.map((url) => url.href.replace(/\/+$/, "")),
    ]);
  } catch {
    return null;
  }
}
