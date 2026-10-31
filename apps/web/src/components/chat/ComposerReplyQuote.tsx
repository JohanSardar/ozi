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
  const mediaLabel = /^!\[([^\]]*)\]\([\s\S]*\)$/.exec(citation.text)?.[1];
  const quoteText = mediaLabel ? `Attachment: ${mediaLabel}` : citation.text;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border-primary border-l-2 bg-accent px-3 py-2.5 text-muted-foreground text-xs">
      <CornerUpLeftIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <p className="line-clamp-2 min-w-0 flex-1">Replying to “{quoteText}”</p>
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
