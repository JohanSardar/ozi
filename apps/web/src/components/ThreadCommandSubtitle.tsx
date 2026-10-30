import type { ProviderDriverKind } from "@t3tools/contracts";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { cn } from "~/lib/utils";

export type ThreadCommandSubtitleVariant = "favicon-workspace-harness" | "favicon-workspace";

const THREAD_COMMAND_SUBTITLE_VARIANT: ThreadCommandSubtitleVariant = "favicon-workspace-harness";
function CommandPaletteMetaDot() {
  return <span className="shrink-0 text-muted-foreground/50">·</span>;
}

export function ThreadCommandSubtitle(props: {
  environmentLabel?: string | null;
  workingDirectory: string | null;
  isCurrent: boolean;
  driverKind?: ProviderDriverKind | null;
  providerDisplayName?: string | null;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  variant?: ThreadCommandSubtitleVariant;
  className?: string;
}) {
  const variant = props.variant ?? THREAD_COMMAND_SUBTITLE_VARIANT;
  const showHarness =
    variant !== "favicon-workspace" && props.driverKind != null && props.providerDisplayName;

  const environmentLabel = props.environmentLabel?.trim() || null;

  if (!environmentLabel && !props.isCurrent && !showHarness) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground/70",
        props.className,
      )}
    >
      {environmentLabel ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate">{environmentLabel}</span>
        </span>
      ) : null}

      {showHarness && props.driverKind ? (
        <>
          {environmentLabel ? <CommandPaletteMetaDot /> : null}
          <ProviderInstanceIcon
            driverKind={props.driverKind}
            displayName={props.providerDisplayName ?? props.driverKind}
            acpRegistryAgentId={props.acpRegistryAgentId}
            acpRegistryIconUrl={props.acpRegistryIconUrl}
            iconClassName="size-3 shrink-0 opacity-70"
          />
        </>
      ) : null}

      {props.isCurrent ? (
        <>
          {environmentLabel || showHarness ? <CommandPaletteMetaDot /> : null}
          <span className="shrink-0">Current thread</span>
        </>
      ) : null}
    </span>
  );
}
