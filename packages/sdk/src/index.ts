// Main SDK entry point - orchestrates all exports

// HTTP client for remote hubs
export { ClientError, createClient, type GambiarraClient } from "./client.ts";
// Hub types (re-exported from core)
export type {
  ChatCompletionRequest,
  GambiarraModel,
  Hub,
  HubOptions,
  ModelsListResponse,
  ResponsesCreateRequest,
} from "./hub.ts";
export { hub } from "./hub.ts";
export { participants } from "./participants.ts";
// Protocol messages (re-exported from core)
export type * from "./protocol.ts";
export type * from "./protocol-adapters.ts";
export * from "./protocol-adapters.ts";
// Existing AI SDK provider
export {
  createGambiarra,
  type GambiarraOptions,
  type GambiarraProtocol,
  type GambiarraProtocolNamespace,
  type GambiarraProvider,
} from "./provider.ts";
// Core namespaces
export { rooms } from "./rooms.ts";
// Types (re-exported from core)
export type * from "./types.ts";
export * from "./types.ts";
// Utilities (re-exported from core)
export * from "./utils.ts";
