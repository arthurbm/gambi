import { HarnessTools, resolveHarness } from "@gambi/core/harness/detection";
import { Harness } from "@gambi/core/harness/harness";
import { harnessParticipant } from "@gambi/core/harness/harness-participant";
import { ParticipantRuntime } from "@gambi/core/participant/runtime";
import { Effect, Layer } from "effect";
import { DEFAULT_HUB_URL } from "./client.ts";
import { type FakeAgentCommand, ownFakeAgentCommand } from "./fake-harness.ts";
import { withoutUndefined } from "./input.ts";
import { ParticipantError } from "./participant-error.ts";
import { joinRoom } from "./session.ts";
import type { SessionControls, SessionOptions } from "./session-types.ts";
import type {
  MachineSpecs,
  ParticipantSummary,
  RuntimeConfig,
} from "./types.ts";
import {
  createLocalDirectoryWorkspace,
  type HostedHarnessId,
  type Workspace,
} from "./workspace.ts";
import { workspaceLayer } from "./workspace-layer.ts";

/** Why an artifact was taken: the Workspace changed and then stayed still, or the participant was closing. */
export type ArtifactReason = "watch" | "final";

/** An artifact went up, with this version; `bytes` is its size as it travels. */
export interface ArtifactSent {
  readonly bytes: number;
  readonly fileCount: number;
  readonly reason: ArtifactReason;
  readonly sessionId: string;
  readonly type: "artifactSent";
  readonly version: number;
}

/** No artifact went up, and no version was taken: the Workspace does not fit in one. */
export interface ArtifactTooLarge {
  readonly cause: "tooLarge";
  readonly maxBytes: number;
  readonly reason: ArtifactReason;
  readonly sessionId: string;
  readonly type: "artifactSkipped";
}

/** No artifact went up, and no version was taken: the files could not be read. */
export interface ArtifactCollectFailed {
  readonly cause: "collectFailed";
  readonly reason: ArtifactReason;
  readonly sessionId: string;
  readonly type: "artifactSkipped";
}

/**
 * What happened to an artifact of the Workspace, in order. Plain JSON: print
 * an event as it is.
 */
export type ArtifactLifecycleEvent =
  | ArtifactSent
  | ArtifactTooLarge
  | ArtifactCollectFailed;

export interface ArtifactsOptions {
  /**
   * How long closing waits for the hub to read the last artifact, in
   * milliseconds. Default 2 seconds. Nothing is waited for when the tunnel
   * is down.
   */
  readonly finalTimeoutMs?: number | undefined;
  /** The largest artifact that is sent, in bytes. Default, and at most, `MAX_ARTIFACT_BYTES`. */
  readonly maxBytes?: number | undefined;
  /**
   * How long the Workspace must stay still, after a change, before an
   * artifact is taken, in milliseconds. Default 1 second.
   */
  readonly settleTimeMs?: number | undefined;
}

export interface HarnessParticipantSessionOptions extends SessionOptions {
  readonly artifacts?: ArtifactsOptions | undefined;
  /** The defaults this participant shows in the room. */
  readonly config?: RuntimeConfig | undefined;
  /**
   * The command that runs `runFakeAcpAgent()`, for the `fake` harness.
   * Default: this package's own file, run with Bun. A program that bundles
   * the SDK into its own file passes one, for example
   * `{ command: "bun", args: ["scripts/fake-acp-agent.ts"] }`.
   */
  readonly fakeAgentCommand?: FakeAgentCommand | undefined;
  /** The harness to run. It must be installed and logged in on this machine. */
  readonly harness: HostedHarnessId;
  /**
   * How long the harness has to exit after SIGTERM before it, and everything
   * it started, is killed, in milliseconds. Default 2 seconds.
   */
  readonly harnessStopTimeoutMs?: number | undefined;
  /** `true` when this program runs the harness for someone who brought none. */
  readonly hosted?: boolean | undefined;
  /** The model the harness runs on, when there is one to say. */
  readonly model?: string | undefined;
  readonly nickname: string;
  /**
   * Called with what happened to each artifact of the Workspace, in order.
   * The artifacts wait for it: keep it quick.
   */
  readonly onArtifact?: ((event: ArtifactLifecycleEvent) => void) | undefined;
  readonly specs?: MachineSpecs | undefined;
  /**
   * Where the harness runs. Default: `createLocalDirectoryWorkspace()`, the
   * folder `~/.gambi/workspaces/<roomCode>/<participantId>/`.
   */
  readonly workspace?: Workspace | undefined;
}

/** What is known of a harness process that exited on its own. */
export interface HarnessExit {
  /** The end of what the harness wrote to its stderr. */
  readonly detail?: string;
  readonly exitCode?: number;
  readonly message: string;
}

/** The harness a session runs. */
export interface HostedHarness {
  /**
   * Resolves when the harness process exits on its own. It never resolves
   * for a harness this program stopped, and never rejects. The participant
   * stays in the room when its harness exits: leaving is up to the host.
   */
  readonly exited: Promise<HarnessExit>;
  readonly id: HostedHarnessId;
  /** What always applies to this harness, such as its terms of use. */
  readonly notes: readonly string[];
  /** The process id of the harness. */
  readonly pid: number;
  /**
   * The id of the harness session the runtime opened at start. The artifacts
   * of the Workspace carry it.
   */
  readonly sessionId: string;
  /** Set when detection could not confirm something and let the harness start anyway. */
  readonly warning?: string;
  /** The absolute path of the Workspace the harness runs in. */
  readonly workspacePath: string;
}

export interface HarnessParticipantSession extends SessionControls {
  readonly harness: HostedHarness;
  /** The participant as the hub registered it when it joined. */
  readonly participant: ParticipantSummary;
}

/** A promise that never settles: what `exited` is for a harness that was stopped. */
const never = new Promise<never>(() => undefined);

/**
 * Joins a room as a harness participant and resolves once the participant is
 * `online`: the harness is running in its Workspace and a management client
 * can attach to it (`client.harness` of `gambi-sdk`).
 *
 * It rejects with a `ParticipantError` whose `code` says why: the harness is
 * not installed or not logged in (`HARNESS_NOT_READY`, with what to do in
 * the message), it did not start or did not speak ACP v1, the Workspace
 * could not be prepared, or the join was refused. Then nothing is left
 * running, the harness process included.
 *
 * Leaving sends a last artifact of the Workspace, closes the tunnel, stops
 * the harness and everything it started, and takes the participant out of
 * the room.
 *
 * @example
 * const session = await createHarnessParticipantSession({
 *   hubUrl: "http://192.168.1.10:3000",
 *   roomCode: "ABC123",
 *   participantId: "frevo-bot",
 *   nickname: "Frevo bot",
 *   harness: "fake",
 * });
 * // ...
 * await session.leave();
 */
export const createHarnessParticipantSession = async (
  input: HarnessParticipantSessionOptions
): Promise<HarnessParticipantSession> => {
  const options = withoutUndefined(input);
  const hubUrl = options.hubUrl ?? DEFAULT_HUB_URL;
  const { harness: id, participantId, roomCode } = options;
  const model = options.model ?? id;
  const workspace = options.workspace ?? createLocalDirectoryWorkspace();
  let notes: readonly string[] = [];
  let warning: string | undefined;

  const session = await joinRoom({
    hubUrl,
    roomCode,
    participantId,
    leaveTimeoutMs: options.leaveTimeoutMs,
    // The runtime first: its last artifact goes up through the tunnel, which
    // taking the participant out of the room would close.
    leaves: "afterStopping",
    onLifecycle: options.onLifecycle,
    onLog: options.onLog,
    participant: (onLifecycle) =>
      Layer.unwrap(
        Effect.gen(function* () {
          const fake = options.fakeAgentCommand ?? ownFakeAgentCommand();
          if (id === "fake" && fake === undefined) {
            return yield* Effect.fail(
              new ParticipantError({
                code: "HARNESS_NOT_READY",
                details: { harness: id, problem: "notInstalled" },
                message:
                  "The fake harness cannot find its agent from inside a bundled program. Pass `fakeAgentCommand`: a command that runs `runFakeAcpAgent()` of gambi-sdk/participant.",
              })
            );
          }
          const resolved = yield* resolveHarness(
            id,
            withoutUndefined({ fake, hosted: options.hosted })
          ).pipe(Effect.provide(HarnessTools.layer));
          notes = resolved.notes;
          warning = resolved.warning;
          const onArtifact = options.onArtifact;
          return harnessParticipant({
            runtime: {
              hubUrl,
              roomCode,
              participantId,
              password: options.password,
              reconnect: options.reconnect,
              profile: withoutUndefined({
                nickname: options.nickname,
                model,
                harness: withoutUndefined({
                  id,
                  model: options.model,
                  hosted: options.hosted,
                }),
                specs: options.specs,
                config: options.config,
              }),
              onLifecycle,
            },
            harness: {
              command: resolved.command,
              stopTimeout: options.harnessStopTimeoutMs,
            },
            artifacts: {
              finalTimeout: options.artifacts?.finalTimeoutMs,
              maxBytes: options.artifacts?.maxBytes,
              settleTime: options.artifacts?.settleTimeMs,
              onArtifact:
                onArtifact === undefined
                  ? undefined
                  : (event) =>
                      Effect.sync(() => onArtifact(event)).pipe(
                        Effect.catchCause((cause) =>
                          Effect.logError(
                            "The onArtifact callback threw.",
                            cause
                          )
                        )
                      ),
            },
          }).pipe(
            Layer.provide(
              workspaceLayer(workspace, {
                harness: id,
                model,
                participantId,
                roomCode,
              })
            )
          );
        })
      ),
    joined: Effect.gen(function* () {
      const runtime = yield* ParticipantRuntime;
      const harness = yield* Harness;
      return {
        participant: runtime.participant,
        pid: harness.pid,
        sessionId: harness.sessionId,
        workspacePath: harness.workspacePath,
      };
    }),
  });

  const { participant, pid, sessionId, workspacePath } = session.value;
  const exited = session.boundary
    .run(Harness.use((harness) => harness.exited))
    .then(
      (failure): HarnessExit => ({
        message: failure.message,
        ...(failure.detail === undefined ? {} : { detail: failure.detail }),
        ...(failure.exitCode === undefined
          ? {}
          : { exitCode: failure.exitCode }),
      }),
      // The session was closed first: this program stopped the harness.
      () => never
    );

  return {
    participant,
    harness: {
      id,
      pid,
      sessionId,
      workspacePath,
      notes,
      ...(warning === undefined ? {} : { warning }),
      exited,
    },
    ended: session.ended,
    leave: session.leave,
    stop: session.stop,
    [Symbol.asyncDispose]: session.leave,
  };
};
