import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
} from "@t3tools/contracts";

const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Concrete names first: some engines alias `ui-monospace` to the
// proportional system UI font, which would break every code surface.
const DEFAULT_CODE_FONT_STACK =
  '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

function quoteFontFamilyName(name: string): string {
  const bare = name.trim();
  if (bare.length === 0) return "";
  if (/^(['"]).*\1$/.test(bare)) return bare;
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;
  return `"${bare.replaceAll('"', "")}"`;
}

function cssFontFamilies(input: string): string | null {
  const families = input
    .split(",")
    .map(quoteFontFamilyName)
    .filter((name) => name.length > 0);
  return families.length > 0 ? families.join(", ") : null;
}

export function appearanceFontStack(custom: string, defaultStack: string): string {
  const families = cssFontFamilies(custom);
  return families === null ? defaultStack : `${families}, ${defaultStack}`;
}

export interface AppearanceFontPreferences {
  readonly sans: string;
  readonly code: string;
  readonly composer: string;
  readonly sizeInterface: number;
  readonly sizePrompt: number;
  readonly sizeCode: number;
  readonly smoothing: boolean;
}

/**
 * Sizes are always written: the interface size drives the root font size (and
 * with it every rem-based dimension), while the prompt and code sizes stay in
 * absolute pixels so they do not scale twice.
 */
export function applyAppearanceFontVariables(
  root: HTMLElement,
  preferences: AppearanceFontPreferences,
): void {
  const families: ReadonlyArray<readonly [variable: string, custom: string, fallback: string]> = [
    ["--font-sans", preferences.sans, DEFAULT_SANS_FONT_STACK],
    ["--font-mono", preferences.code, DEFAULT_CODE_FONT_STACK],
    ["--font-composer", preferences.composer, "var(--font-sans)"],
  ];
  for (const [variable, custom, fallback] of families) {
    const list = cssFontFamilies(custom);
    if (list === null) {
      root.style.removeProperty(variable);
    } else {
      root.style.setProperty(variable, `${list}, ${fallback}`);
    }
  }

  root.style.fontSize = `${clampInterfaceFontSize(preferences.sizeInterface)}px`;
  root.style.setProperty("--font-size-prompt", `${clampPromptFontSize(preferences.sizePrompt)}px`);
  const code = clampCodeFontSize(preferences.sizeCode);
  root.style.setProperty("--font-size-code", `${code}px`);
  root.style.setProperty("--diffs-font-size", `${code}px`);

  if (preferences.smoothing) {
    root.style.setProperty("-webkit-font-smoothing", "antialiased");
  } else {
    root.style.removeProperty("-webkit-font-smoothing");
  }
}

function clampFontSize(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function clampInterfaceFontSize(value: number): number {
  return clampFontSize(
    value,
    MIN_INTERFACE_FONT_SIZE,
    MAX_INTERFACE_FONT_SIZE,
    DEFAULT_INTERFACE_FONT_SIZE,
  );
}

function clampPromptFontSize(value: number): number {
  return clampFontSize(value, MIN_PROMPT_FONT_SIZE, MAX_PROMPT_FONT_SIZE, DEFAULT_PROMPT_FONT_SIZE);
}

function clampCodeFontSize(value: number): number {
  return clampFontSize(value, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE, DEFAULT_CODE_FONT_SIZE);
}

export interface InstalledFontFamiliesResult {
  readonly families: readonly string[];
  readonly status: "granted" | "denied" | "unsupported";
}
