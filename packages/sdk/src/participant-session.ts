/**
 * A participant session: the participant runtime that shares a model
 * endpoint of this machine with a room, hosted in this process.
 */
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { probeEndpoint } from "@gambi/core/participant/endpoint-capabilities";
import { HarnessCallsNotSupported } from "@gambi/core/participant/harness-not-supported";
import { providerInference } from "@gambi/core/participant/inference";
import { ParticipantRuntime } from "@gambi/core/participant/runtime";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { DEFAULT_HUB_URL } from "./client.ts";
import { withoutUndefined } from "./hosting.ts";
import { makePromiseBoundary } from "./promise.ts";
import {
  joinRoom,
  type SessionControls,
  type SessionOptions,
} from "./session.ts";
import type {
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantSummary,
  RuntimeConfig,
} from "./types.ts";

/**
 * The headers this machine adds to every request to its provider, such as
 * `Authorization` for a hosted backend. They never leave this machine: the
 * hub does not receive them and has no field for them.
 */
export type ParticipantAuthHeaders = Readonly<Record<string, string>>;

/** What a probe found at a provider endpoint. */
export interface ProviderProbe {
  /** Which inference APIs the provider answers. */
  readonly capabilities: ParticipantCapabilities;
  /** The models the provider lists; empty when it lists none or did not answer. */
  readonly models: readonly string[];
  /** Whether a provider answered there as one. */
  readonly reachable: boolean;
}

/**
 * Probes the provider at `endpoint`, from this machine: which models it
 * lists and which inference APIs it answers. It never rejects: a provider
 * that is not there is a probe that found nothing. Each request of the probe
 * waits five seconds at most.
 *
 * @example
 * const probe = await probeProvider("http://127.0.0.1:11434");
 * if (!probe.models.includes("llama3")) {
 *   throw new Error("Pull the model first.");
 * }
 */
export const probeProvider = async (
  endpoint: string,
  authHeaders?: ParticipantAuthHeaders
): Promise<ProviderProbe> => {
  const boundary = makePromiseBoundary(FetchHttpClient.layer, "The probe");
  try {
    return await boundary.run(
      probeEndpoint(withoutUndefined({ endpoint, authHeaders }))
    );
  } finally {
    await boundary.close();
  }
};

export interface ParticipantSessionOptions extends SessionOptions {
  /**
   * `ParticipantAuthHeaders`. They go to the requests this machine makes to
   * its own provider and nowhere else: the hub never sees them.
   */
  readonly authHeaders?: ParticipantAuthHeaders | undefined;
  /**
   * Which inference APIs the provider answers. Default: what a probe of
   * `endpoint` finds when the session starts (`probeProvider`).
   */
  readonly capabilities?: ParticipantCapabilities | undefined;
  /** The defaults this participant applies to requests that leave a field out. */
  readonly config?: RuntimeConfig | undefined;
  /** Where the provider listens, for example `http://127.0.0.1:11434`. */
  readonly endpoint: string;
  /** The model of the provider this participant shares. */
  readonly model: string;
  readonly nickname: string;
  readonly specs?: MachineSpecs | undefined;
}

export interface ParticipantSession extends SessionControls {
  /** The participant as the hub registered it when it joined. */
  readonly participant: ParticipantSummary;
}

/**
 * Joins a room as a participant that shares the model `options.model` of the
 * provider at `options.endpoint`, and resolves once the participant is
 * `online`. It rejects with a `ParticipantError` whose `code` says why the
 * join failed (no such room, a wrong password, another version, no hub), and
 * then nothing is left running.
 *
 * The participant dials the hub and serves inference through that tunnel:
 * the provider never has to be reachable from the hub. After the join the
 * runtime comes back by itself when its tunnel drops; `onLifecycle` follows
 * it.
 *
 * @example
 * const session = await createParticipantSession({
 *   hubUrl: "http://192.168.1.10:3000",
 *   roomCode: "ABC123",
 *   participantId: "arthur-1",
 *   nickname: "Arthur",
 *   model: "llama3",
 *   endpoint: "http://127.0.0.1:11434",
 * });
 * // ...
 * await session.leave();
 */
export const createParticipantSession = async (
  input: ParticipantSessionOptions
): Promise<ParticipantSession> => {
  const options = withoutUndefined(input);
  const hubUrl = options.hubUrl ?? DEFAULT_HUB_URL;
  const provider = withoutUndefined({
    endpoint: options.endpoint,
    authHeaders: options.authHeaders,
  });

  const session = await joinRoom({
    hubUrl,
    roomCode: options.roomCode,
    participantId: options.participantId,
    leaveTimeoutMs: options.leaveTimeoutMs,
    // The hub first, so the room hears one thing: the participant left.
    leaves: "beforeStopping",
    onLifecycle: options.onLifecycle,
    onLog: options.onLog,
    participant: (onLifecycle) =>
      Layer.unwrap(
        Effect.gen(function* () {
          // The probe runs here, on the participant's machine, with its
          // auth headers; only what it found goes up to the hub.
          const capabilities =
            options.capabilities ??
            (yield* probeEndpoint(provider)).capabilities;
          return ParticipantRuntime.layer({
            hubUrl,
            roomCode: options.roomCode,
            participantId: options.participantId,
            password: options.password,
            reconnect: options.reconnect,
            profile: withoutUndefined({
              nickname: options.nickname,
              model: options.model,
              endpoint: options.endpoint,
              specs: options.specs,
              config: options.config,
              capabilities,
            }),
            onLifecycle,
          });
        })
      ).pipe(
        Layer.provide([
          TunnelDiagnostics,
          HarnessCallsNotSupported,
          providerInference(provider),
        ])
      ),
    joined: ParticipantRuntime.use((runtime) =>
      Effect.succeed(runtime.participant)
    ),
  });

  return {
    participant: session.value,
    ended: session.ended,
    leave: session.leave,
    stop: session.stop,
    [Symbol.asyncDispose]: session.leave,
  };
};
