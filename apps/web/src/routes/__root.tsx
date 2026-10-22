import { Outlet, createRootRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAtomValue } from "@effect/atom-react";
import { APP_BASE_NAME, APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppDisplayName } from "../branding.logic";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import { isHostedStaticApp, hasHostedPairingRequest } from "../hostedPairing";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { primaryServerConfigAtom } from "../state/server";
import { useClientSettings } from "../hooks/useSettings";
import { useEnvironmentThemeSync } from "../hooks/useEnvironmentTheme";
import { useDefaultThemeAdoption } from "../hooks/useDefaultTheme";
import { syncBrowserChromeTheme } from "../hooks/useTheme";
import { applyAppearanceFontVariables } from "../appearanceFonts";
import { applyAppearanceContrast } from "../appearanceContrast";
import { ToastProvider, AnchoredToastProvider } from "../components/ui/toast";
import { ProviderAuthCallbackCoordinator } from "../components/settings/ProviderAuthCallbackCoordinator";
import { ConfirmDialogHost } from "../components/ConfirmDialogHost";
import { installDesktopPasteAsText } from "../lib/desktopPasteAsText";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => ({
    authGateState:
      location.pathname === "/pair" && hasHostedPairingRequest(new URL(window.location.href))
        ? { status: "hosted-pairing" as const }
        : isLocalEnvironmentDisabled() || isHostedStaticApp(new URL(window.location.href))
          ? { status: "hosted-static" as const }
          : await resolveInitialServerAuthGateState(),
  }),
  component: RootView,
  errorComponent: ({ error }) => (
    <main className="p-8">
      <h1>Couldn’t open Ozi</h1>
      <p>{error.message}</p>
      <button onClick={() => window.location.reload()}>Try again</button>
    </main>
  ),
  notFoundComponent: () => (
    <main className="p-8">
      <p>This page is unavailable.</p>
      <Link to="/">Return to Ozi</Link>
    </main>
  ),
});

function RootView() {
  useEffect(() => installDesktopPasteAsText(window.desktopBridge, window), []);
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <DocumentTitleSync />
        <BrowserChromeThemeSync />
        <ContrastAppearanceSync />
        <EnvironmentThemeSync />
        <GlassAppearanceSync />
        <FontAppearanceSync />
        <ProviderAuthCallbackCoordinator />
        <ConfirmDialogHost />
        <Outlet />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function EnvironmentThemeSync() {
  useEnvironmentThemeSync();
  useDefaultThemeAdoption();
  return null;
}

function ContrastAppearanceSync() {
  const appearanceContrast = useClientSettings((settings) => settings.appearanceContrast);

  const chatWidth = useClientSettings((settings) => settings.chatWidth);
  useEffect(() => {
    document.documentElement.dataset.chatWidth = chatWidth;
  }, [chatWidth]);

  useEffect(() => {
    applyAppearanceContrast(document.documentElement, appearanceContrast);
  }, [appearanceContrast]);

  return null;
}

function GlassAppearanceSync() {
  const glassOpacity = useClientSettings((settings) => settings.glassOpacity);

  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--glass-opacity", `${glassOpacity}%`);
    if (glassOpacity === 100) {
      style.setProperty("--glass-blur", "0px");
    } else {
      style.removeProperty("--glass-blur");
    }
  }, [glassOpacity]);

  return null;
}

function FontAppearanceSync() {
  const fontFamilySans = useClientSettings((settings) => settings.fontFamilySans);
  const fontFamilyCode = useClientSettings((settings) => settings.fontFamilyCode);
  const fontFamilyComposer = useClientSettings((settings) => settings.fontFamilyComposer);
  const fontSizeInterface = useClientSettings((settings) => settings.fontSizeInterface);
  const fontSizePrompt = useClientSettings((settings) => settings.fontSizePrompt);
  const fontSizeCode = useClientSettings((settings) => settings.fontSizeCode);
  const fontSmoothing = useClientSettings((settings) => settings.fontSmoothing);

  useEffect(() => {
    applyAppearanceFontVariables(document.documentElement, {
      sans: fontFamilySans,
      code: fontFamilyCode,
      composer: fontFamilyComposer,
      sizeInterface: fontSizeInterface,
      sizePrompt: fontSizePrompt,
      sizeCode: fontSizeCode,
      smoothing: fontSmoothing,
    });
  }, [
    fontFamilyCode,
    fontFamilyComposer,
    fontFamilySans,
    fontSizeCode,
    fontSizeInterface,
    fontSizePrompt,
    fontSmoothing,
  ]);

  return null;
}

function BrowserChromeThemeSync() {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

function DocumentTitleSync() {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const title = resolveServerBackedAppDisplayName({
    baseName: APP_BASE_NAME,
    fallbackDisplayName: APP_DISPLAY_NAME,
    fallbackStageLabel: APP_STAGE_LABEL,
    primaryServerVersion,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
