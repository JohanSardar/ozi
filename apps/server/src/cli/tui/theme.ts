import {
  getTerminalColorMode,
  parseColor,
  styleText,
  type Color,
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
  type TextAttributes,
} from "@earendil-works/pi-tui";

const palette = {
  text: "okhsl(234 3% 89%)",
  muted: "okhsl(229 6% 67%)",
  dim: "okhsl(229 8% 56%)",
  accent: "okhsl(295 50% 67%)",
  blue: "okhsl(232 54% 67%)",
  green: "okhsl(159 59% 67%)",
  red: "okhsl(20 72% 67%)",
  yellow: "okhsl(83 88% 67%)",
  userBg: "okhsl(233 41% 24%)",
  border: "okhsl(229 8% 53%)",
  toolPending: "okhsl(229 5% 24%)",
  toolOk: "okhsl(158 46% 25%)",
  toolError: "okhsl(19 54% 25%)",
};
type Tone = keyof typeof palette;

const mode = getTerminalColorMode();
const colors = Object.fromEntries(
  Object.entries(palette).map(([tone, value]) => [tone, parseColor(value)]),
) as Record<Tone, Color>;

export const fg = (tone: Tone, text: string, attributes: TextAttributes = {}) =>
  styleText(text, { ...attributes, fg: colors[tone] }, mode);
export const bg = (tone: Tone, text: string) => styleText(text, { bg: colors[tone] }, mode);
const attr = (attributes: TextAttributes) => (text: string) => styleText(text, attributes, mode);

export const markdown: MarkdownTheme = {
  heading: (text) => fg("yellow", text),
  link: (text) => fg("blue", text),
  linkUrl: (text) => fg("muted", text),
  code: (text) => fg("accent", text),
  codeBlock: (text) => fg("green", text),
  codeBlockBorder: (text) => fg("muted", text),
  quote: (text) => fg("muted", text),
  quoteBorder: (text) => fg("muted", text),
  hr: (text) => fg("muted", text),
  listBullet: (text) => fg("accent", text),
  bold: attr({ bold: true }),
  italic: attr({ italic: true }),
  underline: attr({ underline: true }),
  strikethrough: attr({ strikethrough: true }),
};

export const selectList: SelectListTheme = {
  selectedPrefix: (text) => fg("accent", text),
  selectedText: (text) => fg("accent", text),
  description: (text) => fg("muted", text),
  scrollInfo: (text) => fg("muted", text),
  noMatch: (text) => fg("muted", text),
};

export const editor: EditorTheme = { borderColor: (text) => fg("border", text), selectList };
