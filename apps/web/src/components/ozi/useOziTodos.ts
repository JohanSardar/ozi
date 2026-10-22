import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { OZI_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentQuery } from "../../state/query";

const fetchTodos = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "Fetch to-dos",
  tag: OZI_WS_METHODS.todosGet,
  staleTimeMs: 0,
  idleTtlMs: 0,
});

export function useOziTodos(environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(fetchTodos({ environmentId, input: {} }));
  const todos = query.data;
  return {
    todos:
      query.error && todos
        ? { ...todos, state: todos.items === null ? ("unavailable" as const) : ("stale" as const) }
        : todos,
    loading: query.isPending,
    refresh: query.refresh,
  };
}
