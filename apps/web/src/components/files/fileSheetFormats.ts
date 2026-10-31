import JSZip from "jszip";

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const elements = (node: Document | Element, name: string) => [
  ...node.getElementsByTagNameNS("*", name),
];
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const toBase64 = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
export const fromBase64 = (value: string, type: string) =>
  new Blob([Uint8Array.from(atob(value), (char) => char.charCodeAt(0))], { type });

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      rows.at(-1)!.push(value.replace(/\r$/, ""));
      value = "";
      if (char === "\n") rows.push([]);
    } else value += char;
  }
  rows.at(-1)!.push(value);
  if (rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "") rows.pop();
  return rows;
}
export const writeCsv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
        .join(","),
    )
    .join("\n");
const columnIndex = (ref: string) =>
  [...ref.replace(/[0-9]/g, "")].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) -
  1;
const columnName = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);

export async function readEditable(blob: Blob, name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension !== "docx" && extension !== "xlsx") {
    const text = await blob.text();
    return {
      text,
      rows: extension === "csv" ? parseCsv(text) : null,
      html: "",
      zip: null,
      sheetPath: "",
    };
  }
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  if (extension === "docx") {
    const document = parse(await zip.file("word/document.xml")!.async("string"));
    const paragraphs = elements(document, "p").map((paragraph) =>
      elements(paragraph, "t")
        .map((run) => run.textContent)
        .join(""),
    );
    return {
      text: paragraphs.join("\n"),
      rows: null,
      html: paragraphs.map((text) => `<p>${escape(text)}</p>`).join(""),
      zip,
      sheetPath: "",
    };
  }
  const shared = zip.file("xl/sharedStrings.xml");
  const strings = shared
    ? elements(parse(await shared.async("string")), "si").map((item) =>
        elements(item, "t")
          .map((text) => text.textContent)
          .join(""),
      )
    : [];
  const sheetPath = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort()[0]!;
  const document = parse(await zip.file(sheetPath)!.async("string"));
  const rows: string[][] = [];
  for (const row of elements(document, "row")) {
    const values: string[] = [];
    for (const cell of elements(row, "c")) {
      const raw = elements(cell, "v")[0]?.textContent ?? "";
      values[columnIndex(cell.getAttribute("r") ?? "A1")] =
        cell.getAttribute("t") === "s"
          ? (strings[Number(raw)] ?? "")
          : cell.getAttribute("t") === "inlineStr"
            ? elements(cell, "t")
                .map((text) => text.textContent)
                .join("")
            : raw;
    }
    rows[Number(row.getAttribute("r") ?? rows.length + 1) - 1] = values;
  }
  return { text: writeCsv(rows), rows, html: "", zip, sheetPath };
}
export type EditableFile = Awaited<ReturnType<typeof readEditable>>;
export async function writeEditable(
  file: EditableFile,
  name: string,
  html: string,
  text: string,
  rows: string[][],
): Promise<Blob> {
  if (!file.zip)
    return new Blob([
      name.endsWith(".csv") ? writeCsv(rows) : name.endsWith(".md") ? richTextMarkdown(html) : text,
    ]);
  const zip = file.zip;
  if (name.toLowerCase().endsWith(".docx")) {
    const dom = new DOMParser().parseFromString(html, "text/html");
    const blocks = [...dom.body.children];
    const body = blocks
      .map((block) => {
        const runs = (node: Node): string =>
          node.nodeType === Node.TEXT_NODE
            ? `<w:r><w:t xml:space="preserve">${escape(node.textContent ?? "")}</w:t></w:r>`
            : node instanceof Element
              ? `<w:r><w:rPr>${node.closest("strong,b") ? "<w:b/>" : ""}${node.closest("em,i") ? "<w:i/>" : ""}</w:rPr><w:t xml:space="preserve">${escape(node.textContent ?? "")}</w:t></w:r>`
              : "";
        return `<w:p>${/^H[1-6]$/.test(block.tagName) ? `<w:pPr><w:pStyle w:val="Heading${block.tagName[1]}"/></w:pPr>` : ""}${[...block.childNodes].map(runs).join("")}</w:p>`;
      })
      .join("");
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    );
  } else {
    const document = parse(await zip.file(file.sheetPath)!.async("string"));
    const sheet = elements(document, "sheetData")[0]!;
    const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    rows.forEach((row, index) =>
      row.forEach((value, column) => {
        if (value === file.rows?.[index]?.[column]) return;
        let rowNode = elements(sheet, "row").find(
          (node) => node.getAttribute("r") === String(index + 1),
        );
        if (!rowNode) {
          rowNode = document.createElementNS(namespace, "row");
          rowNode.setAttribute("r", String(index + 1));
          sheet.append(rowNode);
        }
        const reference = `${columnName(column)}${index + 1}`;
        const previous = elements(rowNode, "c").find(
          (node) => node.getAttribute("r") === reference,
        );
        const cell = document.importNode(
          parse(
            `<c xmlns="${namespace}" r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`,
          ).documentElement,
          true,
        );
        if (previous?.hasAttribute("s")) cell.setAttribute("s", previous.getAttribute("s")!);
        if (previous) previous.replaceWith(cell);
        else rowNode.append(cell);
      }),
    );
    zip.file(file.sheetPath, new XMLSerializer().serializeToString(document));
  }
  return zip.generateAsync({ type: "blob" });
}

export function richTextMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    const inner = [...node.childNodes].map(render).join("");
    if (node.tagName === "STRONG") return `**${inner}**`;
    if (node.tagName === "EM") return `*${inner}*`;
    if (node.tagName === "A") return `[${inner}](${node.getAttribute("href") ?? ""})`;
    if (/^H[1-6]$/.test(node.tagName)) return `${"#".repeat(Number(node.tagName[1]))} ${inner}\n\n`;
    if (node.tagName === "LI") return `- ${inner.trim()}\n`;
    if (node.tagName === "P") return `${inner}\n\n`;
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "CODE") return `\`${inner}\``;
    return inner;
  };
  return [...document.body.childNodes].map(render).join("").trimEnd() + "\n";
}
