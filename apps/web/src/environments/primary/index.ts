export {
  createServerPairingCredential,
  peekPairingTokenFromUrl,
  PrimaryEnvironmentPairingCredentialRejectedError,
  PrimaryEnvironmentRequestError,
  resolveInitialServerAuthGateState,
  revokeOtherServerClientSessions,
  revokeServerClientSession,
  revokeServerPairingLink,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
  type ServerClientSessionRecord,
  type ServerPairingLinkRecord,
} from "./auth";

export { usePrimarySessionState } from "./sessionState";

export {
  DesktopEnvironmentBootstrapIncompleteError,
  PrimaryEnvironmentProtocolUnsupportedError,
  PrimaryEnvironmentUrlInvalidError,
  isLoopbackHostname,
  type PrimaryEnvironmentTarget,
} from "./target";
