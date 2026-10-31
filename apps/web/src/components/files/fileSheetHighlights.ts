import type { AttachmentVersionNote } from "@t3tools/contracts";

export function observeFileHighlights(container: HTMLElement, notes: readonly AttachmentVersionNote[]) {
  if (!("highlights" in CSS) || typeof Highlight === "undefined") return;
  const update = () => {
    const highlight = new Highlight();
    const layers = [...container.querySelectorAll<HTMLElement>("[data-pdf-text-layer]")];
    for (const layer of layers) {
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let next = walker.nextNode();
      while (next) { nodes.push(next as Text); next = walker.nextNode(); }
      const text = nodes.map((node) => node.data).join("");
      for (const note of notes) {
        const start = text.indexOf(note.quote);
        if (start < 0 || !note.quote) continue;
        const end = start + note.quote.length;
        let offset = 0;
        const range = document.createRange();
        for (const node of nodes) {
          if (offset <= start && offset + node.length > start) range.setStart(node, start - offset);
          if (offset < end && offset + node.length >= end) { range.setEnd(node, end - offset); break; }
          offset += node.length;
        }
        highlight.add(range);
      }
    }
    CSS.highlights.set("ozi-file-notes", highlight);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(container, { childList: true, subtree: true });
  return () => { observer.disconnect(); CSS.highlights.delete("ozi-file-notes"); };
}
