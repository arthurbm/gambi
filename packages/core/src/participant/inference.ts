/**
 * The handlers of the inference tunnel call (`Infer`), one per kind of
 * participant:
 *
 * - `providerInference`: a participant that shares a model endpoint. It sends
 *   the request to its local provider and streams the response back.
 * - `InferenceNotServed`: a participant that serves no inference (a harness
 *   participant). It answers the call with `CallNotSupported`.
 *
 * Whoever hosts a participant runtime provides one of them, next to
 * `TunnelDiagnostics`.
 *
 * `ParticipantAuthHeaders` live here and nowhere else: they are an option of
 * `providerInference`, applied to the request to the provider. The runtime
 * never receives them, and what crosses the tunnel is only what the provider
 * answered.
 */
import {
  CallNotSupported,
  type InferenceChunk,
  type InferenceOperation,
  type InferenceRequest,
  ProviderResponseInterrupted,
  ProviderUnreachable,
  TunnelRpcs,
} from "@gambi/protocol";
import { Effect, identity, type Layer, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { Rpc } from "effect/rpc";

/**
 * The headers a participant runtime adds to every request to its provider,
 * such as `Authorization` for a hosted backend. They never leave the
 * participant's machine.
 */
export type ParticipantAuthHeaders = Readonly<Record<string, string>>;

export interface ProviderOptions {
  readonly authHeaders?: ParticipantAuthHeaders | undefined;
  /** Where the provider listens, for example `http://127.0.0.1:11434`. */
  readonly endpoint: string;
}

/**
 * The provider route of each operation: its method and its path, which for
 * an operation on a stored Response carries the id of the Response. A new
 * operation of `Infer` gets a row here.
 */
const PROVIDER_ROUTES: Record<
  InferenceOperation,
  {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: (responseId: string) => string;
  }
> = {
  "chatCompletions.create": {
    method: "POST",
    path: () => "/v1/chat/completions",
  },
  "responses.create": { method: "POST", path: () => "/v1/responses" },
  "responses.retrieve": {
    method: "GET",
    path: (responseId) => `/v1/responses/${responseId}`,
  },
  "responses.delete": {
    method: "DELETE",
    path: (responseId) => `/v1/responses/${responseId}`,
  },
  "responses.cancel": {
    method: "POST",
    path: (responseId) => `/v1/responses/${responseId}/cancel`,
  },
  "responses.inputItems.list": {
    method: "GET",
    path: (responseId) => `/v1/responses/${responseId}/input_items`,
  },
};

/**
 * The path and query of the provider route a request goes to. The id of a
 * Response is one segment of the path, whatever characters it has.
 */
const providerPath = (request: InferenceRequest): string => {
  const route = PROVIDER_ROUTES[request.operation];
  if (!("responseId" in request)) {
    return route.path("");
  }
  const query =
    request.query === undefined || request.query === ""
      ? ""
      : `?${request.query}`;
  return `${route.path(encodeURIComponent(request.responseId))}${query}`;
};

const TRAILING_SLASHES = /\/+$/;

/**
 * Serves `Infer` by calling the local provider. The response comes back as it
 * is: the status, the content type and the body, piece by piece as the
 * provider flushes it. A status that is not 2xx is an answer like any other;
 * only a provider that does not answer, or stops in the middle, is an error.
 *
 * The request to the provider lives in the fiber of the call: when the hub
 * interrupts the call, the request is aborted. The body is read only as fast
 * as the hub takes the chunks.
 */
export const providerInference = (
  options: ProviderOptions
): Layer.Layer<Rpc.Handler<"Infer">, never, HttpClient.HttpClient> =>
  TunnelRpcs.toLayerHandler(
    "Infer",
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const endpoint = options.endpoint.replace(TRAILING_SLASHES, "");
      return (request) => {
        const { operation } = request;
        return HttpClientRequest.make(PROVIDER_ROUTES[operation].method)(
          `${endpoint}${providerPath(request)}`
        ).pipe(
          HttpClientRequest.setHeaders(options.authHeaders ?? {}),
          "body" in request
            ? HttpClientRequest.bodyText(request.body, "application/json")
            : identity,
          client.execute,
          Effect.tapError((cause) =>
            Effect.logWarning("the provider did not answer", cause).pipe(
              Effect.annotateLogs({ operation })
            )
          ),
          Effect.mapError(() => new ProviderUnreachable()),
          Effect.map((response) => {
            const contentType = response.headers["content-type"];
            const head: InferenceChunk = {
              _tag: "Head",
              status: response.status,
              ...(contentType === undefined ? {} : { contentType }),
            };
            return response.stream.pipe(
              Stream.decodeText(),
              Stream.filter((text) => text !== ""),
              Stream.map((text): InferenceChunk => ({ _tag: "Body", text })),
              Stream.tapError((cause) =>
                Effect.logWarning("the provider's response broke", cause).pipe(
                  Effect.annotateLogs({ operation })
                )
              ),
              Stream.mapError(() => new ProviderResponseInterrupted()),
              (bodyChunks) => Stream.concat(Stream.make(head), bodyChunks)
            );
          }),
          Stream.unwrap,
          // The request to the provider carries what the provider needs and
          // nothing of the hub: no trace headers.
          Stream.provideService(HttpClient.TracerPropagationEnabled, false)
        );
      };
    })
  );

/**
 * Answers `Infer` with `CallNotSupported`: for a participant that shares no
 * model endpoint.
 */
export const InferenceNotServed: Layer.Layer<Rpc.Handler<"Infer">> =
  TunnelRpcs.toLayerHandler("Infer", () =>
    Stream.fail(new CallNotSupported({ call: "Infer" }))
  );
