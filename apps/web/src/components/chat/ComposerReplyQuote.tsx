import type { AssistantCitation } from "@t3tools/contracts";
import { CornerUpLeftIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";

export function ComposerReplyQuote({
  citation,
  onRemove,
}: {
  citation: AssistantCitation;
  onRemove: () => void;
}) {
  return (
    <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-md border-primary border-l-2 bg-accent px-2.5 py-2 text-muted-foreground text-xs">
      <CornerUpLeftIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <p className="line-clamp-2 min-w-0 flex-1">Replying to “{citation.text}”</p>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Remove reply"
        className="-my-1"
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}
