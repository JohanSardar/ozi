export const verdictText = (text: string) =>
  [...text.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/g)].at(-1)?.[1] ?? text;
