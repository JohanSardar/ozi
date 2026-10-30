import { StackActions, useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";
import { resolveThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactNode,
} from "react";

import { copyThreadReference } from "../../lib/copyThreadReference";
import {
  firstWorkspaceDetailOpen,
  workspaceHasColumns,
} from "../workspace/workspace-selection-store";
import { T3KeyboardCommands } from "../../native/T3KeyboardCommands";
import { useThreadShell } from "../../state/entities";
import { CommandPalette } from "./CommandPalette";
import {
  dispatchHardwareKeyboardCommand,
  getHardwareKeyboardCommandRegistrationVersion,
  getRegisteredHardwareKeyboardCommands,
  parseActiveThreadPath,
  subscribeToHardwareKeyboardCommandRegistrations,
  type HardwareKeyboardCommand,
} from "./hardwareKeyboardCommands";
import { selectWorkspaceDetail } from "../workspace/workspace-detail-selection";

const CommandPaletteContext = createContext<ReactNode>(null);

/** Render inside the workspace so palette actions share its navigation and pane state. */
export function HardwareKeyboardCommandOverlay() {
  return use(CommandPaletteContext);
}

export function HardwareKeyboardCommandProvider({
  children,
  pathname,
}: PropsWithChildren<{ readonly pathname: string }>) {
  const navigation = useNavigation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const activeThreadRef = useMemo(() => parseActiveThreadPath(pathname), [pathname]);
  const activeThread = useThreadShell(activeThreadRef);
  const copyTarget = useMemo(
    () =>
      activeThreadRef === null
        ? null
        : resolveThreadReferenceCopyTarget({
            threadRef: activeThreadRef,
            title: activeThread?.title ?? "",
          }),
    [activeThread, activeThreadRef],
  );
  const registrationVersion = useSyncExternalStore(
    subscribeToHardwareKeyboardCommandRegistrations,
    getHardwareKeyboardCommandRegistrationVersion,
    getHardwareKeyboardCommandRegistrationVersion,
  );
  const enabledCommands = useMemo(() => {
    const commands = new Set<HardwareKeyboardCommand>(getRegisteredHardwareKeyboardCommands());
    commands.add("newTask");
    commands.add("commandPalette");
    if (pathname !== "/" && !pathname.startsWith("/threads/")) {
      for (const command of commands) {
        if (command.startsWith("thread.jump.")) commands.delete(command);
      }
    }
    if (pathname !== "/" || navigation.canGoBack()) commands.add("back");
    if (activeThreadRef !== null) {
      commands.add("files");
      commands.add("terminal");
      commands.add("review");
      if (pathname.split("/")[4] !== "terminal") commands.add("copyThreadReference");
    }
    return [...commands];
    // oxlint-disable-next-line react/memo-dependencies -- registrationVersion invalidates the snapshot of the external keyboard-command registry.
  }, [activeThreadRef, pathname, registrationVersion, navigation]);

  const onCommand = useCallback(
    (command: HardwareKeyboardCommand) => {
      if (command === "commandPalette") {
        setPaletteOpen(true);
        return;
      }
      if (dispatchHardwareKeyboardCommand(command)) return;

      if (command === "copyThreadReference") {
        if (copyTarget === null) return;
        void copyThreadReference(copyTarget);
        return;
      }

      if (command === "newTask") {
        navigation.dispatch(selectWorkspaceDetail({ name: "Thread", params: { draft: {} } }));
        return;
      }
      if (command === "back") {
        // Beside a visible list, the first detail page has nothing to go back to.
        if (Platform.OS === "ios" && workspaceHasColumns() && firstWorkspaceDetailOpen(navigation))
          return;
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.dispatch(StackActions.replace("Home"));
        }
        return;
      }

      const thread = parseActiveThreadPath(pathname);
      if (!thread) return;
      if (command === "files" && !/\/files(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadFiles", thread);
      }
      if (command === "terminal" && !/\/terminal(?:\/|$)/.test(pathname)) {
        navigation.navigate("ThreadTerminal", thread);
      }
    },
    [copyTarget, navigation, pathname],
  );

  const palette = useMemo(
    () =>
      paletteOpen ? (
        <CommandPalette pathname={pathname} onClose={closePalette} onCommand={onCommand} />
      ) : null,
    [closePalette, onCommand, paletteOpen, pathname],
  );

  return (
    <CommandPaletteContext value={palette}>
      <T3KeyboardCommands enabledCommands={enabledCommands} onCommand={onCommand}>
        {children}
      </T3KeyboardCommands>
    </CommandPaletteContext>
  );
}
