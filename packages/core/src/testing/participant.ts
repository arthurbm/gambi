/**
 * A real participant runtime for tests, joined to the hub in the environment
 * (`layerHub` from `./hub.ts`). How to use it:
 * `docs/reference/effect-conventions.md`.
 */
import { Context, Effect, Exit, Layer, Logger, Queue, Scope } from "effect";
import { HttpClient } from "effect/http";
import { Socket } from "effect/socket";
import { Hub } from "../hub/hub.ts";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import { HarnessCallsNotSupported } from "../participant/harness-not-supported.ts";
import {
  InferenceNotServed,
  type ProviderOptions,
  providerInference,
} from "../participant/inference.ts";
import {
  type ParticipantLifecycleEvent,
  type ParticipantProfile,
  ParticipantRuntime,
  type ParticipantRuntimeOptions,
  type RegistrationError,
  type TunnelHandlers,
  type TunnelOpenFailed,
} from "../participant/runtime.ts";

export interface TestParticipantOptions<
  Handlers extends TunnelHandlers = TunnelHandlers,
> extends Partial<Omit<ParticipantRuntimeOptions, "profile" | "roomCode">> {
  /**
   * Handlers of tunnel calls on this participant, to replace the default of
   * a call. The calls it leaves out keep their default: the diagnostics
   * every participant has (`TunnelDiagnostics`), "not supported" for the
   * harness calls (`HarnessCallsNotSupported`), and inference answered by
   * `provider` when there is one, refused otherwise (`InferenceNotServed`).
   * So a test passes only the calls it cares about and keeps compiling when
   * the tunnel gains a call.
   */
  readonly handlers?: Layer.Layer<Handlers> | undefined;
  /** Where the runtime's log lines go. Default: nowhere. */
  readonly loggers?: readonly Logger.Logger<unknown, unknown>[] | undefined;
  readonly profile?: Partial<ParticipantProfile> | undefined;
  /**
   * The local provider this participant shares, usually a `fakeProvider`
   * (`./provider.ts`): inference calls go to it. Its `authHeaders` are known
   * to the handler alone, as in a real host of the runtime.
   */
  readonly provider?: ProviderOptions | undefined;
  /**
   * Whether the runtime comes back by itself when its tunnel drops. Default
   * `false` here, unlike the runtime's own default: a test that kills a
   * participant expects it to stay dead.
   */
  readonly reconnect?: boolean | undefined;
  readonly roomCode: string;
}

/**
 * The handlers of a participant that serves nothing of its own: the
 * diagnostics every participant has, and "not supported" for inference and
 * for the harness calls. For a test that builds a runtime by hand
 * (`openTunnel`); `joinParticipant` has the same defaults.
 */
export const defaultHandlers: Layer.Layer<TunnelHandlers> = Layer.mergeAll(
  TunnelDiagnostics,
  InferenceNotServed,
  HarnessCallsNotSupported
);

export interface TestParticipant {
  /**
   * Waits until what the participant sent to the hub satisfies `seen`. It is
   * checked again on every request and frame, so a test waits for a frame
   * instead of sleeping.
   */
  readonly awaitSent: (
    seen: (sent: readonly string[]) => boolean
  ) => Effect.Effect<void>;
  /**
   * Kills the participant's side of the tunnel without a closing handshake,
   * which is what the hub sees when the participant's process dies.
   */
  readonly kill: Effect.Effect<void>;
  /** Every lifecycle event of the runtime so far, from `connected` on. */
  readonly lifecycleEvents: Effect.Effect<readonly ParticipantLifecycleEvent[]>;
  /**
   * The next lifecycle event of the runtime that the test has not read yet
   * with this. Waits for one when there is none.
   */
  readonly nextLifecycleEvent: Effect.Effect<ParticipantLifecycleEvent>;
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
export const joinParticipant = <Handlers extends TunnelHandlers = never>(
  options: TestParticipantOptions<Handlers>
): Effect.Effect<
  TestParticipant,
  RegistrationError | TunnelOpenFailed,
  Hub | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const {
      handlers,
      loggers = [],
      onLifecycle,
      profile,
      provider,
      reconnect = false,
      ...runtimeOptions
    } = options;
    // The handler calls the provider with the client of the environment, not
    // with the recorded one: only what goes to the hub is `sentToHub`.
    const providerClient = yield* HttpClient.HttpClient;
    // One default per call, so a runtime started without a capability still
    // answers every call. A ticket that adds calls to `TunnelRpcs` adds their
    // "not served" handlers to this list and to `defaultHandlers`.
    const defaults: Layer.Layer<TunnelHandlers> = Layer.mergeAll(
      TunnelDiagnostics,
      HarnessCallsNotSupported,
      provider === undefined
        ? InferenceNotServed
        : providerInference(provider).pipe(
            Layer.provide(Layer.succeed(HttpClient.HttpClient, providerClient))
          )
    );
    const lifecycle = yield* Queue.unbounded<ParticipantLifecycleEvent>();
    const lifecycleEvents: ParticipantLifecycleEvent[] = [];
    const scope = yield* Scope.fork(yield* Effect.scope);
    const dialed: WebSocket[] = [];
    const sent: string[] = [];
    const watchers = new Set<() => void>();
    const record = (entry: string) => {
      sent.push(entry);
      for (const watcher of [...watchers]) {
        watcher();
      }
    };
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
        record(`DIAL ${url} ${JSON.stringify(options ?? null)}`);
        const send = socket.send.bind(socket);
        socket.send = (data) => {
          record(asText(data));
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
          record(
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
        onLifecycle: (event) => {
          lifecycleEvents.push(event);
          return Queue.offer(lifecycle, event).pipe(
            Effect.andThen(onLifecycle?.(event) ?? Effect.void)
          );
        },
        reconnect,
        profile: {
          nickname: "Test participant",
          model: "test-model",
          endpoint: provider?.endpoint ?? "http://127.0.0.1:11434",
          ...profile,
        },
      }).pipe(
        // The last layer merged wins.
        Layer.provide(
          handlers === undefined ? defaults : Layer.merge(defaults, handlers)
        ),
        Layer.provide(Dialer),
        Layer.provide(RecordedHttp),
        Layer.provide(Logger.layer(loggers))
      ),
      scope
    ).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
    return {
      awaitSent: (seen) =>
        Effect.callback<void>((resume) => {
          const check = () => {
            if (seen(sent)) {
              watchers.delete(check);
              resume(Effect.void);
            }
          };
          watchers.add(check);
          check();
          return Effect.sync(() => watchers.delete(check));
        }),
      kill: Effect.sync(() => {
        for (const socket of dialed) {
          socket.terminate();
        }
      }),
      lifecycleEvents: Effect.sync(() => [...lifecycleEvents]),
      nextLifecycleEvent: Queue.take(lifecycle),
      runtime: Context.get(context, ParticipantRuntime),
      sentToHub: Effect.sync(() => [...sent]),
      stop: Scope.close(scope, Exit.void),
    };
  });
