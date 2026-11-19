/**
 * The management plane envelope. Every response of the contract is one of:
 *
 *   success  { "data": ..., "meta": { "requestId": "..." } }
 *   error    { "error": { "code", "message", "hint"?, "details" }, "meta": { "requestId": "..." } }
 *
 * The envelope is a wire format only. `success` and `failure` build schemas
 * whose decoded side is the plain value (or the error instance) and whose
 * encoded side is the envelope, so hub handlers return domain values and fail
 * with typed errors, and the derived client hands the same values back.
 */
import { Context, Effect, Schema, SchemaTransformation } from "effect";
import { HttpApiSchema } from "effect/http-api";

/**
 * The id of the management request being answered. Encoding an envelope reads
 * it, so the hub provides one per request; decoding never needs it.
 */
export class RequestId extends Context.Service<RequestId, string>()(
  "gambi/protocol/RequestId"
) {}

export const Meta = Schema.Struct({ requestId: Schema.String });
export type Meta = typeof Meta.Type;

/** The success envelope as it travels, for a value encoded as `E`. */
export interface SuccessEnvelope<E> {
  readonly data: E;
  readonly meta: Meta;
}

/** Wraps the schema of a success value in the success envelope. */
export const success = <S extends Schema.Top>(
  data: S
): Schema.Codec<
  S["Type"],
  SuccessEnvelope<S["Encoded"]>,
  S["DecodingServices"],
  S["EncodingServices"] | RequestId
> => {
  const Wire = Schema.Struct({ data: Schema.Unknown, meta: Meta });
  const Envelope = Schema.Struct({
    data,
    meta: Meta,
  }) as unknown as Schema.Codec<typeof Wire.Type>;
  return Envelope.pipe(
    Schema.decodeTo(
      Schema.toType(data as unknown as Schema.Codec<unknown>),
      SchemaTransformation.transformEffect({
        decode: (envelope: typeof Wire.Type) => Effect.succeed(envelope.data),
        encode: (value: unknown) =>
          RequestId.useSync((requestId): typeof Wire.Type => ({
            data: value,
            meta: { requestId },
          })),
      })
    )
  ) as never;
};

/**
 * What a management error class declares besides its fields: the stable
 * `code` that travels in the envelope and the HTTP status of the response.
 * Declare both as `static readonly` on the `Schema.TaggedError` class.
 */
export interface ManagementErrorClass<Self extends ManagementError> {
  new (props: never): Self;
  readonly code: string;
  readonly fields: Schema.Struct.Fields;
  readonly status: number;
}

/** What every management error instance carries. */
export interface ManagementError {
  readonly _tag: string;
  /** What the caller can do about it. Built from the fields, like `message`. */
  readonly hint?: string | undefined;
  readonly message: string;
  /** Set on the client, from the envelope the hub sent. */
  readonly requestId?: string | undefined;
}

/** The field every management error class spreads into its own fields. */
export const requestIdField = { requestId: Schema.optional(Schema.String) };

/**
 * Wraps a management error class in the error envelope and sets its HTTP
 * status. The fields of the class travel in `error.details`; `message` and
 * `hint` are rebuilt from them on the client.
 */
export const failure = <Self extends ManagementError>(
  errorClass: ManagementErrorClass<Self>
): Schema.Codec<Self, unknown, never, RequestId> => {
  const { _tag, requestId, ...detailFields } = errorClass.fields;
  const Wire = Schema.Struct({
    error: Schema.Struct({
      code: Schema.Literal(errorClass.code),
      message: Schema.String,
      hint: Schema.optionalKey(Schema.String),
      details: Schema.Struct(detailFields),
    }),
    meta: Meta,
  });
  const detailKeys = Object.keys(detailFields);
  const Instance = Schema.toType(errorClass as unknown as Schema.Codec<Self>);
  return Wire.pipe(
    Schema.decodeTo(
      Instance,
      SchemaTransformation.transformEffect({
        decode: (wire: typeof Wire.Type) =>
          Effect.succeed(
            new errorClass({
              ...wire.error.details,
              requestId: wire.meta.requestId,
            } as never)
          ),
        encode: (error: Self) =>
          RequestId.useSync((id): typeof Wire.Type => ({
            error: {
              code: errorClass.code,
              message: error.message,
              ...(error.hint === undefined ? {} : { hint: error.hint }),
              details: Object.fromEntries(
                detailKeys.map((key) => [
                  key,
                  (error as unknown as Record<string, unknown>)[key],
                ])
              ),
            },
            meta: { requestId: id },
          })),
      })
    ),
    HttpApiSchema.status(errorClass.status)
  ) as unknown as Schema.Codec<Self, unknown, never, RequestId>;
};
