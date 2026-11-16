/**
 * The harness of a harness participant (ADR-0006), on the participant's
 * machine: the subprocess, the ACP v1 session the runtime opens in it, and the
 * relay of ACP messages in both directions.
 *
 * `Harness.layer` starts the harness and owns its process. The process lives
 * exactly as long as the layer: releasing the layer, for any reason, stops
 * the harness, and stopping never waits without a limit.
 *
 * The harness runs in a process group of its own (`detached`). Why:
 *
 * - Stopping signals the whole group, so what the harness started (tools,
 *   shells, MCP servers) stops with it. In the runtime's group, only the
 *   harness itself would be signalled and the rest would be left behind.
 * - A Ctrl+C in the terminal reaches the participant runtime alone. The
 *   runtime then stops the harness, in one order, for every way of stopping
 *   (Ctrl+C, SIGTERM, a failure): whatever must happen before the harness
 *   dies, such as sending a last artifact, has a place to happen.
 *
 * The cost: nothing stops the harness when the runtime itself is killed with
 * SIGKILL, because no finalizer runs. A harness that reads ACP from its stdin
 * still ends then, when its stdin closes.
 *
 * The runtime types the three ACP calls it makes itself (`./acp.ts`). It
 * reads nothing else: it only swaps the session id, between the one the hub
 * and its clients know and the one the harness gave.
 */
import {
  type AcpMessage,
  GAMBI_VERSION,
  type HarnessEvent,
  HarnessFailed,
  HarnessSessionNotOpen,
  HarnessSessionOutsideWorkspace,
} from "@gambi/protocol";
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Path,
  Predicate,
  Queue,
  Random,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  ACP_VERSION,
  type AcpCall,
  CloseSession,
  Initialize,
  JsonLine,
  JsonRpcAnswer,
  NewSession,
} from "./acp.ts";
import type { HarnessCommand } from "./adapters.ts";

/** How long a stopping harness has before it is killed. */
export const DEFAULT_HARNESS_STOP_TIMEOUT: Duration.Input = "2 seconds";
/** How long the harness has to answer an ACP call the runtime made. */
export const DEFAULT_HARNESS_REQUEST_TIMEOUT: Duration.Input = "10 seconds";
/** How many events wait for the hub while the tunnel is down. */
export const DEFAULT_HARNESS_OUTBOX = 4096;

const STDERR_TAIL_LENGTH = 4000;
/** How long an exited harness has to finish what it was writing. */
const OUTPUT_DRAIN_TIMEOUT = Duration.seconds(1);

export interface HarnessOptions {
  /** How to start the harness: `resolveHarness` in `./detection.ts` finds it. */
  readonly command: HarnessCommand;
  /**
   * How many events the runtime keeps for the hub while nobody reads them
   * (the tunnel is down). Past that the oldest leave. Default 4096.
   */
  readonly outbox?: number | undefined;
  /** How long the harness has to answer `initialize`, `session/new` and `session/close`. Default 10 seconds. */
  readonly requestTimeout?: Duration.Input | undefined;
  /** The id of the session the runtime opens at start. Default: a random one. */
  readonly sessionId?: string | undefined;
  /**
   * How long the harness has to exit after SIGTERM before it, and everything
   * it started, is killed. Default 2 seconds.
   */
  readonly stopTimeout?: Duration.Input | undefined;
  /**
   * The folder the harness runs in, on this machine. Every session stays
   * inside it. It must exist.
   */
  readonly workspacePath: string;
}

/** The harness process could not be started at all. */
export class HarnessStartFailed extends Schema.TaggedError<HarnessStartFailed>()(
  "HarnessStartFailed",
  { harness: Schema.String, command: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Failed to start ${this.harness}: could not run '${this.command}'.`;
  }
}

const keyOf = (id: unknown): string | undefined =>
  Predicate.isString(id) || Predicate.isNumber(id)
    ? `${typeof id}:${id}`
    : undefined;

/** The session id an ACP message names in its params, when it names one. */
const sessionIdIn = (message: AcpMessage): string | undefined =>
  Predicate.isObject(message.params) &&
  Predicate.hasProperty(message.params, "sessionId") &&
  Predicate.isString(message.params.sessionId)
    ? message.params.sessionId
    : undefined;

/** The message, addressed to another session id. */
const withSessionId = (message: AcpMessage, sessionId: string): AcpMessage =>
  Predicate.isObject(message.params) &&
  Predicate.hasProperty(message.params, "sessionId")
    ? { ...message, params: { ...message.params, sessionId } }
    : message;

export class Harness extends Context.Service<
  Harness,
  {
    /**
     * Closes a harness session. One that is not open is already closed.
     * Says `closed` in `events`.
     */
    readonly closeSession: (
      sessionId: string
    ) => Effect.Effect<void, HarnessFailed>;
    /**
     * What the harness produced that the hub has not read yet: ACP messages
     * and the status of its sessions, in order. This is what goes up through
     * the tunnel's `HarnessEvents` call. One reader at a time; what is
     * produced while nobody reads waits here (`HarnessOptions.outbox`).
     */
    readonly events: Stream.Stream<HarnessEvent>;
    /**
     * Completes when the harness process exits on its own, with what is known
     * about it. It never completes for a harness the runtime stopped.
     */
    readonly exited: Effect.Effect<HarnessFailed>;
    /**
     * Opens a harness session under an id the caller picks, in `cwd` (default:
     * the Workspace). One that is already open stays as it is. Says `opened`
     * in `events`.
     */
    readonly openSession: (
      sessionId: string,
      cwd?: string
    ) => Effect.Effect<void, HarnessSessionOutsideWorkspace | HarnessFailed>;
    /** The process id of the harness. */
    readonly pid: number;
    /**
     * Puts an event in `events`, after everything already there. It is how
     * something that is born on the participant and is not an ACP message of
     * the harness goes up to the hub: a new member of `HarnessEvent`, such as
     * an artifact of the Workspace, is published here. It never waits.
     */
    readonly publish: (event: HarnessEvent) => Effect.Effect<void>;
    /**
     * Writes one ACP message to the harness, for one of its open sessions.
     * The answer, if the harness gives one, comes in `events`.
     */
    readonly send: (
      sessionId: string,
      message: AcpMessage
    ) => Effect.Effect<void, HarnessSessionNotOpen | HarnessFailed>;
    /** The session the runtime opened at start. */
    readonly sessionId: string;
    readonly workspacePath: string;
  }
>()("gambi/core/Harness") {
  /**
   * A running harness: started, on ACP v1, with one session open in the
   * Workspace. Building the layer fails when any of that fails, and leaves no
   * process behind. Releasing the layer stops the harness.
   */
  static readonly layer = (
    options: HarnessOptions
  ): Layer.Layer<
    Harness,
    HarnessStartFailed | HarnessFailed,
    ChildProcessSpawner.ChildProcessSpawner | Path.Path
  > =>
    Layer.effect(
      Harness,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const path = yield* Path.Path;
        const { command, workspacePath } = options;
        const requestTimeout = Duration.fromInputUnsafe(
          options.requestTimeout ?? DEFAULT_HARNESS_REQUEST_TIMEOUT
        );
        const workspaceRoot = path.resolve(workspacePath);
        const initialId =
          options.sessionId ??
          `session-${Math.abs(yield* Random.nextInt).toString(36)}${Math.abs(yield* Random.nextInt).toString(36)}`;

        const outbox = yield* Queue.sliding<HarnessEvent>(
          options.outbox ?? DEFAULT_HARNESS_OUTBOX
        );
        const stdin = yield* Queue.unbounded<string>();
        const exited = yield* Deferred.make<HarnessFailed>();
        /** The runtime's own calls that the harness has not answered yet. */
        const pending = new Map<
          string,
          Deferred.Deferred<AcpMessage, HarnessFailed>
        >();
        /** Session ids: the one the hub knows to the harness's, and back. */
        const innerOf = new Map<string, string>();
        const outerOf = new Map<string, string>();
        /** Which session each request of a client came from, by request id. */
        const sessionOfRequest = new Map<string, string>();
        let stderrTail = "";
        let gone: HarnessFailed | undefined;
        let requests = 0;

        const emit = (event: HarnessEvent) =>
          Effect.asVoid(Queue.offer(outbox, event));
        const write = (message: AcpMessage) =>
          Effect.asVoid(Queue.offer(stdin, `${JSON.stringify(message)}\n`));

        const handle = yield* spawner
          .spawn(
            ChildProcess.make(command.command, [...command.args], {
              cwd: workspacePath,
              stdin: {
                stream: Stream.fromQueue(stdin).pipe(Stream.encodeText),
              },
              stdout: "pipe",
              stderr: "pipe",
              // A process group of its own: see the top of this file.
              detached: true,
              forceKillAfter:
                options.stopTimeout ?? DEFAULT_HARNESS_STOP_TIMEOUT,
            })
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new HarnessStartFailed({
                  harness: command.harness,
                  command: command.command,
                  cause,
                })
            )
          );
        yield* Effect.logInfo("harness started").pipe(
          Effect.annotateLogs({ harness: command.harness, pid: handle.pid })
        );

        /**
         * Whose message this is: the session it names, else the session whose
         * request it answers, else the one the runtime opened.
         */
        const sessionOf = (message: AcpMessage, key: string | undefined) => {
          const inner = sessionIdIn(message);
          const named = inner === undefined ? undefined : outerOf.get(inner);
          const asked =
            key === undefined ? undefined : sessionOfRequest.get(key);
          if (key !== undefined && message.method === undefined) {
            sessionOfRequest.delete(key);
          }
          return named ?? asked ?? initialId;
        };

        const decodeLine = Schema.decodeUnknownOption(JsonLine);
        const onLine = Effect.fnUntraced(function* (line: string) {
          const parsed = decodeLine(line);
          if (Option.isNone(parsed)) {
            return;
          }
          const message = parsed.value;
          const key = keyOf(message.id);
          const answered = key === undefined ? undefined : pending.get(key);
          if (key !== undefined && answered !== undefined) {
            pending.delete(key);
            yield* Deferred.succeed(answered, message);
            return;
          }
          const sessionId = sessionOf(message, key);
          yield* emit({
            type: "harness.message",
            sessionId,
            message: withSessionId(message, sessionId),
          });
        });

        const stdout = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach(onLine),
          Effect.ignore,
          Effect.forkScoped
        );
        const stderr = yield* handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((text) =>
            Effect.sync(() => {
              stderrTail = `${stderrTail}${text}`.slice(-STDERR_TAIL_LENGTH);
            })
          ),
          Effect.ignore,
          Effect.forkScoped
        );

        // The harness exiting on its own. When the runtime stops it instead,
        // this fiber is interrupted before the process is signalled.
        yield* handle.exitCode.pipe(
          Effect.match({
            onSuccess: (code): number | undefined => Number(code),
            // Killed by a signal: there is no exit code.
            onFailure: () => undefined,
          }),
          Effect.flatMap(
            Effect.fnUntraced(function* (exitCode) {
              // What it wrote last is read first, so the last messages go up
              // before the news that it exited.
              yield* Fiber.await(stdout).pipe(
                Effect.timeoutOption(OUTPUT_DRAIN_TIMEOUT)
              );
              yield* Fiber.await(stderr).pipe(
                Effect.timeoutOption(OUTPUT_DRAIN_TIMEOUT)
              );
              const detail = stderrTail.trim();
              const failure = new HarnessFailed({
                reason: "exited",
                ...(exitCode === undefined ? {} : { exitCode }),
                ...(detail === "" ? {} : { detail }),
              });
              gone = failure;
              yield* Effect.logWarning("harness exited").pipe(
                Effect.annotateLogs({ harness: command.harness, exitCode })
              );
              for (const waiting of pending.values()) {
                yield* Deferred.fail(waiting, failure);
              }
              pending.clear();
              for (const sessionId of innerOf.keys()) {
                yield* emit({
                  type: "harness.session",
                  sessionId,
                  status: "error",
                  message: failure.message,
                });
              }
              innerOf.clear();
              outerOf.clear();
              sessionOfRequest.clear();
              yield* Deferred.succeed(exited, failure);
            })
          ),
          Effect.forkScoped
        );

        /** One of the three ACP calls the runtime makes itself. */
        const request = Effect.fnUntraced(function* <
          Params extends Schema.Top,
          Result extends Schema.Codec<unknown, unknown>,
        >(call: AcpCall<Params, Result>, params: Params["Type"]) {
          if (gone !== undefined) {
            return yield* gone;
          }
          const { method } = call;
          const id = `gambi:${method}:${++requests}`;
          const key = `string:${id}`;
          const answer = yield* Deferred.make<AcpMessage, HarnessFailed>();
          pending.set(key, answer);
          yield* write({ jsonrpc: "2.0", id, method, params });
          const message = yield* Deferred.await(answer).pipe(
            Effect.timeoutOrElse({
              duration: requestTimeout,
              orElse: () =>
                Effect.fail(new HarnessFailed({ reason: "timedOut", method })),
            }),
            Effect.ensuring(Effect.sync(() => pending.delete(key)))
          );
          const invalid = () =>
            new HarnessFailed({ reason: "invalidAnswer", method });
          const { error, result } = yield* Schema.decodeUnknownEffect(
            JsonRpcAnswer
          )(message).pipe(Effect.mapError(invalid));
          if (error !== undefined) {
            return yield* new HarnessFailed({
              reason: "rejected",
              method,
              ...(error.message === undefined ? {} : { detail: error.message }),
            });
          }
          return yield* Schema.decodeUnknownEffect(call.result)(result).pipe(
            Effect.mapError(invalid)
          ) as Effect.Effect<Result["Type"], HarnessFailed>;
        });

        // One session opens or closes at a time. Two clients that open the
        // same id together would otherwise both find it closed and open two
        // sessions in the harness, one of which nobody could close.
        const oneAtATime = Semaphore.withPermit(yield* Semaphore.make(1));

        const openSession = Effect.fn("Harness.openSession")(function* (
          sessionId: string,
          cwd?: string
        ) {
          if (innerOf.has(sessionId)) {
            return;
          }
          const resolved = path.resolve(workspaceRoot, cwd ?? workspaceRoot);
          if (
            resolved !== workspaceRoot &&
            !resolved.startsWith(`${workspaceRoot}${path.sep}`)
          ) {
            return yield* new HarnessSessionOutsideWorkspace({ sessionId });
          }
          const opened = yield* request(NewSession, {
            cwd: resolved,
            mcpServers: [],
          });
          innerOf.set(sessionId, opened.sessionId);
          outerOf.set(opened.sessionId, sessionId);
          yield* emit({ type: "harness.session", sessionId, status: "opened" });
          yield* Effect.logInfo("harness session opened").pipe(
            Effect.annotateLogs({ sessionId })
          );
        }, oneAtATime);

        const closeSession = Effect.fn("Harness.closeSession")(function* (
          sessionId: string
        ) {
          const inner = innerOf.get(sessionId);
          if (inner === undefined) {
            return;
          }
          yield* request(CloseSession, { sessionId: inner });
          innerOf.delete(sessionId);
          outerOf.delete(inner);
          yield* emit({ type: "harness.session", sessionId, status: "closed" });
        }, oneAtATime);

        const send = Effect.fn("Harness.send")(function* (
          sessionId: string,
          message: AcpMessage
        ) {
          if (gone !== undefined) {
            return yield* gone;
          }
          const inner = innerOf.get(sessionId);
          if (inner === undefined) {
            return yield* new HarnessSessionNotOpen({ sessionId });
          }
          const key = keyOf(message.id);
          if (key !== undefined && Predicate.isString(message.method)) {
            sessionOfRequest.set(key, sessionId);
          }
          yield* write(withSessionId(message, inner));
        });

        const negotiated = yield* request(Initialize, {
          protocolVersion: ACP_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "gambi", version: GAMBI_VERSION },
        });
        if (negotiated.protocolVersion !== ACP_VERSION) {
          return yield* new HarnessFailed({
            reason: "versionNotNegotiated",
            method: Initialize.method,
          });
        }
        yield* openSession(initialId).pipe(
          Effect.catchTag("HarnessSessionOutsideWorkspace", Effect.die)
        );

        return Harness.of({
          closeSession,
          events: Stream.fromQueue(outbox),
          exited: Deferred.await(exited),
          openSession,
          pid: Number(handle.pid),
          publish: emit,
          send,
          sessionId: initialId,
          workspacePath: workspaceRoot,
        });
      })
    );
}
