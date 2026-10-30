import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { NavigationRow } from "../../components/ui/NavigationRow";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Button } from "../../components/ui/Button";
import {
  buildProjectCreateCommand,
  canCreateProjectInEnvironment,
  findExistingAddProject,
  getAddProjectInitialQuery,
  resolveAddProjectPath,
} from "@t3tools/client-runtime/operations/projects";
import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
  resolveFilesystemReadAccess,
} from "@t3tools/client-runtime/state/filesystem";
import {
  appendBrowsePathSegment,
  inferProjectTitleFromPath,
  isWindowsPlatform,
} from "@t3tools/client-runtime/state/projects";
import {
  AuthOrchestrationOperateScope,
  AuthFilesystemReadScope,
  CommandId,
  type EnvironmentId,
  type EnvironmentMachineKind,
  ProjectId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  StackActions,
  useNavigation,
  type NavigationState,
  type ParamListBase,
} from "@react-navigation/native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Order from "effect/Order";
import { AsyncResult } from "effect/reactivity";
import { cn } from "../../lib/cn";
import { useProjects, useServerConfigs, waitForProject } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession, useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useEnvironmentPresentation } from "../../state/presentation";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { uuidv4 } from "../../lib/uuid";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import {
  useRemoteConnectionStatus,
  useRemoteEnvironmentRuntime,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { resolveAddProjectEnvironment } from "./AddProjectScreen.logic";

interface EnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly platform: string;
  readonly machine: EnvironmentMachineKind;
  readonly baseDirectory: string | null;
  readonly newProjectsRoot: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
}

const environmentOptionOrder = Order.mapInput(
  Order.Struct({
    label: Order.String,
  }),
  (environment: EnvironmentOption) => ({ label: environment.label }),
);

function platformFromOs(os: string | null | undefined): string {
  if (os === "windows") return "Win32";
  if (os === "darwin") return "MacIntel";
  if (os === "linux") return "Linux";
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "An error occurred.";
}

function stringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function SectionTitle(props: { readonly children: string }) {
  return (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 text-sm font-t3-medium text-primary-text"
          : "px-1 text-2xs font-t3-bold tracking-[0.7px] uppercase text-foreground-muted"
      }
    >
      {props.children}
    </Text>
  );
}

function AddProjectShell(props: { readonly children: ReactNode; readonly title: string }) {
  const insets = useSafeAreaInsets();

  return (
    // A collapsible wrapper lets formSheet resizing mistake the full-height view for a header and collapse the ScrollView.
    <SettingsScreen title={props.title}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: Platform.OS === "android" ? 16 : 20,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          gap: Platform.OS === "android" ? 16 : 10,
        }}
      >
        {props.children}
      </ScrollView>
    </SettingsScreen>
  );
}

function ListSection(props: { readonly children: ReactNode }) {
  return (
    <View
      className={
        Platform.OS === "android"
          ? "overflow-hidden rounded-[28px] bg-grouped-card"
          : "overflow-hidden rounded-[24px] bg-grouped-card"
      }
    >
      {props.children}
    </View>
  );
}

function ListRow(props: {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly isFirst?: boolean;
  readonly right?: ReactNode;
  readonly onPress?: () => void;
}) {
  if (Platform.OS === "android") {
    return (
      <NavigationRow
        className="bg-grouped-card"
        title={props.title}
        subtitle={props.subtitle}
        leading={props.icon}
        trailing={props.right}
        disabled={props.disabled}
        onPress={props.onPress}
        accessibilityRole={props.selected !== undefined ? "radio" : "button"}
        accessibilityState={props.selected !== undefined ? { checked: props.selected } : undefined}
      />
    );
  }
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "bg-grouped-card px-3.5 py-2.5 active:opacity-70",
        !props.isFirst && "border-t border-border-subtle",
        props.disabled && "opacity-[0.45]",
      )}
    >
      <View className="flex-row items-center gap-3">
        <View
          className={
            props.selected
              ? "h-7 w-7 items-center justify-center rounded-full bg-primary"
              : "h-7 w-7 items-center justify-center"
          }
        >
          {props.icon}
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base leading-snug font-t3-bold">{props.title}</Text>
          {props.subtitle ? (
            <Text className="text-sm leading-snug text-foreground-muted" numberOfLines={2}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {"right" in props ? (
          props.right
        ) : !props.disabled ? (
          <SymbolView
            name="chevron.right"
            size={13}
            tintColorClassName="accent-chevron"
            type="monochrome"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function PrimaryActionButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly onPress: () => void;
}) {
  return <Button {...props} tone="primary" fullWidth />;
}

function ProjectPathInput(props: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  return (
    <TextInput
      className="h-12 min-h-12 rounded-[24px] px-4 py-0 text-base leading-snug"
      value={props.value}
      onChangeText={props.onChangeText}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="~/projects/my-app"
      returnKeyType="done"
      onSubmitEditing={props.onSubmit}
    />
  );
}

function useBrowsePathInput(environment: EnvironmentOption | null) {
  const environmentId = environment?.environmentId ?? null;
  const environmentBaseDirectory = environment?.baseDirectory ?? null;
  const seedPath = getAddProjectInitialQuery(environmentBaseDirectory);
  // Each host keeps the path last typed or browsed for it, and shows its own default until then,
  // so switching hosts and back loses nothing. With no host selected (one dropping out briefly),
  // the field keeps the last path typed anywhere.
  const [paths, setPaths] = useState<{
    readonly byHost: ReadonlyMap<EnvironmentId, string>;
    readonly last: string;
  }>(() => ({ byHost: new Map(), last: seedPath }));
  const pathInput =
    environmentId === null ? paths.last : (paths.byHost.get(environmentId) ?? seedPath);
  const commitPathInput = (path: string) =>
    setPaths((current) => {
      const byHost = new Map(current.byHost);
      if (environmentId !== null) {
        byHost.set(environmentId, path);
      }
      return { byHost, last: path };
    });
  const environmentRuntime = useRemoteEnvironmentRuntime(environmentId);
  const loadBrowsePath = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const [browseNavigation] = useState(createBrowseNavigationCoordinator);
  const [navigatingEnvironmentId, setNavigatingEnvironmentId] = useState<
    EnvironmentId | null | undefined
  >(undefined);
  const isBrowseNavigating = navigatingEnvironmentId === environmentId;
  const setPathInput = (path: string) => {
    browseNavigation.invalidate();
    setNavigatingEnvironmentId(undefined);
    commitPathInput(path);
  };
  const navigateToBrowsePath = async (input: {
    readonly browseDirectoryPath: string;
    readonly selectedDirectoryName?: string;
  }) => {
    const selectedDirectoryPath = input.selectedDirectoryName
      ? appendBrowsePathSegment(input.browseDirectoryPath, input.selectedDirectoryName)
      : input.browseDirectoryPath;
    const nextPathInput = selectedDirectoryPath;
    setNavigatingEnvironmentId(environmentId);
    const committed = await browseNavigation.run(
      async () => {
        if (
          environment &&
          readEnvironmentScope(environment.environmentId, AuthFilesystemReadScope) &&
          canPreloadBrowsePath(environmentRuntime?.connectionState)
        ) {
          await loadBrowsePath({
            environmentId: environment.environmentId,
            input: { partialPath: selectedDirectoryPath },
          });
        }
      },
      () => commitPathInput(nextPathInput),
    );
    if (committed) {
      setNavigatingEnvironmentId(undefined);
    }
    return committed;
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- invalidates the browse navigation coordinator on unmount so in-flight browses do not commit
  useEffect(
    () => () => {
      browseNavigation.invalidate();
    },
    [browseNavigation],
  );

  return { isBrowseNavigating, pathInput, setPathInput, navigateToBrowsePath };
}

function useEnvironmentOptions(
  selectedEnvironmentId: EnvironmentId | null = null,
): ReadonlyArray<EnvironmentOption> {
  const serverConfigByEnvironmentId = useServerConfigs();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const { connectedEnvironments } = useRemoteConnectionStatus();

  return ((): ReadonlyArray<EnvironmentOption> => {
    const runtimeByEnvironmentId = new Map(
      connectedEnvironments.map((environment) => [environment.environmentId, environment] as const),
    );
    const options = Object.values(savedConnectionsById).map((connection) => {
      const config = serverConfigByEnvironmentId.get(connection.environmentId);
      const runtime = runtimeByEnvironmentId.get(connection.environmentId);
      return {
        environmentId: connection.environmentId,
        label: connection.environmentLabel,
        platform: platformFromOs(config?.environment.platform.os ?? null),
        machine: resolveEnvironmentMachineKind(config ?? null),
        baseDirectory: config?.settings.addProjectBaseDirectory ?? null,
        newProjectsRoot: config?.newProjectsRoot ?? null,
        connectionState: runtime?.connectionState ?? "available",
        connectionError: runtime?.connectionError ?? null,
        connectionErrorTraceId: runtime?.connectionErrorTraceId ?? null,
      };
    });
    return Arr.sort(
      options.filter(
        (environment) =>
          canCreateProjectInEnvironment(environment.connectionState) ||
          environment.environmentId === selectedEnvironmentId,
      ),
      environmentOptionOrder,
    );
  })();
}

function useSelectedEnvironment(requestedEnvironmentId: EnvironmentId | null): {
  readonly environmentOptions: ReadonlyArray<EnvironmentOption>;
  readonly selectedEnvironment: EnvironmentOption | null;
  readonly setSelectedEnvironmentId: (environmentId: EnvironmentId) => void;
} {
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(requestedEnvironmentId);
  const [previousRequest, setPreviousRequest] = useState(requestedEnvironmentId);
  if (previousRequest !== requestedEnvironmentId) {
    setPreviousRequest(requestedEnvironmentId);
    setSelectedEnvironmentId(requestedEnvironmentId);
  }
  const environmentOptions = useEnvironmentOptions(selectedEnvironmentId);
  const selectedEnvironment =
    environmentOptions.find((environment) => environment.environmentId === selectedEnvironmentId) ??
    environmentOptions.find((environment) =>
      canCreateProjectInEnvironment(environment.connectionState),
    ) ??
    null;

  return {
    environmentOptions,
    selectedEnvironment,
    setSelectedEnvironmentId,
  };
}

function EmptyEnvironmentState() {
  const navigation = useNavigation();

  return (
    <View className="items-center gap-3 rounded-2xl bg-grouped-card px-5 py-8">
      <Text className="text-center text-lg font-t3-bold">Environment unavailable</Text>
      <Text className="text-center text-sm leading-normal text-foreground-muted">
        Start or reconnect an environment before adding a project.
      </Text>
      <View className="mt-1">
        <Button
          label="Add environment"
          tone="primary"
          onPress={() => navigation.dispatch(StackActions.replace("ConnectionsNew"))}
        />
      </View>
    </View>
  );
}

export function AddProjectSourceScreen(props: { readonly environmentId?: string | string[] }) {
  const navigation = useNavigation();
  return (
    <AddProjectShell title="Add project">
      <ListSection>
        <ListRow
          title="New folder"
          isFirst
          onPress={() =>
            navigation.navigate("AddProjectNew", {
              environmentId: stringParam(props.environmentId) ?? undefined,
            })
          }
        />
        <ListRow
          title="Open folder"
          onPress={() =>
            navigation.navigate("AddProjectLocal", {
              environmentId: stringParam(props.environmentId) ?? undefined,
            })
          }
        />
      </ListSection>
    </AddProjectShell>
  );
}

function getActiveRoute(navigation: {
  getState: () => NavigationState<ParamListBase> | undefined;
}) {
  const state = navigation.getState();
  return state?.routes[state.index];
}

function useOpenNewTaskDraft() {
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const selectDetail = useSelectWorkspaceDetail();
  return (
    params: {
      environmentId: EnvironmentId;
      projectId: ProjectId;
      title: string;
      cloning?: "1";
      draftId?: string;
    },
    originRoute: NavigationState<ParamListBase>["routes"][number] | undefined,
  ) => {
    const activeRoute = getActiveRoute(navigation);
    // A warm link can change the task without replacing its native route key.
    if (
      !originRoute ||
      activeRoute?.key !== originRoute.key ||
      activeRoute.name !== originRoute.name ||
      activeRoute.params !== originRoute.params
    )
      return;
    selectDetail({ name: "Thread", params: { draft: params } });
  };
}

function useCreateProject(environment: EnvironmentOption | null) {
  const openNewTaskDraft = useOpenNewTaskDraft();
  const navigation = useNavigation();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const projects = useProjects();

  return async (workspaceRoot: string, originRoute = getActiveRoute(navigation)) => {
    if (
      !environment ||
      !canCreateProjectInEnvironment(environment.connectionState) ||
      !readEnvironmentScope(environment.environmentId, AuthOrchestrationOperateScope)
    ) {
      Dialog.alert(
        "Project not added",
        `This connection cannot add projects right now. Any existing files remain at ${workspaceRoot}.`,
      );
      return;
    }

    const existing = findExistingAddProject({
      projects,
      environmentId: environment.environmentId,
      path: workspaceRoot,
    });
    if (existing) {
      Dialog.alert("Project already exists", existing.title);
      openNewTaskDraft(
        {
          environmentId: existing.environmentId,
          projectId: existing.id,
          title: existing.title,
        },
        originRoute,
      );
      return;
    }

    const projectId = ProjectId.make(uuidv4());
    const command = buildProjectCreateCommand({
      commandId: CommandId.make(uuidv4()),
      projectId,
      workspaceRoot,
    });
    const result = await createProject({
      environmentId: environment.environmentId,
      input: command,
    });
    if (AsyncResult.isFailure(result)) {
      return result;
    }
    // A successful command can precede its project in the client store. The
    // draft treats a missing project as a reason to return to the chooser.
    const project = await waitForProject(
      { environmentId: environment.environmentId, projectId },
      15_000,
    );
    if (project === null) {
      Dialog.alert(
        "Project added",
        "The project was created but has not reached this device yet. It will appear in the project list once the connection catches up.",
      );
      return result;
    }
    openNewTaskDraft(
      {
        environmentId: environment.environmentId,
        projectId,
        title: inferProjectTitleFromPath(workspaceRoot),
      },
      originRoute,
    );
    return result;
  };
}

function useEnvironmentFromParam(
  environmentIdParam: string | string[] | undefined,
): EnvironmentOption | null {
  const environmentOptions = useEnvironmentOptions();
  const environmentId = stringParam(environmentIdParam) as EnvironmentId | null;
  return resolveAddProjectEnvironment(environmentOptions, environmentId);
}

function FolderBrowser(props: {
  readonly environment: EnvironmentOption;
  readonly pathInput: string;
  readonly setPathInput: (path: string) => void;
  readonly navigateToBrowsePath: (input: {
    readonly browseDirectoryPath: string;
    readonly selectedDirectoryName?: string;
  }) => Promise<boolean>;
  readonly pinnedDirectoryName?: string;
}) {
  const browsePath = getFilesystemBrowsePath(props.pathInput, props.environment.platform);
  const browseInput =
    browsePath.directoryPath.length > 0 ? { partialPath: browsePath.directoryPath } : null;
  const fileAccessSession = useEnvironmentQuery(
    environmentSession.sessionStateAtom(props.environment.environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(props.environment.environmentId);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const browseState = useEnvironmentQuery(
    !canReadFiles || browseInput === null
      ? null
      : filesystemEnvironment.browse({
          environmentId: props.environment.environmentId,
          input: browseInput,
        }),
  );
  const pinnedDirectoryName = props.pinnedDirectoryName ?? "";
  const pinnedDirectoryMatches = isWindowsPlatform(props.environment.platform)
    ? browsePath.filterQuery.toLowerCase() === pinnedDirectoryName.toLowerCase()
    : browsePath.filterQuery === pinnedDirectoryName;
  const browseFilterQuery = pinnedDirectoryMatches ? "" : browsePath.filterQuery;
  const { visibleEntries: visibleBrowseEntries } = filterFilesystemBrowseEntries(
    browseState.data?.entries ?? [],
    browseFilterQuery,
  );

  return (
    <>
      <SectionTitle>Browse folders</SectionTitle>
      {!canReadFiles && !fileAccess.isPending ? (
        <ErrorBanner message={fileAccess.error ?? "This connection cannot browse host folders."} />
      ) : null}
      {browseState.error ? <ErrorBanner message={browseState.error} /> : null}
      <ListSection>
        {fileAccess.isPending || (browseState.isPending && browseState.data === null) ? (
          <View className="items-center py-5">
            <AppActivityIndicator colorClassName="accent-icon-muted" />
          </View>
        ) : null}
        {browsePath.canBrowseUp ? (
          <ListRow
            title=".."
            icon={
              <SymbolView
                name="arrow.turn.left.up"
                size={Platform.OS === "android" ? 24 : 17}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            }
            isFirst
            right={null}
            onPress={() => {
              if (browsePath.parentPath) {
                void props.navigateToBrowsePath({
                  browseDirectoryPath: browsePath.parentPath,
                });
              }
            }}
          />
        ) : null}
        {visibleBrowseEntries.map((entry, index) => (
          <ListRow
            key={entry.fullPath}
            title={entry.name}
            icon={
              <SymbolView
                name="folder"
                size={Platform.OS === "android" ? 24 : 17}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            }
            isFirst={index === 0 && !browsePath.canBrowseUp}
            right={null}
            onPress={() => {
              void props.navigateToBrowsePath({
                browseDirectoryPath: browsePath.directoryPath,
                selectedDirectoryName: entry.name,
              });
            }}
          />
        ))}
      </ListSection>
    </>
  );
}

export function AddProjectNewScreen(props: { readonly environmentId?: string | string[] }) {
  const { selectedEnvironment: environment } = useSelectedEnvironment(
    stringParam(props.environmentId) as EnvironmentId | null,
  );
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const openDraft = useOpenNewTaskDraft();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!environment || !name.trim() || busy) return;
    setBusy(true);
    const result = await createNew({
      environmentId: environment.environmentId,
      input: { name: name.trim() },
    });
    setBusy(false);
    if (AsyncResult.isFailure(result)) {
      setError(errorMessage(Cause.squash(result.cause)));
      return;
    }
    openDraft(
      {
        environmentId: environment.environmentId,
        projectId: result.value.projectId,
        title: name.trim(),
      },
      getActiveRoute(navigation),
    );
  };
  return (
    <AddProjectShell title="New folder">
      {error ? <ErrorBanner message={error} /> : null}
      <ProjectPathInput value={name} onChangeText={setName} onSubmit={() => void submit()} />
      <PrimaryActionButton
        label="Create folder"
        disabled={busy || !environment || !name.trim()}
        loading={busy}
        onPress={() => void submit()}
      />
    </AddProjectShell>
  );
}

export function AddProjectLocalFolderScreen(props: { readonly environmentId?: string | string[] }) {
  const environment = useEnvironmentFromParam(props.environmentId);
  const canCreateProject = useEnvironmentScope(
    environment?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const createProject = useCreateProject(environment);
  const { isBrowseNavigating, navigateToBrowsePath, pathInput, setPathInput } =
    useBrowsePathInput(environment);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPath = async () => {
    if (!environment || isBrowseNavigating || isSubmitting) return;
    setError(null);
    const resolved = resolveAddProjectPath({
      rawPath: pathInput,
      currentProjectCwd: null,
      platform: environment.platform,
    });
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }

    setIsSubmitting(true);
    const result = await createProject(resolved.path);
    if (result && AsyncResult.isFailure(result)) {
      setError(errorMessage(Cause.squash(result.cause)));
    }
    setIsSubmitting(false);
  };

  return (
    <AddProjectShell title="Local folder">
      {error ? <ErrorBanner message={error} /> : null}
      {environment ? (
        <>
          {!canCreateProject ? (
            <ErrorBanner message="This connection cannot add projects." />
          ) : null}
          <ProjectPathInput value={pathInput} onChangeText={setPathInput} onSubmit={submitPath} />
          <PrimaryActionButton
            label="Add project"
            disabled={!canCreateProject || isBrowseNavigating || isSubmitting}
            onPress={submitPath}
            loading={isSubmitting}
          />
          <FolderBrowser
            environment={environment}
            navigateToBrowsePath={navigateToBrowsePath}
            pathInput={pathInput}
            setPathInput={setPathInput}
          />
        </>
      ) : (
        <EmptyEnvironmentState />
      )}
    </AddProjectShell>
  );
}
