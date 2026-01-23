import { z } from "zod";
import {
  GenerationConfig,
  LlmMetrics,
  MachineSpecs,
  ParticipantInfo,
  RoomInfoPublic,
} from "./types.ts";

// Room messages
export const RoomCreateMessage = z.object({
  type: z.literal("room:create"),
  name: z.string(),
});

export const RoomCreatedMessage = z.object({
  type: z.literal("room:created"),
  code: z.string(),
  roomId: z.string(),
});

export const RoomJoinMessage = z.object({
  type: z.literal("room:join"),
  code: z.string(),
  participant: z.object({
    id: z.string(),
    nickname: z.string(),
    model: z.string(),
    endpoint: z.string().url(),
    specs: MachineSpecs,
    config: GenerationConfig,
  }),
});

export const RoomJoinedMessage = z.object({
  type: z.literal("room:joined"),
  roomId: z.string(),
  participants: z.array(ParticipantInfo),
});

export const RoomParticipantJoinedMessage = z.object({
  type: z.literal("room:participant-joined"),
  participant: ParticipantInfo,
});

export const RoomParticipantLeftMessage = z.object({
  type: z.literal("room:participant-left"),
  participantId: z.string(),
});

export const RoomErrorMessage = z.object({
  type: z.literal("room:error"),
  error: z.string(),
});

// LLM messages
export const LlmRequestMessage = z.object({
  type: z.literal("llm:request"),
  requestId: z.string(),
  targetId: z.string(),
  prompt: z.string(),
  options: GenerationConfig.optional(),
});

export const LlmTokenMessage = z.object({
  type: z.literal("llm:token"),
  requestId: z.string(),
  participantId: z.string(),
  token: z.string(),
  seq: z.number(),
});

export const LlmCompleteMessage = z.object({
  type: z.literal("llm:complete"),
  requestId: z.string(),
  participantId: z.string(),
  metrics: LlmMetrics,
});

export const LlmErrorMessage = z.object({
  type: z.literal("llm:error"),
  requestId: z.string(),
  participantId: z.string(),
  error: z.string(),
});

// TUI messages
export const TuiRegisterMessage = z.object({
  type: z.literal("tui:register"),
  roomCode: z.string().optional(),
});

export const TuiRegisteredMessage = z.object({
  type: z.literal("tui:registered"),
  rooms: z.array(RoomInfoPublic),
  participants: z.array(ParticipantInfo),
});

// Host messages
export const HostRegisterMessage = z.object({
  type: z.literal("host:register"),
  roomId: z.string(),
});

export const HostRegisteredMessage = z.object({
  type: z.literal("host:registered"),
  room: RoomInfoPublic,
  participants: z.array(ParticipantInfo),
});

// List messages
export const ListRoomsMessage = z.object({
  type: z.literal("list:rooms"),
});

export const ListRoomsResponseMessage = z.object({
  type: z.literal("list:rooms-response"),
  rooms: z.array(
    RoomInfoPublic.extend({
      participantCount: z.number(),
    })
  ),
});

// Union of all messages
export const ClientMessage = z.discriminatedUnion("type", [
  RoomCreateMessage,
  RoomJoinMessage,
  LlmRequestMessage,
  TuiRegisterMessage,
  HostRegisterMessage,
  ListRoomsMessage,
]);

export const ServerMessage = z.discriminatedUnion("type", [
  RoomCreatedMessage,
  RoomJoinedMessage,
  RoomParticipantJoinedMessage,
  RoomParticipantLeftMessage,
  RoomErrorMessage,
  LlmTokenMessage,
  LlmCompleteMessage,
  LlmErrorMessage,
  TuiRegisteredMessage,
  HostRegisteredMessage,
  ListRoomsResponseMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
