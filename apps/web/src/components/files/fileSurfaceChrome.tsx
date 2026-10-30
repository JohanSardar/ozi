import type { ReactNode } from "react";

import { Spinner } from "~/components/ui/spinner";
import { Button } from "~/components/ui/button";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
const CODE_SURFACE_THEME_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: var(--code-background) !important;
  --diffs-light-bg: var(--code-background) !important;
  --diffs-dark-bg: var(--code-background) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  /* Gutter, context, and row tints all derive from the code surface the diff
     body sits on. Mixing from the canvas leaves the gutter looking unthemed
     when a palette separates the two. */
  --diffs-bg-context-override: color-mix(in srgb, var(--code-background) 97%, var(--code-foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--code-background) 94%, var(--code-foreground));
  --diffs-bg-separator-override: color-mix(
    in srgb,
    var(--code-background) 95%,
    var(--code-foreground)
  );
  --diffs-bg-buffer-override: color-mix(in srgb, var(--code-background) 90%, var(--code-foreground));

  --diffs-bg-addition-override: light-dark(
    color-mix(in srgb, var(--code-background) 50%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 70%, var(--diff-addition))
  );
  --diffs-bg-addition-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 35%, var(--diff-addition)),
    color-mix(in srgb, var(--code-background) 60%, var(--diff-addition))
  );
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--code-background) 85%, var(--diff-addition));
  --diffs-bg-addition-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 80%,
    var(--diff-addition)
  );

  --diffs-bg-deletion-override: light-dark(
    color-mix(in srgb, var(--code-background) 50%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 70%, var(--diff-deletion))
  );
  --diffs-bg-deletion-number-override: light-dark(
    color-mix(in srgb, var(--code-background) 35%, var(--diff-deletion)),
    color-mix(in srgb, var(--code-background) 60%, var(--diff-deletion))
  );
  --diffs-bg-deletion-hover-override: color-mix(
    in srgb,
    var(--code-background) 85%,
    var(--diff-deletion)
  );
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--code-background) 80%,
    var(--diff-deletion)
  );

  background-color: var(--diffs-bg) !important;
  color: var(--code-foreground) !important;
}

/* The library's change-icon colors are tuned for dark canvases; light mode takes the app's darker tokens. */
[data-change-icon="new"] {
  color: var(
    --diff-added-icon,
    light-dark(var(--diff-addition-foreground), var(--diffs-addition-base))
  ) !important;
}
[data-change-icon="deleted"] {
  color: light-dark(var(--diff-deletion-foreground), var(--diffs-deletion-base)) !important;
}
/* The page sets --diff-modified-icon to a muted T3 blue, so the common case stays quiet. */
[data-change-icon="change"],
[data-change-icon="rename-pure"],
[data-change-icon="rename-changed"] {
  color: var(
    --diff-modified-icon,
    light-dark(var(--info-foreground), var(--diffs-modified-base))
  ) !important;
}
`;
import { cn } from "~/lib/utils";

export const FILE_SURFACE_SUBHEADER_CLASS =
  "flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 in-data-[preview-panel-mode=inline]:mb-3 in-data-[preview-panel-mode=inline]:h-7 in-data-[preview-panel-mode=inline]:min-h-7 in-data-[preview-panel-mode=inline]:border-b-transparent";

export const FILE_LINK_REVEAL_ATTRIBUTE = "data-file-link-reveal";

export const FILE_LINK_REVEAL_UNSAFE_CSS = `
  ${CODE_SURFACE_THEME_UNSAFE_CSS}

  diffs-container {
    --diffs-bg: var(--code-background, var(--background)) !important;
    --diffs-light-bg: var(--code-background, var(--background)) !important;
    --diffs-dark-bg: var(--code-background, var(--background)) !important;
    background-color: var(--code-background, var(--background)) !important;
    color: var(--code-foreground, var(--foreground)) !important;
  }

  /* Tint through --diffs-line-bg, not background-color. The editor paints row
     tints on a layer below its text selection; a background on the row itself
     covers the selection and makes selected text on this line invisible. */
  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-line] {
    --diffs-line-bg: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 82%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-override, var(--diffs-selection-base))
      )
    ) !important;
  }

  [${FILE_LINK_REVEAL_ATTRIBUTE}][data-column-number] {
    background-color: light-dark(
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 75%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      ),
      color-mix(
        in lab,
        var(--diffs-computed-diff-line-bg) 60%,
        var(--diffs-bg-selection-number-override, var(--diffs-selection-base))
      )
    ) !important;
    color: var(--diffs-selection-number-fg) !important;
  }
`;

export function FileSurfaceAction(props: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  const pressed = props.pressed;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          pressed === undefined ? (
            <Button
              type="button"
              className="shrink-0"
              disabled={props.disabled ?? false}
              onClick={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="icon-sm"
            >
              {props.children}
            </Button>
          ) : (
            <Toggle
              className="shrink-0"
              pressed={pressed}
              disabled={props.disabled ?? false}
              onPressedChange={props.onPress}
              aria-label={props.label}
              variant="ghost"
              size="sm"
            >
              {props.children}
            </Toggle>
          )
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function FileSurfaceNotice(props: { readonly children: ReactNode }) {
  return (
    <div
      role="status"
      className="shrink-0 border-b border-warning/20 bg-warning-surface px-3 py-1.5 text-2xs text-warning-foreground"
    >
      {props.children}
    </div>
  );
}

export function FileSurfaceLoading(props: { readonly className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading file"
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center text-muted-foreground",
        props.className,
      )}
    >
      <Spinner size="lg" />
    </div>
  );
}

export function FileSurfaceFailure(props: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs leading-relaxed"
    >
      <p className="text-destructive">{props.message}</p>
      {props.onRetry ? (
        <button
          type="button"
          onClick={props.onRetry}
          className="rounded-md border border-input px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
