/**
 * A harness participant, whole: the harness running in the Workspace, the
 * participant in the room serving the harness calls of its tunnel, and the
 * artifacts of the Workspace going up.
 *
 * The three are layers, and their order is what this file is for:
 *
 * 1. The harness is built first and released last. It is running before the
 *    participant registers, and it outlives every tunnel of the runtime.
 * 2. The participant runtime comes next: it serves the tunnel calls with the
 *    harness.
 * 3. The artifacts come last and are released first: the last artifact is
 *    taken and sent while the tunnel is still open and the harness is still
 *    running.
 *
 * The Workspace comes from the environment, already prepared: whoever hosts
 * decides where the harness runs (`Workspace.layerLocalDirectory`, or a
 * Workspace of their own).
 */
import type { HarnessFailed } from "@gambi/protocol";
import { Effect, Layer, type Path } from "effect";
import type { HttpClient } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";
import type { Socket } from "effect/socket";
import {
  ParticipantRuntime,
  type ParticipantRuntimeOptions,
  type RegistrationError,
  type TunnelOpenFailed,
} from "../participant/runtime.ts";
import { type ArtifactsOptions, workspaceArtifacts } from "./artifacts.ts";
import {
  Harness,
  type HarnessOptions,
  type HarnessStartFailed,
} from "./harness.ts";
import { HarnessParticipantHandlers } from "./tunnel-handlers.ts";
import { Workspace } from "./workspace.ts";

export interface HarnessParticipantOptions {
  readonly artifacts?: ArtifactsOptions | undefined;
  /** The harness to run. It runs in the Workspace of the environment. */
  readonly harness: Omit<HarnessOptions, "workspacePath">;
  /** The participant in the room. Its `profile.harness` says which harness it contributes. */
  readonly runtime: ParticipantRuntimeOptions;
}

/**
 * A harness participant in a room, for as long as the layer lives. Building
 * it returns when the participant is `online`; it fails when the harness does
 * not start or the join fails, and leaves no process behind. Releasing it
 * sends a last artifact, closes the tunnel and stops the harness, in that
 * order.
 */
export const harnessParticipant = (
  options: HarnessParticipantOptions
): Layer.Layer<
  ParticipantRuntime | Harness,
  RegistrationError | TunnelOpenFailed | HarnessStartFailed | HarnessFailed,
  | Workspace
  | HttpClient.HttpClient
  | Socket.WebSocketConstructor
  | ChildProcessSpawner.ChildProcessSpawner
  | Path.Path
> =>
  workspaceArtifacts(options.artifacts).pipe(
    Layer.provideMerge(
      ParticipantRuntime.layer(options.runtime).pipe(
        Layer.provide(HarnessParticipantHandlers)
      )
    ),
    Layer.provideMerge(
      Layer.unwrap(
        Effect.map(Workspace, (workspace) =>
          Harness.layer({ ...options.harness, workspacePath: workspace.path })
        )
      )
    )
  );
