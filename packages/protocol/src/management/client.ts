/**
 * The management client, derived from the contract. It needs an `HttpClient`
 * from the environment: `FetchHttpClient.layer` (from `effect/http`) works in
 * Bun, in Node and in a browser.
 */
import type { Effect } from "effect";
import type { HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { ManagementApi } from "./api.ts";

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
  HttpApiClient.make(ManagementApi, { baseUrl });
