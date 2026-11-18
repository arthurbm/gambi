/**
 * One line per public type of the hosting entries that mirrors a type of the
 * runtime it hosts. When the runtime changes, the line of the type that fell
 * behind stops compiling. (`./contract.ts` does the same for the management
 * contract.)
 *
 * Internal: nothing imports this file; the type check reads it.
 */
import type { ArtifactLifecycleEvent as RuntimeArtifactEvent } from "@gambi/core/harness/artifacts";
import type { SupportedHarnessId } from "@gambi/core/harness/detection";
import type { EndpointProbe } from "@gambi/core/participant/endpoint-capabilities";
import type { ParticipantLifecycleEvent as RuntimeLifecycleEvent } from "@gambi/core/participant/runtime";
import type { ArtifactFile as ContractArtifactFile } from "@gambi/protocol";
import type { Assert, Same } from "./contract.ts";
import type { ArtifactLifecycleEvent } from "./harness-participant-session.ts";
import type { ProviderProbe } from "./participant-session.ts";
import type { ParticipantLifecycleEvent } from "./session-types.ts";
import type { ArtifactFile } from "./types.ts";
import type { HostedHarnessId } from "./workspace.ts";

export type HostingProofs = [
  Assert<Same<ParticipantLifecycleEvent, RuntimeLifecycleEvent>>,
  Assert<Same<ArtifactLifecycleEvent, RuntimeArtifactEvent>>,
  Assert<Same<ArtifactFile, ContractArtifactFile>>,
  Assert<Same<HostedHarnessId, SupportedHarnessId>>,
  Assert<Same<ProviderProbe, EndpointProbe>>,
];
