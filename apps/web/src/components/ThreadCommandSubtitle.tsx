import type { ProviderDriverKind } from "@t3tools/contracts";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { cn } from "~/lib/utils";

export type ThreadCommandSubtitleVariant = "favicon-workspace-harness" | "favicon-workspace";

const THREAD_COMMAND_SUBTITLE_VARIANT: ThreadCommandSubtitleVariant = "favicon-workspace-harness";

export const COMMAND_PALETTE_META_ICON_CLASS = "size-3 shrink-0 text-muted-foreground/70";

export function CommandPaletteMetaDot() {
  return <span className="shrink-0 text-muted-foreground/50">·</span>;
}

export function ThreadCommandSubtitle(props: {
  project: ProjectFaviconProject | null;
  projectTitle: string | null;
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

  const projectLabel = props.projectTitle?.trim() || null;

  if (!projectLabel && !props.isCurrent && !showHarness) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-muted-foreground/70",
        props.className,
      )}
    >
      {projectLabel ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          {props.project ? (
            <ProjectFavicon project={props.project} className="size-3 shrink-0" />
          ) : null}
          <span className="min-w-0 truncate">{projectLabel}</span>
          {props.environmentLabel ? (
            <>
              <CommandPaletteMetaDot />
              <span className="shrink-0">{props.environmentLabel}</span>
            </>
          ) : null}
        </span>
      ) : null}

      {showHarness && props.driverKind ? (
        <>
          {projectLabel ? <CommandPaletteMetaDot /> : null}
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
          {projectLabel || showHarness ? <CommandPaletteMetaDot /> : null}
          <span className="shrink-0">Current thread</span>
        </>
      ) : null}
    </span>
  );
}
