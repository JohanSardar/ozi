import { isWindowsAbsolutePath } from "@t3tools/shared/path";

import { safeDecodeURIComponent } from "@t3tools/shared/markdownLinks";

export type MediaReference =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly relativePath?: string;
    }
  | { readonly kind: "url"; readonly url: string };

/** Local paths are already decoded; URL filename escapes are decoded exactly once. */
export function mediaReferenceFileName(reference: MediaReference): string | undefined {
  if (reference.kind === "file") {
    const windows = isWindowsAbsolutePath(reference.path) || reference.path.startsWith("//");
    return reference.path.split(windows ? /[\\/]/ : "/").at(-1) || undefined;
  }

  let basename: string | undefined;
  try {
    const url = reference.url;
    basename = new URL(url.startsWith("//") ? `https:${url}` : url).pathname.split("/").at(-1);
  } catch {
    return undefined;
  }
  return basename ? safeDecodeURIComponent(basename) : undefined;
}
