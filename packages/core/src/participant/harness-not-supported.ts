/**
 * The handlers of the harness tunnel calls for a participant that has no
 * harness: one that shares a model endpoint. Each call answers
 * `CallNotSupported`. Every host of such a participant runtime provides this
 * layer next to the handlers of its own calls; a harness participant provides
 * the real ones instead (`../harness/tunnel-handlers.ts`).
 */
import { CallNotSupported, TunnelRpcs } from "@gambi/protocol";
import { Effect, Layer, Stream } from "effect";

export const HarnessCallsNotSupported = Layer.mergeAll(
  TunnelRpcs.toLayerHandler("HarnessEvents", () =>
    Stream.fail(new CallNotSupported({ call: "HarnessEvents" }))
  ),
  TunnelRpcs.toLayerHandler("HarnessSend", () =>
    Effect.fail(new CallNotSupported({ call: "HarnessSend" }))
  ),
  TunnelRpcs.toLayerHandler("HarnessOpenSession", () =>
    Effect.fail(new CallNotSupported({ call: "HarnessOpenSession" }))
  ),
  TunnelRpcs.toLayerHandler("HarnessCloseSession", () =>
    Effect.fail(new CallNotSupported({ call: "HarnessCloseSession" }))
  )
);
