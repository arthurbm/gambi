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
 * reads nothing else of ACP. Of each message it relays it touches the
 * envelope only: the session id (the one the hub and its clients know, for
 * the one the harness gave) and the JSON-RPC id of a client's request (one of
 * its own, so the requests of several clients never share an id).
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
  Array as Arr,
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

/**
 * Every request the runtime writes to the harness carries an id the runtime
 * made, under this prefix: its own three calls and the requests of the
 * clients alike. The harness then sees one client with ids that never repeat,
 * whatever each attached client numbers its own requests.
 */
const REQUEST_ID_PREFIX = "gambi:";

/** The id of a JSON-RPC message, when it has one. */
const idOf = (message: AcpMessage): string | number | undefined =>
  Predicate.isString(message.id) || Predicate.isNumber(message.id)
    ? message.id
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
     * Waits while what was produced so far is on its way to the hub. It
     * completes when the hub has read all of it, and also when it cannot get
     * there: at once when nobody reads `events` (the tunnel is down), and
     * when the reader goes away. It is how the last thing a participant has
     * to say is given the time to leave before the tunnel closes; put a
     * timeout on it, since a hub may stop reading without going away.
     */
    readonly flushed: Effect.Effect<void>;
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

        // What waits for the hub, numbered in the order it was produced.
        const outbox = yield* Queue.sliding<{
          readonly event: HarnessEvent;
          readonly number: number;
        }>(options.outbox ?? DEFAULT_HARNESS_OUTBOX);
        /** The number of the last event produced. */
        let produced = 0;
        /** Every event up to this number is with the hub, or lost. */
        let passed = 0;
        /** How many readers `events` has now: one while a tunnel is open. */
        let readers = 0;
        const flushing = new Set<{
          readonly upTo: number;
          readonly done: () => void;
        }>();
        const pass = (upTo: number) => {
          passed = Math.max(passed, upTo);
          for (const waiter of [...flushing]) {
            if (waiter.upTo <= passed || readers === 0) {
              flushing.delete(waiter);
              waiter.done();
            }
          }
        };
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
        /**
         * The requests of clients the harness has not answered yet, by the id
         * the runtime gave them: the session each came from, and the id its
         * client gave it, to put back on the answer.
         */
        const clientRequests = new Map<
          string,
          { readonly id: string | number; readonly sessionId: string }
        >();
        let stderrTail = "";
        let gone: HarnessFailed | undefined;
        let requests = 0;

        const emit = (event: HarnessEvent) =>
          Effect.suspend(() =>
            Effect.asVoid(Queue.offer(outbox, { event, number: ++produced }))
          );
        // The reader pulls one batch at a time, and the tunnel's stream call
        // pulls the next only after the hub acknowledged the one before
        // (`effect/rpc` waits for the `Ack` of each chunk). So a reader that
        // asks for more has delivered everything it took.
        const events: Stream.Stream<HarnessEvent> = Stream.suspend(() => {
          let taken = 0;
          readers++;
          return Stream.fromEffectRepeat(
            Effect.suspend(() => {
              pass(taken);
              return Queue.takeAll(outbox);
            })
          ).pipe(
            Stream.map((batch) => {
              taken = Arr.lastNonEmpty(batch).number;
              return Arr.map(batch, (entry) => entry.event);
            }),
            Stream.flattenArray,
            // A reader that goes away took what it took with it: whether or
            // not the hub got its last batch, nothing of it is on its way.
            Stream.ensuring(
              Effect.sync(() => {
                readers--;
                pass(taken);
              })
            )
          );
        });
        const flushed = Effect.callback<void>((resume) => {
          if (produced <= passed || readers === 0) {
            resume(Effect.void);
            return;
          }
          const waiter = { upTo: produced, done: () => resume(Effect.void) };
          flushing.add(waiter);
          return Effect.sync(() => flushing.delete(waiter));
        });
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

        const decodeLine = Schema.decodeUnknownOption(JsonLine);
        const onLine = Effect.fnUntraced(function* (line: string) {
          const parsed = decodeLine(line);
          if (Option.isNone(parsed)) {
            return;
          }
          const message = parsed.value;
          const id = idOf(message);
          // An answer to a request the runtime wrote, by the id it gave.
          if (
            Predicate.isString(id) &&
            id.startsWith(REQUEST_ID_PREFIX) &&
            message.method === undefined
          ) {
            const answered = pending.get(id);
            if (answered !== undefined) {
              pending.delete(id);
              yield* Deferred.succeed(answered, message);
              return;
            }
            const asked = clientRequests.get(id);
            if (asked !== undefined) {
              clientRequests.delete(id);
              yield* emit({
                type: "harness.message",
                sessionId: asked.sessionId,
                message: withSessionId(
                  { ...message, id: asked.id },
                  asked.sessionId
                ),
              });
            }
            // Otherwise nobody waits for it any more (it came after its
            // timeout, or its session closed): it is not a client's to read.
            return;
          }
          // Anything else the harness says is for the session it names, or
          // for the one the runtime opened.
          const inner = sessionIdIn(message);
          const sessionId =
            (inner === undefined ? undefined : outerOf.get(inner)) ?? initialId;
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
              clientRequests.clear();
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
          const id = `${REQUEST_ID_PREFIX}${method}:${++requests}`;
          const answer = yield* Deferred.make<AcpMessage, HarnessFailed>();
          pending.set(id, answer);
          yield* write({ jsonrpc: "2.0", id, method, params });
          const message = yield* Deferred.await(answer).pipe(
            Effect.timeoutOrElse({
              duration: requestTimeout,
              orElse: () =>
                Effect.fail(new HarnessFailed({ reason: "timedOut", method })),
            }),
            Effect.ensuring(Effect.sync(() => pending.delete(id)))
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

        // How a session opens and closes:
        //
        // - One at a time. Two clients that open the same id together would
        //   otherwise both find it closed and open two sessions in the
        //   harness, one of which nobody could close.
        // - To the end, whoever asked. The caller may go away halfway (its
        //   tunnel dropped) after the harness got the request; the harness
        //   opens the session all the same, and the runtime has to know it.
        //   So the work runs in a fiber of the harness, and the caller only
        //   waits for it.
        const lifetime = yield* Effect.scope;
        const permit = Semaphore.withPermit(yield* Semaphore.make(1));
        const toTheEnd = <A, E>(work: Effect.Effect<A, E>) =>
          work.pipe(
            permit,
            Effect.forkIn(lifetime),
            Effect.flatMap(Fiber.join)
          );

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
        }, toTheEnd);

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
          // What the session still waited for has nobody to go to.
          for (const [id, asked] of clientRequests) {
            if (asked.sessionId === sessionId) {
              clientRequests.delete(id);
            }
          }
          yield* emit({ type: "harness.session", sessionId, status: "closed" });
        }, toTheEnd);

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
          // A request gets an id of the runtime's: two clients may well use
          // the same one, each for its own session.
          const id = idOf(message);
          if (id === undefined || !Predicate.isString(message.method)) {
            yield* write(withSessionId(message, inner));
            return;
          }
          const own = `${REQUEST_ID_PREFIX}request:${++requests}`;
          clientRequests.set(own, { id, sessionId });
          yield* write(withSessionId({ ...message, id: own }, inner));
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
          events,
          exited: Deferred.await(exited),
          flushed,
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
