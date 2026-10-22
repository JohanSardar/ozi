import {
  ORCHESTRATION_V2_WS_METHODS,
  type EnvironmentId,
  type OziJobRequest,
  type ThreadId,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../../connection/runtime";
import { threadEnvironment } from "../../state/threads";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

const readConversation = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Read conversation",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadProjection,
});

export function requireCommand<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}

export function useJobActions(environmentId: EnvironmentId) {
  const read = useAtomCommand(readConversation, { reportFailure: false });
  const approval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const question = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const secret = useAtomCommand(serverEnvironment.answerSecretRequest, {
    reportFailure: false,
    reportDefect: false,
  });
  const interrupt = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  return {
    onStop: async (threadId: ThreadId) => {
      requireCommand(await interrupt({ environmentId, input: { threadId } }));
    },
    onAnswer: async (request: OziJobRequest, value: string) => {
      const projection = requireCommand(
        await read({ environmentId, input: { threadId: request.threadId } }),
      );
      if (request.kind === "secret") {
        const item = projection.turnItems.find(
          (item) => item.type === "secret_request" && String(item.id) === String(request.id),
        );
        if (!item || item.type !== "secret_request" || item.secretStatus !== "pending")
          throw new Error("This request is no longer waiting for an answer.");
        requireCommand(
          await secret({
            environmentId,
            input: {
              threadId: request.threadId,
              turnItemId: item.id,
              answer: { type: "save", secret: value },
            },
          }),
        );
        return;
      }
      const pending = projection.runtimeRequests.find(
        (item) => item.id === request.id && item.status === "pending",
      );
      if (!pending) throw new Error("This request changed. Review the latest update.");
      if (request.kind === "approval") {
        requireCommand(
          await approval({
            environmentId,
            input: {
              threadId: request.threadId,
              requestId: request.id,
              decision: value === "allow" ? "accept" : "decline",
            },
          }),
        );
        return;
      }
      const item = projection.turnItems.find(
        (item) => item.type === "user_input_request" && item.requestId === request.id,
      );
      if (!item || item.type !== "user_input_request" || item.questions.length !== 1)
        throw new Error("Open this job to answer its questions together.");
      requireCommand(
        await question({
          environmentId,
          input: {
            threadId: request.threadId,
            requestId: request.id,
            answers: { [item.questions[0]!.id]: value },
          },
        }),
      );
    },
  };
}
