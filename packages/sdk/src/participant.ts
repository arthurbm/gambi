/**
 * `gambi-sdk/participant`: a participant hosted in this process, in
 * `Promise`.
 *
 * **Bun only.** A participant runtime dials the hub's WebSocket and, for a
 * harness participant, runs a subprocess and watches a folder, all through
 * Bun's platform. This entry does not load in Node. The default entry
 * (`gambi-sdk`) stays free of it: importing that one never loads this one.
 *
 * It exports functions, one error class and types. No schema value and no
 * Effect type leaves this package.
 */
// First, so that Node hears why this entry does not load there.
import "./bun-only.ts";

export {
  type FakeAgentCommand,
  runFakeAcpAgent,
} from "./fake-harness.ts";
export {
  type ArtifactCollectFailed,
  type ArtifactLifecycleEvent,
  type ArtifactReason,
  type ArtifactSent,
  type ArtifactsOptions,
  type ArtifactTooLarge,
  createHarnessParticipantSession,
  type HarnessExit,
  type HarnessParticipantSession,
  type HarnessParticipantSessionOptions,
  type HostedHarness,
} from "./harness-participant-session.ts";
export type { LogEntry } from "./log.ts";
export {
  ParticipantError,
  type ParticipantErrorCode,
} from "./participant-error.ts";
export {
  createParticipantSession,
  type ParticipantAuthHeaders,
  type ParticipantSession,
  type ParticipantSessionOptions,
  type ProviderProbe,
  probeProvider,
} from "./participant-session.ts";
export type {
  ParticipantConnected,
  ParticipantLeft,
  ParticipantLifecycleEvent,
  ParticipantReconnecting,
  ParticipantSessionEnd,
  ReconnectReason,
  SessionControls,
  SessionOptions,
} from "./session-types.ts";
export type {
  ArtifactFile,
  GenerationConfig,
  HarnessId,
  HarnessProfile,
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantStatus,
  ParticipantSummary,
  ProtocolSupport,
  RuntimeConfig,
  RuntimeConfigPublic,
} from "./types.ts";
export {
  createLocalDirectoryWorkspace,
  type HostedHarnessId,
  type LocalDirectoryWorkspaceOptions,
  MAX_ARTIFACT_BYTES,
  type PreparedWorkspace,
  type Workspace,
  type WorkspaceContext,
} from "./workspace.ts";
