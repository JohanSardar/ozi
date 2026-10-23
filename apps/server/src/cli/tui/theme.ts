import {
  getTerminalColorMode,
  parseColor,
  styleText,
  type Color,
  type EditorTheme,
  type MarkdownTheme,
  type SelectListTheme,
  type SettingsListTheme,
  type TextAttributes,
} from "@earendil-works/pi-tui";
import * as Option from "effect/Option";

const tokens = {
  text: "text",
  muted: "muted",
  dim: "dim",
  accent: "accent",
  blue: "mdLink",
  green: "mdCodeBlock",
  red: "error",
  yellow: "mdHeading",
  userBg: "userMessageBg",
  border: "borderMuted",
  thinking: "thinkingText",
  toolPending: "toolPendingBg",
  toolOk: "toolSuccessBg",
  toolError: "toolErrorBg",
} as const;
type Tone = keyof typeof tokens;
export type PiTheme = {
  readonly vars?: Record<string, string | number> | undefined;
  readonly colors: Record<string, string | number>;
};

const dark: PiTheme = {
  vars: {
    text: "okhsl(234 3% 89%)",
    muted: "okhsl(229 6% 67%)",
    violet: "okhsl(295 50% 67%)",
    blue: "okhsl(232 54% 67%)",
    green: "okhsl(159 59% 67%)",
    red: "okhsl(20 72% 67%)",
    yellow: "okhsl(83 88% 67%)",
    blueBg: "okhsl(233 41% 24%)",
  },
  colors: {
    text: "text",
    muted: "muted",
    dim: "okhsl(229 8% 56%)",
    accent: "violet",
    mdLink: "blue",
    mdCodeBlock: "green",
    error: "red",
    mdHeading: "yellow",
    userMessageBg: "blueBg",
    borderMuted: "okhsl(229 8% 53%)",
    thinkingText: "okhsl(226 7% 65%)",
    toolPendingBg: "okhsl(229 5% 24%)",
    toolSuccessBg: "okhsl(158 46% 25%)",
    toolErrorBg: "okhsl(19 54% 25%)",
  },
};

const light: PiTheme = {
  vars: {
    text: "okhsl(225 5% 27%)",
    muted: "okhsl(229 8% 47%)",
    violet: "okhsl(295 60% 46%)",
    blue: "okhsl(231 68% 47%)",
    green: "okhsl(159 75% 46%)",
    red: "okhsl(20 91% 47%)",
    yellow: "okhsl(83 99% 47%)",
    blueBg: "okhsl(235 19% 91%)",
  },
  colors: {
    ...dark.colors,
    dim: "okhsl(229 7% 59%)",
    borderMuted: "okhsl(235 7% 66%)",
    thinkingText: "okhsl(234 8% 55%)",
    toolPendingBg: "okhsl(248 3% 91%)",
    toolSuccessBg: "okhsl(156 21% 91%)",
    toolErrorBg: "okhsl(24 23% 91%)",
  },
};

export const builtinThemes: Record<string, PiTheme> = { dark, light };

const color = (theme: PiTheme, token: string) => {
  const value = theme.colors[token];
  if (value === undefined) return undefined;
  const named = typeof value === "string" ? theme.vars?.[value] : undefined;
  return Option.getOrUndefined(Option.liftThrowable(parseColor)(named ?? value));
};
const resolve = (theme: PiTheme) =>
  Object.fromEntries(
    Object.entries(tokens).map(([tone, token]) => [
      tone,
      color(theme, token) ?? color(dark, token)!,
    ]),
  ) as Record<Tone, Color>;

const mode = getTerminalColorMode();
let colors = resolve(dark);
export const useTheme = (theme: PiTheme) => {
  colors = resolve(theme);
};

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

export const settingsList: SettingsListTheme = {
  label: (text, selected) => fg(selected ? "accent" : "text", text),
  value: (text, selected) => fg(selected ? "accent" : "muted", text),
  description: (text) => fg("muted", text),
  cursor: fg("accent", "→ "),
  hint: (text) => fg("dim", text),
};

export const editor: EditorTheme = { borderColor: (text) => fg("border", text), selectList };
