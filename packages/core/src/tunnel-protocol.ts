import { z } from "zod";

const TunnelHeaders = z.record(z.string(), z.string());

export const TunnelRequestMessage = z.object({
  type: z.literal("tunnel.request"),
  requestId: z.string(),
  operation: z.string(),
  method: z.enum(["GET", "POST", "DELETE"]),
  path: z.string(),
  headers: TunnelHeaders.default({}),
  body: z.unknown().optional(),
  stream: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TunnelResponseStartMessage = z.object({
  type: z.literal("tunnel.response.start"),
  requestId: z.string(),
  status: z.number().int().min(100).max(599),
  headers: TunnelHeaders.default({}),
});

export const TunnelResponseChunkMessage = z.object({
  type: z.literal("tunnel.response.chunk"),
  requestId: z.string(),
  chunk: z.string(),
});

export const TunnelResponseEndMessage = z.object({
  type: z.literal("tunnel.response.end"),
  requestId: z.string(),
});

export const TunnelResponseErrorMessage = z.object({
  type: z.literal("tunnel.response.error"),
  requestId: z.string(),
  stage: z.string(),
  message: z.string(),
});

export const TunnelPingMessage = z.object({
  type: z.literal("tunnel.ping"),
  timestamp: z.number(),
});

export const TunnelPongMessage = z.object({
  type: z.literal("tunnel.pong"),
  timestamp: z.number(),
});

export const TunnelClientMessage = z.discriminatedUnion("type", [
  TunnelResponseStartMessage,
  TunnelResponseChunkMessage,
  TunnelResponseEndMessage,
  TunnelResponseErrorMessage,
  TunnelPingMessage,
]);

export const TunnelServerMessage = z.discriminatedUnion("type", [
  TunnelRequestMessage,
  TunnelPongMessage,
]);

export type TunnelRequestMessage = z.infer<typeof TunnelRequestMessage>;
export type TunnelResponseStartMessage = z.infer<
  typeof TunnelResponseStartMessage
>;
export type TunnelResponseChunkMessage = z.infer<
  typeof TunnelResponseChunkMessage
>;
export type TunnelResponseEndMessage = z.infer<typeof TunnelResponseEndMessage>;
export type TunnelResponseErrorMessage = z.infer<
  typeof TunnelResponseErrorMessage
>;
export type TunnelPingMessage = z.infer<typeof TunnelPingMessage>;
export type TunnelPongMessage = z.infer<typeof TunnelPongMessage>;
export type TunnelClientMessage = z.infer<typeof TunnelClientMessage>;
export type TunnelServerMessage = z.infer<typeof TunnelServerMessage>;
