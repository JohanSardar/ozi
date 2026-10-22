import type { ConnectionHop, SupervisorConnectionState } from "./model.ts";
export type ConnectionHopResult = "ok" | "failed" | "unchecked";
export interface ConnectionDiagnosisHop {
  readonly hop: ConnectionHop;
  readonly label: string;
  readonly result: ConnectionHopResult;
}
export interface ConnectionDiagnosis {
  readonly headline: string;
  readonly hops: ReadonlyArray<ConnectionDiagnosisHop>;
  readonly steps: ReadonlyArray<string>;
  readonly facts: ReadonlyArray<readonly [string, string]>;
}
export interface ConnectionDiagnosisInput {
  readonly hostLabel: string;
  readonly state: SupervisorConnectionState;
  readonly clientVersion?: string;
  readonly serverVersion?: string | null | undefined;
}
export function presentConnectionDiagnosis(
  input: ConnectionDiagnosisInput,
): ConnectionDiagnosis | null {
  const failure = input.state.lastFailure;
  const offline = input.state.network === "offline" || input.state.phase === "offline";
  if (!offline && failure === null) return null;
  const hop = offline ? "device" : (failure?.hop ?? "server");
  const facts: Array<readonly [string, string]> = [
    ["Host", input.hostLabel],
    ["Attempts", String(input.state.attempt)],
  ];
  if (failure?.httpStatus) facts.push(["HTTP status", String(failure.httpStatus)]);
  if (failure?.traceId) facts.push(["Trace", failure.traceId]);
  if (input.clientVersion) facts.push(["Client", input.clientVersion]);
  if (input.serverVersion) facts.push(["Server", input.serverVersion]);
  return {
    headline: offline ? "This device is offline." : failure!.detail,
    hops: [{ hop, label: hop === "device" ? "This device" : input.hostLabel, result: "failed" }],
    steps: [
      offline
        ? "Reconnect to the network."
        : failure?.reason === "authentication"
          ? "Pair with this environment again."
          : "Check the environment address and that its Ozi server is running.",
    ],
    facts,
  };
}
export function connectionDiagnosisText(hostLabel: string, diagnosis: ConnectionDiagnosis): string {
  return [
    hostLabel,
    diagnosis.headline,
    ...diagnosis.steps,
    ...diagnosis.facts.map(([key, value]) => key + ": " + value),
  ].join("\n");
}
