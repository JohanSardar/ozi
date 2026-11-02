import { useAuth } from "@clerk/react";
import { Link } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function LabsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection id="beta" title="Beta">
        {hasCloudPublicConfig() ? <GuestLinksRowWithSignIn /> : <GuestLinksRow />}
        <LinkedEnvironmentsRow />
      </SettingsSection>
      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

function LegacyFeaturesSection() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsSection id="legacy-features" title="Legacy">
      <SettingsRow
        {...searchableSetting("legacy-plan-mode")}
        description="Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode."
        control={
          <Switch
            checked={settings.planModeEnabled}
            onCheckedChange={(checked) => updateSettings({ planModeEnabled: Boolean(checked) })}
            aria-label="Plan mode (legacy)"
          />
        }
      />
    </SettingsSection>
  );
}

/** Signed out of T3 Connect, the row offers to sign in instead of its switch. */
function GuestLinksRowWithSignIn() {
  const { isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  // `isSignedIn` is undefined until Clerk loads.
  if (isSignedIn !== false) return <GuestLinksRow />;
  return (
    <SettingsRow
      {...searchableSetting("guest-links")}
      description="Share a thread with a guest who watches it live in their browser and sends messages you approve. Sign in to T3 Connect to use guest links."
      control={
        <Button size="sm" variant="outline" onClick={openAuthPrompt}>
          Sign in
        </Button>
      }
    />
  );
}

function GuestLinksRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("guest-links")}
      settingKeys={["guestSharingEnabled"]}
      description={
        <>
          Share a thread with a guest who watches it live in their browser and sends messages you
          approve. Needs T3 Connect: sign in and link this machine in{" "}
          <Link to="/settings/access" className="underline underline-offset-2">
            Sharing & access
          </Link>
          . While it is off, every guest link stops working.
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["guestSharingEnabled"]}
          checked={settings.guestSharingEnabled}
          onCheckedChange={(checked) => updateSettings({ guestSharingEnabled: Boolean(checked) })}
          aria-label="Guest links"
        />
      }
    />
  );
}

function LinkedEnvironmentsRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting("linked-environments-beta")}
      settingKeys={["linkedEnvironmentsEnabled"]}
      description={
        <>
          Let agents here work on your other machines, and theirs here. Turn it on for each machine,
          then link them in{" "}
          <Link to="/settings/connections" className="underline underline-offset-2">
            Environments
          </Link>
          . While it is off, nothing new starts over a link; tasks already running finish.
        </>
      }
      control={
        <ScopedSwitch
          settingKeys={["linkedEnvironmentsEnabled"]}
          checked={settings.linkedEnvironmentsEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ linkedEnvironmentsEnabled: Boolean(checked) })
          }
          aria-label="Linked environments"
        />
      }
    />
  );
}
