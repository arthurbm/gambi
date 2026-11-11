/**
 * The handlers of the diagnostic tunnel calls (`Echo`, `Ticks`). They do the
 * same on every participant, so every host of a participant runtime provides
 * this layer next to the handlers of its own calls.
 */
import { TunnelRpcs } from "@gambi/protocol";
import { Effect, Layer, Stream } from "effect";

export const TunnelDiagnostics = Layer.mergeAll(
  TunnelRpcs.toLayerHandler("Echo", ({ text }) => Effect.succeed(text)),
  TunnelRpcs.toLayerHandler("Ticks", ({ count }) =>
    count <= 0 ? Stream.empty : Stream.range(0, count - 1)
  )
);
