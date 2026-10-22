import { useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";

export function AppearanceSettingsPanel() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const settings = useClientSettings();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-xl font-semibold">Appearance</h1>
      <label className="flex items-center justify-between gap-4">
        Colors
        <select
          aria-label="Colors"
          className="rounded border border-border bg-card p-2"
          value={appearanceMode}
          onChange={(event) => {
            if (!setAppearanceMode(event.target.value as "light" | "dark" | "system"))
              setError("Could not save appearance.");
          }}
        >
          <option value="system">Follow device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4">
        Text size
        <input
          aria-label="Text size"
          type="range"
          min="11"
          max="20"
          value={settings.fontSizeInterface}
          onChange={(event) =>
            void updateClientSettings({ fontSizeInterface: Number(event.target.value) }).catch(() =>
              setError("Could not save text size."),
            )
          }
        />
      </label>
      <label className="flex items-center justify-between gap-4">
        Message size
        <input
          aria-label="Message size"
          type="range"
          min="12"
          max="24"
          value={settings.fontSizePrompt}
          onChange={(event) =>
            void updateClientSettings({ fontSizePrompt: Number(event.target.value) }).catch(() =>
              setError("Could not save message size."),
            )
          }
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
