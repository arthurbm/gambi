/**
 * Capability detection: what the provider at an endpoint lists as its models
 * and which inference APIs it answers. It runs on the participant's machine,
 * before the participant registers, and what it finds goes up with the
 * registration (`ParticipantProfile.capabilities`). The hub never calls a
 * provider, so it never probes one.
 *
 * The hub reads the capabilities when it creates a Response: a provider that
 * does not speak the Responses API is asked through Chat Completions.
 *
 * `ParticipantAuthHeaders` are applied to every probe request, and stay here.
 */
import type { ParticipantCapabilities, ProtocolSupport } from "@gambi/protocol";
import { type Duration, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { ProviderOptions } from "./inference.ts";

/** How long the provider has to answer each probe request. */
export const PROBE_TIMEOUT: Duration.Input = "5 seconds";

/** What a probe found at an endpoint. */
export interface EndpointProbe {
  readonly capabilities: ParticipantCapabilities;
  /** The models the provider lists; empty when it lists none or did not answer. */
  readonly models: readonly string[];
  /** Whether a provider answered there as one: it listed a model or speaks an inference API. */
  readonly reachable: boolean;
}

/** What Ollama lists on `GET /api/tags`. */
const OllamaModels = Schema.Struct({
  models: Schema.Array(Schema.Struct({ name: Schema.String })),
});

/** What an OpenAI-compatible provider lists on `GET /v1/models`. */
const OpenAiModels = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String })),
});

/**
 * The statuses with which a provider says it does not answer a route for
 * this caller: the route does not exist, or the caller may not use it.
 */
const REFUSALS = new Set([401, 403, 404, 405, 501]);

const TRAILING_SLASHES = /\/+$/;

/**
 * Probes the provider at `provider.endpoint`.
 *
 * - Models: the ones Ollama lists (`GET /api/tags`), or else the ones of
 *   `GET /v1/models`.
 * - Each inference API: an empty `POST` to its route. A refusal (401, 403,
 *   404, 405, 501) is `unsupported`; any other answer, a complaint about the
 *   empty body included, is `supported`; no answer in `PROBE_TIMEOUT` is
 *   `unknown`. A provider that lists models is taken to speak Chat
 *   Completions even when that probe got no answer.
 *
 * It never fails: a provider that is not there is a probe that found nothing.
 */
export const probeEndpoint = Effect.fn("probeEndpoint")(function* (
  provider: ProviderOptions
): Effect.fn.Return<EndpointProbe, never, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  const endpoint = provider.endpoint.replace(TRAILING_SLASHES, "");
  /** The provider's answer to a request, or nothing when it gave none in time. */
  const ask = <A>(
    request: HttpClientRequest.HttpClientRequest,
    read: (
      response: HttpClientResponse.HttpClientResponse
    ) => Effect.Effect<A, unknown>
  ): Effect.Effect<Option.Option<A>> =>
    request.pipe(
      HttpClientRequest.setHeaders(provider.authHeaders ?? {}),
      client.execute,
      Effect.flatMap(read),
      Effect.timeout(PROBE_TIMEOUT),
      Effect.option
    );

  const listed = <A>(
    path: string,
    schema: Schema.Codec<A, unknown>,
    names: (list: A) => readonly string[]
  ) =>
    ask(HttpClientRequest.get(`${endpoint}${path}`), (response) =>
      response.status >= 200 && response.status < 300
        ? Effect.map(HttpClientResponse.schemaBodyJson(schema)(response), names)
        : Effect.succeed([])
    ).pipe(Effect.map(Option.getOrElse((): readonly string[] => [])));

  const speaks = (path: string): Effect.Effect<ProtocolSupport> =>
    ask(
      HttpClientRequest.post(`${endpoint}${path}`).pipe(
        HttpClientRequest.bodyText("{}", "application/json")
      ),
      (response) =>
        // The answer is read to its end so that its connection is let go of.
        Effect.as(Effect.ignore(response.text), response.status)
    ).pipe(
      Effect.map(
        Option.match({
          onNone: () => "unknown" as const,
          onSome: (status) =>
            REFUSALS.has(status) ? "unsupported" : "supported",
        })
      )
    );

  const [ollamaModels, openAiModels, chatCompletions, openResponses] =
    yield* Effect.all(
      [
        listed("/api/tags", OllamaModels, (list) =>
          list.models.map((model) => model.name)
        ),
        listed("/v1/models", OpenAiModels, (list) =>
          list.data.map((model) => model.id)
        ),
        speaks("/v1/chat/completions"),
        speaks("/v1/responses"),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      // The probe carries what the provider needs and nothing else: no trace headers.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false)
    );
  const models = ollamaModels.length > 0 ? ollamaModels : openAiModels;
  const capabilities: ParticipantCapabilities = {
    openResponses,
    chatCompletions:
      chatCompletions === "unknown" && models.length > 0
        ? "supported"
        : chatCompletions,
  };
  return {
    reachable:
      models.length > 0 ||
      capabilities.chatCompletions === "supported" ||
      capabilities.openResponses === "supported",
    models,
    capabilities,
  };
});
