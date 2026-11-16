/**
 * A participant hosted in this process, behind a `Promise` boundary: the
 * participant runtime that shares a model endpoint of this machine with a
 * room.
 *
 * Like `./hub.ts`, this is the edge between React and Effect (ADR-0007): the
 * one `ManagedRuntime` of a hosted participant lives here and nothing of
 * Effect leaves this file. It stands where the participant entry of
 * `gambi-sdk` will (#125); until then it builds on what `@gambi/core` exposes.
 */
import { BunSocket } from "@effect/platform-bun";
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { probeEndpoint } from "@gambi/core/participant/endpoint-capabilities";
import { HarnessCallsNotSupported } from "@gambi/core/participant/harness-not-supported";
import { providerInference } from "@gambi/core/participant/inference";
import {
  type ParticipantLifecycleEvent,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import { Cause, Effect, Exit, Layer, Logger, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import type {
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantSummary,
  RuntimeConfig,
} from "gambi-sdk";
import { definedFields, hubClient } from "../hub-client";

export type { ParticipantLifecycleEvent } from "@gambi/core/participant/runtime";

/**
 * The headers this machine adds to every request to its provider, such as
 * `Authorization` for a hosted backend. They never leave this machine.
 */
export type ParticipantAuthHeaders = Readonly<Record<string, string>>;

/** What a probe found at a provider endpoint. */
export interface ProviderProbe {
  /** Which inference APIs the provider answers. Goes up with the registration. */
  readonly capabilities: ParticipantCapabilities;
  /** The models the provider lists; empty when it lists none or did not answer. */
  readonly models: readonly string[];
  /** Whether a provider answered there as one. */
  readonly reachable: boolean;
}

/**
 * Probes the provider at `endpoint`, from this machine: which models it
 * lists and which inference APIs it answers. It never rejects: a provider
 * that is not there is a probe that found nothing.
 */
export const probeProvider = (
  endpoint: string,
  authHeaders?: ParticipantAuthHeaders
): Promise<ProviderProbe> =>
  Effect.runPromise(
    probeEndpoint({ endpoint, authHeaders }).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  );

export interface HostParticipantOptions {
  /**
   * `ParticipantAuthHeaders`. They go to the handler that calls the provider
   * and nowhere else: the runtime, and so the hub, never sees them.
   */
  readonly authHeaders?: ParticipantAuthHeaders | undefined;
  readonly capabilities?: ParticipantCapabilities | undefined;
  readonly config?: RuntimeConfig | undefined;
  /** Where the provider listens, for example `http://127.0.0.1:11434`. */
  readonly endpoint: string;
  readonly hubUrl: string;
  readonly model: string;
  readonly nickname: string;
  /**
   * Called with each step of the runtime's life after the join: it lost the
   * hub and is trying again, it is back, it ended.
   */
  readonly onLifecycle?:
    | ((event: ParticipantLifecycleEvent) => void)
    | undefined;
  /** The stable id of this participant. Reuse it to come back as the same one. */
  readonly participantId: string;
  /** The room password, when the room has one. */
  readonly password?: string | undefined;
  readonly roomCode: string;
  readonly specs?: MachineSpecs | undefined;
}

export interface HostedParticipant {
  /**
   * Leaves the room: takes the participant out of it at once and stops the
   * runtime. It never rejects and never waits long for a hub that is gone.
   */
  readonly leave: () => Promise<void>;
  /** The participant as the hub registered it when it joined. */
  readonly participant: ParticipantSummary;
  /**
   * Releases a runtime that ended by itself (`onLifecycle` said `left`),
   * without telling the hub anything: the participant with this id in the
   * room, if there is one, is no longer this runtime.
   */
  readonly stop: () => Promise<void>;
}

/** How long leaving waits for the hub to answer before it gives up on telling it. */
const LEAVE_TIMEOUT_MS = 3000;

/**
 * Joins a room and resolves once the participant is `online`. It rejects
 * with an `Error` whose message says why the join failed (no such room, a
 * wrong password, another version, no hub), and then nothing is left running.
 *
 * After the join the runtime comes back by itself when its tunnel drops;
 * `onLifecycle` follows it.
 */
export const hostParticipant = async (
  options: HostParticipantOptions
): Promise<HostedParticipant> => {
  // After `leave` started, what the runtime reports is our own doing.
  let leaving = false;
  const handlers = Layer.mergeAll(
    TunnelDiagnostics,
    HarnessCallsNotSupported,
    providerInference({
      endpoint: options.endpoint,
      authHeaders: options.authHeaders,
    })
  );
  const runtime = ManagedRuntime.make(
    ParticipantRuntime.layer({
      hubUrl: options.hubUrl,
      roomCode: options.roomCode,
      participantId: options.participantId,
      password: options.password,
      // A field that is present must have a value: the registration refuses
      // `undefined`.
      profile: definedFields({
        nickname: options.nickname,
        model: options.model,
        endpoint: options.endpoint,
        specs: options.specs,
        config: options.config,
        capabilities: options.capabilities,
      }),
      onLifecycle: (event) =>
        Effect.sync(() => {
          if (!leaving) {
            options.onLifecycle?.(event);
          }
        }),
    }).pipe(
      Layer.provide(handlers),
      Layer.provide(BunSocket.layerWebSocketConstructor),
      Layer.provide(FetchHttpClient.layer),
      // The terminal belongs to the TUI: the runtime's log lines go nowhere.
      Layer.provide(Logger.layer([]))
    )
  );
  const joined = await runtime.runPromiseExit(
    ParticipantRuntime.use((participant) =>
      Effect.succeed(participant.participant)
    )
  );
  if (Exit.isFailure(joined)) {
    await runtime.dispose();
    throw Cause.squash(joined.cause);
  }

  let left: Promise<void> | undefined;
  const leave = async () => {
    leaving = true;
    // The hub first, so the room hears one thing: the participant left.
    // Stopping the runtime first would show it `offline` in between.
    const gaveUp = Promise.withResolvers<void>();
    const timer = setTimeout(gaveUp.resolve, LEAVE_TIMEOUT_MS);
    await Promise.race([
      hubClient(options.hubUrl)
        .participants.remove(options.roomCode, options.participantId)
        .catch(() => undefined),
      gaveUp.promise,
    ]);
    // A pending timer would keep the process alive after the TUI quits.
    clearTimeout(timer);
    await runtime.dispose();
  };

  return {
    participant: joined.value,
    leave: () => {
      left ??= leave();
      return left;
    },
    stop: () => {
      leaving = true;
      left ??= runtime.dispose();
      return left;
    },
  };
};
