/**
 * A real participant runtime for tests, joined to the hub in the environment
 * (`layerHub` from `./hub.ts`). How to use it:
 * `docs/reference/effect-conventions.md`.
 */
import { Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import { HttpClient } from "effect/http";
import { Socket } from "effect/socket";
import { Hub } from "../hub/hub.ts";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import {
  type ParticipantProfile,
  ParticipantRuntime,
  type ParticipantRuntimeOptions,
  type RegistrationError,
  type TunnelHandlers,
  type TunnelOpenFailed,
} from "../participant/runtime.ts";

export interface TestParticipantOptions
  extends Partial<Omit<ParticipantRuntimeOptions, "profile" | "roomCode">> {
  /**
   * The handlers of the tunnel calls on this participant. Default: the
   * diagnostics every participant has (`TunnelDiagnostics`).
   */
  readonly handlers?: Layer.Layer<TunnelHandlers> | undefined;
  /** Where the runtime's log lines go. Default: nowhere. */
  readonly loggers?: readonly Logger.Logger<unknown, unknown>[] | undefined;
  readonly profile?: Partial<ParticipantProfile> | undefined;
  readonly roomCode: string;
}

export interface TestParticipant {
  /**
   * Kills the participant's side of the tunnel without a closing handshake,
   * which is what the hub sees when the participant's process dies.
   */
  readonly kill: Effect.Effect<void>;
  readonly runtime: ParticipantRuntime["Service"];
  /**
   * Everything this participant sent to the hub so far, as text: each HTTP
   * request (method, URL, headers, body), the URL it dialed and each frame it
   * wrote on the tunnel. For asserting what must never leave the
   * participant's machine, such as `ParticipantAuthHeaders`.
   */
  readonly sentToHub: Effect.Effect<readonly string[]>;
  /**
   * Stops the runtime, which closes its tunnel. The hub notices a moment
   * later: wait for it with `Tunnels.awaitDrop`.
   */
  readonly stop: Effect.Effect<void>;
}

/**
 * Starts a participant runtime against the hub in the environment and returns
 * once the participant is `online`. It stops when the test ends, or earlier
 * with `stop`.
 *
 * @example
 * const participant = yield* joinParticipant({ roomCode: room.code });
 * const tunnel = yield* (yield* Tunnels).client(room.code, participant.runtime.participant.id);
 */
export const joinParticipant = (
  options: TestParticipantOptions
): Effect.Effect<
  TestParticipant,
  RegistrationError | TunnelOpenFailed,
  Hub | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const {
      handlers = TunnelDiagnostics,
      loggers = [],
      profile,
      ...runtimeOptions
    } = options;
    const scope = yield* Scope.fork(yield* Effect.scope);
    const dialed: WebSocket[] = [];
    const sent: string[] = [];
    const decoder = new TextDecoder();
    const asText = (data: unknown) =>
      typeof data === "string"
        ? data
        : decoder.decode(data as Uint8Array<ArrayBuffer>);
    const Dialer = Layer.succeed(
      Socket.WebSocketConstructor,
      (url, options) => {
        const socket = new WebSocket(
          url,
          options as ConstructorParameters<typeof WebSocket>[1]
        );
        sent.push(`DIAL ${url} ${JSON.stringify(options ?? null)}`);
        const send = socket.send.bind(socket);
        socket.send = (data) => {
          sent.push(asText(data));
          return send(data);
        };
        dialed.push(socket);
        return socket;
      }
    );
    const RecordedHttp = Layer.effect(
      HttpClient.HttpClient,
      Effect.map(
        HttpClient.HttpClient,
        HttpClient.mapRequest((request) => {
          const body =
            request.body._tag === "Uint8Array" ? asText(request.body.body) : "";
          sent.push(
            `${request.method} ${request.url} ${JSON.stringify(request.headers)} ${body}`
          );
          return request;
        })
      )
    );
    const context = yield* Layer.buildWithScope(
      ParticipantRuntime.layer({
        hubUrl: hub.url,
        participantId: "participant-1",
        ...runtimeOptions,
        profile: {
          nickname: "Test participant",
          model: "test-model",
          endpoint: "http://127.0.0.1:11434",
          ...profile,
        },
      }).pipe(
        Layer.provide(handlers),
        Layer.provide(Dialer),
        Layer.provide(RecordedHttp),
        Layer.provide(Logger.layer(loggers))
      ),
      scope
    ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
    return {
      kill: Effect.sync(() => {
        for (const socket of dialed) {
          socket.terminate();
        }
      }),
      runtime: Context.get(context, ParticipantRuntime),
      sentToHub: Effect.sync(() => [...sent]),
      stop: Scope.close(scope, Exit.void),
    };
  });
