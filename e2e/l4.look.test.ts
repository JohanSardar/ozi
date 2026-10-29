import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const web = NodePath.resolve(import.meta.dirname, "../apps/web/src");

async function classLines() {
  const lines: Array<string> = [];
  for (const entry of await NodeFSP.readdir(web, { recursive: true })) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    const text = await NodeFSP.readFile(NodePath.join(web, entry), "utf8");
    text.split("\n").forEach((line, index) => {
      for (const literal of line.match(/"[^"]*"|`[^`]*`/g) ?? []) {
        lines.push(`${entry}:${index + 1}: ${literal}`);
      }
    });
  }
  return lines;
}

it("l4.corners: every radius token is 6–8px", async () => {
  const css = await NodeFSP.readFile(NodePath.join(web, "index.css"), "utf8");
  const radius = Number(/--radius: ([\d.]+)rem;/.exec(css)?.[1]) * 16;
  const tokens = [...css.matchAll(/--radius-(\w+): (.+);/g)].map(([, name, value]) => {
    const offset = /calc\(var\(--radius\) ([+-]) (\d+)px\)/.exec(value!);
    const px = offset ? radius + (offset[1] === "+" ? 1 : -1) * Number(offset[2]) : radius;
    return [name, px] as const;
  });
  expect(tokens.map(([name]) => name)).toEqual(["sm", "md", "lg", "xl", "2xl", "3xl"]);
  for (const [name, px] of tokens) {
    expect(px, name).toBeGreaterThanOrEqual(6);
    expect(px, name).toBeLessThanOrEqual(8);
  }
});

it("l4.no-pills: nothing with text is fully rounded", async () => {
  const pills = (await classLines()).filter(
    (line) => /\brounded-full\b/.test(line) && /\bpx-\d/.test(line),
  );
  expect(pills).toEqual([]);
});

it("l4.no-coloured-dots: status shows as spinners and text, not coloured dots", async () => {
  const dots = (await classLines()).filter(
    (line) =>
      /\brounded-full\b/.test(line) &&
      /\bsize-(1|1\.5|2|2\.5|\[\d+px\])\b/.test(line) &&
      /\bbg-(success|warning|destructive|info|guest|sky|emerald|amber|red|violet|indigo|green|yellow|blue)\b/.test(
        line,
      ),
  );
  expect(dots).toEqual([]);
});

it("l4.plain-labels: labels are sentence case, never forced capitals", async () => {
  const capitals = (await classLines()).filter((line) => /(^|[\s"`])uppercase\b/.test(line));
  expect(capitals).toEqual([]);
});
