import { cn } from "../../lib/utils";
import type { ThemeCardPreviewColors } from "./ThemePreviewCircles";

export function ThemeWireframe({
  className,
  panes,
}: {
  className?: string;
  panes: ReadonlyArray<{ colors: ThemeCardPreviewColors; clip?: "left" | "right" }>;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex w-full overflow-hidden rounded-lg border border-border/60",
        className,
      )}
    >
      {panes.map(({ colors, clip }) => (
        <span
          className="flex min-w-0 flex-1 items-end gap-1 p-3"
          key={clip ?? "pane"}
          style={{ backgroundColor: colors.canvas }}
        >
          {(["sidebar", "surface", "messageSurface", "accent"] as const).map(
            (role) => (
              <span
                className="h-8 min-w-0 flex-1 rounded-md border border-black/10"
                key={role}
                style={{ backgroundColor: colors[role] }}
              />
            ),
          )}
        </span>
      ))}
    </span>
  );
}
