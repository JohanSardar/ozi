import { useMemo } from "react";

import {
  resolveMobileCodeSurface,
  type ResolvedMobileCodeSurface,
} from "../../../lib/appearancePreferences";
import { createNativeSourceStyle } from "../../files/nativeSourceFileAdapter";
import { useAppearancePreferences } from "./AppearancePreferencesProvider";

export function useAppearanceCodeSurface(): {
  readonly codeSurface: ResolvedMobileCodeSurface;
  readonly codeWordBreak: boolean;
  readonly nativeSourceStyle: ReturnType<typeof createNativeSourceStyle>;
} {
  const { appearance } = useAppearancePreferences();
  const codeSurface = useMemo(
    () => resolveMobileCodeSurface(appearance.codeFontSize),
    [appearance.codeFontSize],
  );
  const nativeSourceStyle = useMemo(() => createNativeSourceStyle(codeSurface), [codeSurface]);

  return {
    codeSurface,
    codeWordBreak: appearance.codeWordBreak,
    nativeSourceStyle,
  };
}
