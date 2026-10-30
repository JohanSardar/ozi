import { Platform } from "react-native";

export const CODE_MONO_FONT_FAMILY = Platform.select({
  ios: "ui-monospace",
  android: "monospace",
  default: "monospace",
});

export function renderVisibleWhitespace(value: string): string {
  return value
    .replace(/\t/g, "    ")
    .replace(/^( +)/, (leading) => leading.replaceAll(" ", "\u00A0"));
}
