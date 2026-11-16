/**
 * `gambi-sdk`: the management client and the inference provider. This entry
 * runs in Node and in Bun: it reaches a hub with `fetch`, imports no built-in
 * module, and brings no server, no socket and nothing of Bun.
 *
 * Other entries: `gambi-sdk/discovery` finds hubs on the local network.
 *
 * It exports functions, one error class and types. No schema value and no
 * Effect type leaves this package.
 */
export {
  type ClientOptions,
  createClient,
  type GambiClient,
  type WatchOptions,
} from "./client.ts";
export { ClientError, type ClientErrorCode } from "./client-error.ts";
export {
  createGambi,
  type GambiModel,
  type GambiOptions,
  type GambiProtocol,
  type GambiProtocolNamespace,
  type GambiProvider,
} from "./provider.ts";
export type * from "./types.ts";
