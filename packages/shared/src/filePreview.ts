import { videoMimeType } from "./video.ts";

export type FilePreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html"
  | "markdown"
  | "text"
  | "unsupported";

export const WORKSPACE_BROWSER_PREVIEW_EXTENSIONS = [".htm", ".html", ".pdf"] as const;

export const WORKSPACE_IMAGE_PREVIEW_EXTENSIONS = [
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
] as const;

const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const BROWSER_MIME_TYPE_BY_EXTENSION = new Map([
  [".htm", "text/html"],
  [".html", "text/html"],
  [".pdf", "application/pdf"],
]);

const AUDIO_MIME_TYPE_BY_EXTENSION = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
  [".m4a", "audio/mp4"],
  [".opus", "audio/ogg"],
  [".aiff", "audio/aiff"],
]);

export function audioMimeTypeFromExtension(extension: string): string | null {
  if (!/^\.[a-z0-9]+$/i.test(extension)) return null;
  return AUDIO_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

/** Classifies a literal filesystem extension, without URL decoding or suffix removal. */
export function mediaMimeTypeFromExtension(extension: string): string | null {
  if (!/^\.[a-z0-9]+$/i.test(extension)) return null;
  return (
    IMAGE_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ??
    videoMimeType({ name: `media${extension}`, mimeType: "" })
  );
}

export function hostPreviewMimeTypeFromExtension(extension: string): string | null {
  if (!/^\.[a-z0-9]+$/i.test(extension)) return null;
  return (
    mediaMimeTypeFromExtension(extension) ??
    audioMimeTypeFromExtension(extension) ??
    BROWSER_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ??
    null
  );
}

function hasPreviewExtension(path: string, extensions: ReadonlyArray<string>): boolean {
  const literalPath = path.toLowerCase();
  return extensions.some((extension) => literalPath.endsWith(extension));
}

function isWorkspaceBrowserPreviewPath(path: string): boolean {
  return hasPreviewExtension(path, WORKSPACE_BROWSER_PREVIEW_EXTENSIONS);
}

export function isWorkspaceImagePreviewPath(path: string): boolean {
  return hasPreviewExtension(path, WORKSPACE_IMAGE_PREVIEW_EXTENSIONS);
}

export function isWorkspacePreviewEntryPath(path: string): boolean {
  return isWorkspaceBrowserPreviewPath(path) || isWorkspaceImagePreviewPath(path);
}
