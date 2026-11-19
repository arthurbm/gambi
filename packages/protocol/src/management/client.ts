/**
 * The management client, derived from the contract. It needs an `HttpClient`
 * from the environment: `FetchHttpClient.layer` (from `effect/http`) works in
 * Bun, in Node and in a browser.
 */
import { Context, Effect, type Schema, SchemaIssue } from "effect";
import { HttpClient, type HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { ManagementApi } from "./api.ts";
import { InvalidRequest } from "./errors.ts";

export type ManagementClient = HttpApiClient.ForApi<typeof ManagementApi>;

/**
 * Builds the client for the hub at `baseUrl` (for example
 * `http://127.0.0.1:3000`, without `/v1`).
 *
 * @example
 * const client = yield* makeManagementClient(hub.url);
 * const rooms = yield* client.rooms.list();
 */
export const makeManagementClient = (
  baseUrl: string
): Effect.Effect<ManagementClient, never, HttpClient.HttpClient> =>
  HttpApiClient.make(ManagementApi, {
    baseUrl,
    transformClient: HttpClient.tapRequest(() =>
      Effect.map(RequestProgress, (progress) => {
        if (progress) {
          progress.sent = true;
        }
      })
    ),
  });

const RequestProgress = Context.Reference<{ sent: boolean } | undefined>(
  "gambi/protocol/RequestProgress",
  { defaultValue: () => undefined }
);

/** The derived client raises SchemaError both before sending and while decoding a reply. */
export const withRequestProgress = <A, E, R, F>(
  call: Effect.Effect<A, E, R>,
  classify: (error: E, sent: boolean) => F
) =>
  Effect.suspend(() => {
    const progress = { sent: false };
    return call.pipe(
      Effect.provideService(RequestProgress, progress),
      Effect.mapError((error) => classify(error, progress.sent))
    );
  });

export const isConnectionFailure = ({
  reason,
}: HttpClientError.HttpClientError) =>
  reason._tag === "TransportError" || reason._tag === "InvalidUrlError";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * An input the contract refuses, found before any request was sent. It reads
 * like the `INVALID_REQUEST` a hub would answer, without a status or a
 * request id, and its issue paths start at the input instead of at the part
 * of the request.
 */
export const invalidManagementInput = (
  failure: Schema.SchemaError
): InvalidRequest => {
  const issues = formatIssues(failure.issue).issues.map((issue) => ({
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === "object" ? segment.key : segment;
      return typeof key === "number" ? key : String(key);
    }),
    message: issue.message,
  }));
  return new InvalidRequest({ issues });
};
