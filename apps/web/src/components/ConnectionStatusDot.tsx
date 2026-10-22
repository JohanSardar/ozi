import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export function connectionPhaseDotClassName(phase: EnvironmentConnectionPhase): string {
  switch (phase) {
    case "connected":
      return "bg-success";
    case "connecting":
    case "reconnecting":
      return "bg-warning";
    case "error":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

type ConnectionStatusDotProps = {
  tooltipText?: string | null;
  dotClassName: string;
};

export function ConnectionStatusDot({ tooltipText, dotClassName }: ConnectionStatusDotProps) {
  const dotContent = (
    <span className={cn("relative inline-flex size-2 rounded-full", dotClassName)} />
  );

  if (!tooltipText) {
    return (
      <span className="relative flex size-3 shrink-0 items-center justify-center">
        {dotContent}
      </span>
    );
  }

  const dot = (
    <button
      type="button"
      aria-label={tooltipText}
      className="relative flex size-3 shrink-0 cursor-help items-center justify-center rounded-full outline-hidden"
    >
      {dotContent}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={dot} />
      <TooltipPopup side="top" className="whitespace-pre-wrap">
        {tooltipText}
      </TooltipPopup>
    </Tooltip>
  );
}
