// Main SDK entry point - orchestrates all exports

export type * from "@gambi/core/tunnel-protocol";
// HTTP client for remote hubs
export {
  type AttachHarnessOptions,
  ClientError,
  createClient,
  type GambiClient,
  type HarnessChannel,
} from "./client.ts";
// Optional discovery helpers for local-network apps
export {
  type DiscoveredHub,
  type DiscoveredRoom,
  DiscoveryError,
  type DiscoveryOptions,
  discoverHubs,
  discoverRooms,
  type ResolvedGambiTarget,
  type ResolveGambiTargetOptions,
  resolveGambiTarget,
} from "./discovery.ts";
// Harness participants: run a local ACP harness as a room participant
export {
  createFakeHarnessAdapter,
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  defaultWorkspacePath,
  type FakeHarnessCommand,
  getHarnessAdapter,
  type HarnessAdapter,
  HarnessDependencyError,
  type HarnessDetection,
  type HarnessParticipantLifecycleEvent,
  type HarnessParticipantSession,
  type HarnessParticipantSessionCloseEvent,
  type HarnessParticipantSessionOptions,
  type LocalDirectoryWorkspaceOptions,
  type PreparedWorkspace,
  runFakeAcpAgent,
  type SupportedHarnessId,
  type Workspace,
  type WorkspaceArtifactFile,
  type WorkspaceContext,
} from "./harness-participant-session.ts";
// Hub types (re-exported from core)
export type {
  ChatCompletionRequest,
  GambiModel,
  Hub,
  HubOptions,
  ModelsListResponse,
  ResponsesCreateRequest,
} from "./hub.ts";
export { hub } from "./hub.ts";
export {
  createParticipantSession,
  type ParticipantSession,
  type ParticipantSessionCloseEvent,
  type ParticipantSessionOptions,
} from "./participant-session.ts";
export { participants } from "./participants.ts";
// Protocol messages (re-exported from core)
export type * from "./protocol.ts";
export type * from "./protocol-adapters.ts";
export * from "./protocol-adapters.ts";
// Existing AI SDK provider
export {
  createGambi,
  type GambiOptions,
  type GambiProtocol,
  type GambiProtocolNamespace,
  type GambiProvider,
} from "./provider.ts";
// Core namespaces
export { rooms } from "./rooms.ts";
// Types (re-exported from core)
export type * from "./types.ts";
export * from "./types.ts";
// Utilities (re-exported from core)
export * from "./utils.ts";
