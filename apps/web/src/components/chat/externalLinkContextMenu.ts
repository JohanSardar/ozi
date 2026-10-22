export type ExternalLinkContextMenuAction =
  | "open-in-preview"
  | "open-external"
  | "copy-link"
  | "link-to-thread"
  | "unlink-from-thread";

export type ExternalLinkContextMenuFailureOperation =
  | "show-link-context-menu"
  | "open-link-in-preview"
  | "open-link-external"
  | "copy-link"
  | "link-pull-request-to-thread"
  | "unlink-pull-request-from-thread";

function resolveExternalWebLink(href: string | null | undefined): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveExternalWebLinkHost(href: string | undefined): string | null {
  return resolveExternalWebLink(href)?.hostname || null;
}
