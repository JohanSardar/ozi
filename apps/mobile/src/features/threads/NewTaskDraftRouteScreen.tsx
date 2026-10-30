import type { StaticScreenProps } from "@react-navigation/native";
import { NewTaskDraftScreen } from "./NewTaskDraftScreen";
import type { NewTaskDraftRouteParams } from "./thread-route-state";
export type { NewTaskDraftRouteParams } from "./thread-route-state";

export function NewTaskDraftRouteScreen({ route }: StaticScreenProps<NewTaskDraftRouteParams>) {
  const params = route.params ?? {};
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return (
    <NewTaskDraftScreen
      initialProjectRef={{
        environmentId: first(params.environmentId),
        projectId: first(params.projectId),
        workingDirectory: params.workingDirectory,
      }}
      incomingShareId={first(params.incomingShareId)}
      draftId={first(params.draftId)}
    />
  );
}
