/**
 * The typed errors of the tunnel calls: what a participant runtime answers
 * when it cannot serve a call. They travel inside the tunnel; the hub turns
 * them into the error of the plane the request came from.
 */
import { Schema } from "effect";

/**
 * The participant does not serve this call: an inference call sent to a
 * harness participant, or a harness call sent to a participant that shares a
 * model endpoint. A call lists it as its `error` and the runtime of the other
 * kind of participant answers the call with it.
 */
export class CallNotSupported extends Schema.TaggedError<CallNotSupported>()(
  "CallNotSupported",
  { call: Schema.String }
) {
  override get message(): string {
    return `This participant does not serve the '${this.call}' tunnel call.`;
  }
}

/**
 * The participant runtime got no response from its provider: nothing listens
 * at the endpoint, or the request failed before the response started. The
 * cause stays in the participant runtime's log; it never crosses the tunnel.
 */
export class ProviderUnreachable extends Schema.TaggedError<ProviderUnreachable>()(
  "ProviderUnreachable",
  {}
) {
  override get message(): string {
    return "The participant's provider did not answer the request.";
  }
}

/** The provider started to answer and its response broke before the end. */
export class ProviderResponseInterrupted extends Schema.TaggedError<ProviderResponseInterrupted>()(
  "ProviderResponseInterrupted",
  {}
) {
  override get message(): string {
    return "The participant's provider stopped answering in the middle of the response.";
  }
}
