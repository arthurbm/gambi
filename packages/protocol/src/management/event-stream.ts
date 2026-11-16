/**
 * How the management plane streams events: Server-Sent Events, declared in
 * the contract as the `success` of an endpoint.
 *
 *   event: participant.online
 *   data: {"type":"participant.online","roomCode":"ABC123",...}
 *
 * Each event is one JSON object in `data`, and its `type` is repeated on the
 * `event:` line, so `curl -N` and a browser's `EventSource` can tell events
 * apart without parsing. The hub writes a `: keepalive` comment while the
 * stream is quiet.
 *
 * A hub handler of such an endpoint returns a `Stream` of events; the method
 * of the derived client returns the same `Stream`. Nothing else parses SSE:
 * both sides use `effect/encoding/Sse` through the contract.
 */
import { Schema, SchemaTransformation } from "effect";
import { HttpApiSchema } from "effect/http-api";

/** How often the hub writes a comment on a quiet stream, so nothing in between closes it. */
export const EVENT_STREAM_KEEP_ALIVE = "15 seconds";

/**
 * The `success` of an endpoint that streams `event` values over SSE. `event`
 * is a struct with a string `type`, or a union of such structs.
 *
 * @example
 * HttpApiEndpoint.get("watch", "/rooms/:code/events", {
 *   params: { code: RoomCode },
 *   success: eventStream(RoomEvent),
 *   error: failure(RoomNotFound),
 * })
 */
export const eventStream = <Event extends { readonly type: string }, Encoded>(
  event: Schema.Codec<Event, Encoded>
) => {
  const Wire = Schema.Struct({
    id: Schema.optional(Schema.String),
    event: Schema.String,
    data: Schema.fromJsonString(Schema.toCodecJson(event)),
  });
  return HttpApiSchema.StreamSse({
    events: Wire.pipe(
      Schema.decodeTo(
        Schema.toType(event),
        SchemaTransformation.transform({
          decode: (wire) => wire.data,
          encode: (value) => ({ event: value.type, data: value }),
        })
      )
    ),
    keepAlive: EVENT_STREAM_KEEP_ALIVE,
  });
};
