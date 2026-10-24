export { runFakeAcpAgent } from "@gambi/core/fake-acp-agent";
export type {
  FakeHarnessCommand,
  HarnessAdapter,
  HarnessDetection,
  SupportedHarnessId,
} from "@gambi/core/harness-adapters";
export {
  createFakeHarnessAdapter,
  getHarnessAdapter,
} from "@gambi/core/harness-adapters";
export type {
  HarnessParticipantLifecycleEvent,
  HarnessParticipantSession,
  HarnessParticipantSessionCloseEvent,
  HarnessParticipantSessionOptions,
} from "@gambi/core/harness-participant-session";
export {
  createHarnessParticipantSession,
  HarnessDependencyError,
} from "@gambi/core/harness-participant-session";
export type {
  LocalDirectoryWorkspaceOptions,
  PreparedWorkspace,
  Workspace,
  WorkspaceArtifactFile,
  WorkspaceContext,
} from "@gambi/core/harness-workspace";
export {
  createLocalDirectoryWorkspace,
  defaultWorkspacePath,
} from "@gambi/core/harness-workspace";
