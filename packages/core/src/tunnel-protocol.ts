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

const HarnessSession = z.object({
  sessionId: z.string().min(1),
});

export const TunnelHarnessMessage = HarnessSession.extend({
  type: z.literal("tunnel.harness.message"),
  message: z.record(z.string(), z.unknown()),
});

export const TunnelHarnessControlMessage = HarnessSession.extend({
  type: z.literal("tunnel.harness.control"),
  action: z.enum(["open", "close"]),
  cwd: z.string().optional(),
}).refine((message) => message.action === "open" || message.cwd === undefined, {
  message: "cwd is only valid when opening a harness session",
  path: ["cwd"],
});

export const TunnelHarnessArtifactMessage = HarnessSession.extend({
  type: z.literal("tunnel.harness.artifact"),
  version: z.number().int().positive(),
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]),
    })
  ),
  reason: z.enum(["watch", "final"]),
});

export const TunnelHarnessStatusMessage = HarnessSession.extend({
  type: z.literal("tunnel.harness.status"),
  status: z.enum(["opened", "closed", "error"]),
  message: z.string().optional(),
});

/** Frames accepted from a management client attached to a harness. */
export const TunnelHarnessClientMessage = z.union([
  TunnelHarnessMessage,
  TunnelHarnessControlMessage,
]);

/** Frames delivered to a management client attached to a harness. */
export const TunnelHarnessAttachedMessage = z.union([
  TunnelHarnessMessage,
  TunnelHarnessArtifactMessage,
  TunnelHarnessStatusMessage,
]);

export const TunnelClientMessage = z.discriminatedUnion("type", [
  TunnelResponseStartMessage,
  TunnelResponseChunkMessage,
  TunnelResponseEndMessage,
  TunnelResponseErrorMessage,
  TunnelPingMessage,
  TunnelHarnessMessage,
  TunnelHarnessArtifactMessage,
  TunnelHarnessStatusMessage,
]);

export const TunnelServerMessage = z.discriminatedUnion("type", [
  TunnelRequestMessage,
  TunnelPongMessage,
  TunnelHarnessMessage,
  TunnelHarnessControlMessage,
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
export type TunnelHarnessMessage = z.infer<typeof TunnelHarnessMessage>;
export type TunnelHarnessControlMessage = z.infer<
  typeof TunnelHarnessControlMessage
>;
export type TunnelHarnessArtifactMessage = z.infer<
  typeof TunnelHarnessArtifactMessage
>;
export type TunnelHarnessStatusMessage = z.infer<
  typeof TunnelHarnessStatusMessage
>;
export type TunnelHarnessClientMessage = z.infer<
  typeof TunnelHarnessClientMessage
>;
export type TunnelHarnessAttachedMessage = z.infer<
  typeof TunnelHarnessAttachedMessage
>;
export type TunnelClientMessage = z.infer<typeof TunnelClientMessage>;
export type TunnelServerMessage = z.infer<typeof TunnelServerMessage>;
