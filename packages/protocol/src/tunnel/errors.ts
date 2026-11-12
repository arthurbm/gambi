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
