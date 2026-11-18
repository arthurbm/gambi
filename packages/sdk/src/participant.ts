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
export type { LogEntry } from "./hosting.ts";
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
} from "./session.ts";
export type {
  GenerationConfig,
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantStatus,
  ParticipantSummary,
  ProtocolSupport,
  RuntimeConfig,
  RuntimeConfigPublic,
} from "./types.ts";
