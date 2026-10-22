import { COMPOSER_CONTEXT_CLIPBOARD_MIME } from "@t3tools/contracts";

export { COMPOSER_CONTEXT_CLIPBOARD_MIME };

export function encodeComposerContextClipboardHtml(
  text: string,
  fragment: string,
  html?: string,
): string {
  if (html !== undefined)
    return `<div data-t3-context-fragment="${encodeURIComponent(fragment)}">${html}</div>`;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre data-t3-context-fragment="${encodeURIComponent(fragment)}">${escaped}</pre>`;
}
