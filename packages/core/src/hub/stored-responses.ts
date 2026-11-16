/**
 * Where each Response of the Responses API lives: the participant whose
 * provider created it. A provider keeps the Responses it creates, and only
 * that provider can read one back, delete it or cancel it, so the hub
 * remembers who to ask.
 *
 * What the hub remembers is bounded (`HubSettings.storedResponsesLimit`).
 * Past the limit it forgets the Response nobody created or asked for the
 * longest; the provider still has it, but the hub answers that it does not
 * know it.
 */
import { Context, Effect, Layer } from "effect";
import { HubSettings } from "./settings.ts";

/** What the hub knows of one Response. */
export interface StoredResponse {
  /** The participant whose provider answered the request that created it. */
  readonly participantId: string;
  /**
   * Whether the hub built the Response itself, from a Chat Completions
   * answer. No provider stores such a Response: it cannot be read back.
   */
  readonly translated: boolean;
}

/**
 * The longest id the hub remembers. An id of the OpenAI API has around 50
 * characters; a provider that sends something far longer is not remembered,
 * so that an entry has a bounded size too.
 */
export const MAX_RESPONSE_ID_CHARACTERS = 256;

// A room code never contains a space, so the pair is unambiguous.
const keyOf = (roomCode: string, responseId: string) =>
  `${roomCode} ${responseId}`;

export class StoredResponses extends Context.Service<
  StoredResponses,
  {
    /**
     * What the hub knows of the Response, or `undefined`. Asking for a
     * Response counts as using it: it is the last one to be forgotten.
     */
    readonly find: (
      roomCode: string,
      responseId: string
    ) => Effect.Effect<StoredResponse | undefined>;
    /** Forgets the Response: its provider no longer has it. */
    readonly forget: (
      roomCode: string,
      responseId: string
    ) => Effect.Effect<void>;
    /** Remembers where the Response lives, forgetting the oldest one past the limit. */
    readonly remember: (
      roomCode: string,
      responseId: string,
      response: StoredResponse
    ) => Effect.Effect<void>;
  }
>()("gambi/core/StoredResponses") {
  static readonly layer = Layer.effect(
    StoredResponses,
    Effect.gen(function* () {
      const settings = yield* HubSettings;
      // A `Map` iterates in insertion order, so the first key is the one
      // used the longest ago: every use puts its entry back at the end.
      const responses = new Map<string, StoredResponse>();

      const remember = (key: string, response: StoredResponse) => {
        responses.delete(key);
        responses.set(key, response);
        while (responses.size > settings.storedResponsesLimit) {
          const [oldest] = responses.keys();
          if (oldest === undefined) {
            return;
          }
          responses.delete(oldest);
        }
      };

      return StoredResponses.of({
        find: (roomCode, responseId) =>
          Effect.sync(() => {
            const key = keyOf(roomCode, responseId);
            const response = responses.get(key);
            if (response !== undefined) {
              remember(key, response);
            }
            return response;
          }),
        forget: (roomCode, responseId) =>
          Effect.sync(() => {
            responses.delete(keyOf(roomCode, responseId));
          }),
        remember: (roomCode, responseId, response) =>
          Effect.sync(() => {
            if (
              responseId !== "" &&
              responseId.length <= MAX_RESPONSE_ID_CHARACTERS
            ) {
              remember(keyOf(roomCode, responseId), response);
            }
          }),
      });
    })
  );
}
