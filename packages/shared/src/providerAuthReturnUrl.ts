import { isLoopbackHost } from "./preview.ts";

export function providerAuthReturnUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const desktop = ["ozi:", "ozi-dev:"].includes(url.protocol) && url.host === "app";
    const web = ["http:", "https:"].includes(url.protocol) && isLoopbackHost(url.hostname);
    if (
      url.username ||
      url.password ||
      (!desktop && !web) ||
      (url.pathname !== "/settings" && !url.pathname.startsWith("/settings/"))
    )
      return undefined;
    for (const key of Array.from(url.searchParams.keys())) {
      if (!["machine", "project", "checkout", "environmentId", "instanceId"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
