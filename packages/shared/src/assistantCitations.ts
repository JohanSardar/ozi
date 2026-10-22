import {
  ASSISTANT_CITATION_MAX_COMMENT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  AssistantCitation,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CITATION_PROTOCOL = "t3-citation:";
const CITATION_HREF_PREFIX = `${CITATION_PROTOCOL}//v1/`;
// Percent encoding needs up to nine characters per UTF-16 code unit; 16k covers selectors.
const MAX_CITATION_HREF_LENGTH =
  9 * (ASSISTANT_CITATION_MAX_TEXT_LENGTH + ASSISTANT_CITATION_MAX_COMMENT_LENGTH) + 16_000;
const CITATION_LINK = new RegExp(
  String.raw`\[Assistant quote\]\((${CITATION_HREF_PREFIX}[^\s)]{1,${MAX_CITATION_HREF_LENGTH - CITATION_HREF_PREFIX.length}})\)`,
  "g",
);
const decodeCitation = Schema.decodeUnknownOption(AssistantCitation);

export function parseAssistantCitationHref(href: string): AssistantCitation | null {
  if (!href.startsWith(CITATION_HREF_PREFIX) || href.length > MAX_CITATION_HREF_LENGTH) {
    return null;
  }
  try {
    const url = new URL(href);
    const parts = url.pathname.slice(1).split("/");
    if (
      url.protocol !== CITATION_PROTOCOL ||
      url.hostname !== "v1" ||
      parts.length !== 3 ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) {
      return null;
    }
    const requiredKeys = ["text", "start", "end", "prefix", "suffix"];
    const comment = url.searchParams.get("comment");
    if (
      url.searchParams.size !== requiredKeys.length + (comment === null ? 0 : 1) ||
      requiredKeys.some((key) => url.searchParams.getAll(key).length !== 1)
    ) {
      return null;
    }
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    if (!/^\d{1,16}$/.test(start) || !/^\d{1,16}$/.test(end)) return null;
    return Option.getOrNull(
      decodeCitation({
        version: 1,
        environmentId: decodeURIComponent(parts[0]!),
        threadId: decodeURIComponent(parts[1]!),
        messageId: decodeURIComponent(parts[2]!),
        text: url.searchParams.get("text"),
        start: Number(start),
        end: Number(end),
        prefix: url.searchParams.get("prefix"),
        suffix: url.searchParams.get("suffix"),
        ...(comment === null ? {} : { comment }),
      }),
    );
  } catch {
    return null;
  }
}

export function assistantCitationLabel(citation: AssistantCitation): string {
  const preview = (citation.comment?.trim() || citation.text).replace(/\s+/g, " ");
  return preview.length > 64 ? `${preview.slice(0, 64)}…` : preview;
}

export function assistantCitationsToPlainText(prompt: string): string {
  return prompt.replace(CITATION_LINK, (source: string, href: string) => {
    const citation = parseAssistantCitationHref(href);
    if (!citation) return source;
    return citation.comment === undefined
      ? citation.text
      : `${citation.text}\nComment: ${citation.comment}`;
  });
}
