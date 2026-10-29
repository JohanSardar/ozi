import { cn } from "~/lib/utils";

export function BrowserMockup({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex flex-col gap-0.5 overflow-hidden rounded-sm border border-border/60 bg-card p-1 shadow-xs/5",
        className,
      )}
    >
      <div className="flex gap-0.5">
        <span className="size-[3px] rounded-full bg-muted-foreground/40" />
        <span className="size-[3px] rounded-full bg-muted-foreground/40" />
        <span className="size-[3px] rounded-full bg-muted-foreground/40" />
      </div>
      <div className="mt-[1px] flex flex-1 flex-col gap-0.5">
        <span className="h-[2px] w-full rounded-full bg-muted-foreground/30" />
        <span className="h-[2px] w-3/5 rounded-full bg-muted-foreground/20" />
      </div>
    </div>
  );
}
