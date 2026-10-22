import { getSingletonHighlighter, type Highlighter, type BundledLanguage } from "shiki";

export const resolveSyntaxThemeName = (theme: "light" | "dark") =>
  theme === "dark" ? "github-dark" : "github-light";

const highlighters = new Map<string, Promise<Highlighter>>();

export function getSyntaxHighlighterPromise(language: string): Promise<Highlighter> {
  const cached = highlighters.get(language);
  if (cached) return cached;
  const promise = getSingletonHighlighter({
    themes: ["github-dark", "github-light"],
    langs: [language as BundledLanguage],
  }).catch((error) => {
    highlighters.delete(language);
    if (language === "text") throw error;
    return getSyntaxHighlighterPromise("text");
  });
  highlighters.set(language, promise);
  return promise;
}
