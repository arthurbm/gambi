/**
 * `@gambi/protocol`: the schemas, the management plane contract, the tunnel
 * calls, the typed errors and the status transition function (ADR-0007).
 *
 * No server and no platform dependency: this package must run unchanged in
 * Bun, in Node and in a browser.
 */
export * from "./management/api.ts";
export * from "./management/client.ts";
export * from "./management/envelope.ts";
export * from "./management/errors.ts";
export * from "./management/openapi.ts";
export * from "./participant.ts";
export * from "./participant-status.ts";
export * from "./room.ts";
export * from "./tunnel/rpcs.ts";
export * from "./version.ts";
