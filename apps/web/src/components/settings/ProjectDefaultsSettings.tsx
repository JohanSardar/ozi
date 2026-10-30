import type { ProjectSettingsCategory } from "./ProjectSettingsPanel";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { searchableSetting } from "./settingsSearch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { runtimeModeOptions } from "../chat/runtimeModeConfig";
import { type ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";

import {
  getCustomModelOptionsByInstance,
  resolveEffectiveDefaultModelSelection,
} from "../../modelSelection";
import {
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
} from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingSource,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ProjectDefaultsSettings(_props: { category: ProjectSettingsCategory }) {
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const storedSelection = resolveDefaultProviderModelSelection(
    providers,
    settings.defaultModelSelection,
  );
  const selection = storedSelection
    ? resolveEffectiveDefaultModelSelection(settings, providers, storedSelection)
    : null;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const mixedModel = useScopedSettingsMixed(["defaultModelSelection"]);
  const mixedFallback = useScopedSettingsMixed(["fallbackModelSelection"]);
  const fallbackSelection = settings.fallbackModelSelection ?? selection;
  const fallbackModelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    fallbackSelection?.instanceId,
    fallbackSelection?.model,
  );
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const modelSource = useScopedSettingSource(["defaultModelSelection"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;

  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);

  const setModel = (value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({ type: "error", title: "Default model not saved", description: reason });
      return;
    }
    updateSettings({ defaultModelSelection: value });
  };

  const modelRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultModelSelection"]}
      mixed={mixedModel}
      id="default-model"
      title="Model"
      description={
        isProjectScope
          ? "Model for new threads in this project."
          : !unavailable &&
              !mixedModel &&
              modelSource !== "project" &&
              settings.defaultModelSelection === null
            ? "Default model for new threads, selected automatically. Projects can override it."
            : "Default model for new threads. Projects can override it."
      }
      resetAction={
        settings.defaultModelSelection !== null ? (
          <SettingResetButton label="default model" onClick={() => setModel(null)} />
        ) : null
      }
      control={
        selection && activeEntry ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={representative?.environmentId ?? null}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              {...(mixedModel ? { triggerLabel: "Mixed" } : {})}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (representative)
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId: representative.environmentId, instanceId },
                  });
              }}
              onInstanceModelChange={(instanceId, model) =>
                setModel(createModelSelection(instanceId, model))
              }
            />
            {!mixedModel ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setModel(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No providers available</span>
        )
      }
    />
  );

  const fallbackRow = !isProjectScope ? (
    <SettingsRow
      serverScoped
      settingKeys={["fallbackModelSelection"]}
      mixed={mixedFallback}
      id="fallback-model"
      title="Fallback model"
      description="Used for new threads when the default model's provider is out of usage."
      resetAction={
        mixedFallback || settings.fallbackModelSelection !== null ? (
          <SettingResetButton
            label="fallback model"
            onClick={() => updateSettings({ fallbackModelSelection: null })}
          />
        ) : null
      }
      control={
        fallbackSelection ? (
          <ProviderModelPicker
            environmentId={representative?.environmentId ?? null}
            activeInstanceId={fallbackSelection.instanceId}
            model={fallbackSelection.model}
            lockedProvider={null}
            instanceEntries={entries}
            modelOptionsByInstance={fallbackModelOptions}
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            triggerAriaLabel="Fallback model"
            {...(mixedFallback
              ? { triggerLabel: "Mixed" }
              : settings.fallbackModelSelection === null
                ? { triggerLabel: "None" }
                : {})}
            getModelDisabledReason={modelDisabledReason}
            onInstanceModelChange={(instanceId, model) => {
              const reason = modelDisabledReason(instanceId, model);
              if (reason) {
                toastManager.add({
                  type: "error",
                  title: "Fallback model not saved",
                  description: reason,
                });
                return;
              }
              updateSettings({ fallbackModelSelection: createModelSelection(instanceId, model) });
            }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">No providers available</span>
        )
      }
    />
  ) : null;

  return (
    <SettingsSection id="project-defaults" title="New threads">
      {
        <>
          {modelRow}
          {fallbackRow}
          <SettingsRow
            serverScoped
            settingKeys={["defaultRuntimeMode"]}
            mixed={mixedPermissions}
            {...searchableSetting("default-permissions")}
            description={
              isProjectScope
                ? "Permissions for new threads in this project."
                : "Default permissions for new threads. Projects can override them."
            }
            resetAction={
              settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
                <SettingResetButton
                  label="default permissions"
                  onClick={() =>
                    updateSettings({
                      defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedPermissions ? null : settings.defaultRuntimeMode}
                onValueChange={(value) => {
                  if (value) updateSettings({ defaultRuntimeMode: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default permissions">
                  {!mixedPermissions && (
                    <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <SelectValue>
                    {mixedPermissions
                      ? "Mixed"
                      : runtimeModeConfig[settings.defaultRuntimeMode].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const Icon = option.icon;
                    return (
                      <SelectItem key={mode} value={mode} className="min-w-64">
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {option.label}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
        </>
      }
    </SettingsSection>
  );
}
