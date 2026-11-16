/**
 * The tunnel handlers of a harness participant: what the hub's harness calls
 * do on the participant's machine. Each one hands the call to the `Harness`
 * in the environment.
 *
 * A host of a harness participant provides `HarnessParticipantHandlers` to
 * its participant runtime, and a `Harness.layer` under it:
 *
 *   ParticipantRuntime.layer(options).pipe(
 *     Layer.provide(HarnessParticipantHandlers),
 *     Layer.provideMerge(Harness.layer({ command, workspacePath }))
 *   )
 *
 * The harness is built first and released last: it is running before the
 * participant registers, and it outlives every tunnel of the runtime. What it
 * produces while the tunnel is down waits in the harness and goes up when the
 * hub opens `HarnessEvents` on the next tunnel.
 */
import { TunnelRpcs } from "@gambi/protocol";
import { Effect, Layer, Stream } from "effect";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import { InferenceNotServed } from "../participant/inference.ts";
import type { TunnelHandlers } from "../participant/runtime.ts";
import { Harness } from "./harness.ts";

/** The handlers of the four harness calls of the tunnel. */
export const HarnessTunnelHandlers = Layer.mergeAll(
  TunnelRpcs.toLayerHandler("HarnessEvents", () =>
    Stream.unwrap(Effect.map(Harness, (harness) => harness.events))
  ),
  TunnelRpcs.toLayerHandler("HarnessSend", ({ sessionId, message }) =>
    Effect.flatMap(Harness, (harness) => harness.send(sessionId, message))
  ),
  TunnelRpcs.toLayerHandler("HarnessOpenSession", ({ sessionId, cwd }) =>
    Effect.flatMap(Harness, (harness) => harness.openSession(sessionId, cwd))
  ),
  TunnelRpcs.toLayerHandler("HarnessCloseSession", ({ sessionId }) =>
    Effect.flatMap(Harness, (harness) => harness.closeSession(sessionId))
  )
);

/**
 * Every tunnel handler a harness participant serves: the harness calls, the
 * diagnostics every participant has, and "not supported" for the calls of the
 * other kinds of participant. A ticket that adds a call to the tunnel adds
 * its handler for a harness participant here; the type below fails until it
 * does.
 */
export const HarnessParticipantHandlers: Layer.Layer<
  TunnelHandlers,
  never,
  Harness
> = Layer.mergeAll(
  TunnelDiagnostics,
  InferenceNotServed,
  HarnessTunnelHandlers
);
