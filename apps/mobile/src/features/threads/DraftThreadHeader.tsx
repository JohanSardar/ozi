import { useNavigation } from "@react-navigation/native";
import { AuthFilesystemReadScope } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useEnvironmentScope } from "../../state/session";
import { ThreadHeader } from "./ThreadHeader";

export function DraftThreadHeader(props: {
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject;
  readonly cwd: string | null;
}) {
  const navigation = useNavigation();
  const { themeVariables } = useAppearancePreferences();
  const environmentId = props.thread.environmentId;
  const canReadFiles = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const openFiles = () => {
    if (!props.cwd || !canReadFiles) return;
    navigation.navigate("NewTaskFiles", {
      environmentId,
      cwd: props.cwd,
      projectName: props.project.title,
    });
  };
  return (
    <ThreadHeader
      draft
      title="New thread"
      subtitle=""
      headerColor={themeVariables["--color-header"]}
      usesNativeHeaderGlass={NATIVE_LIQUID_GLASS_SUPPORTED}
      hasThreadCwd={props.cwd !== null}
      hasWorkspaceRoot={Boolean(props.project.workspaceRoot)}
      fileInspectorSupported={false}
      inspectorMode={null}
      onToggleInspector={openFiles}
      onOpenFilesInspector={openFiles}
    />
  );
}
