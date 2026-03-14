import type { ChatCompletionRequest, ResponsesCreateRequest } from "./hub.ts";
import type { ParticipantAuthHeaders, ParticipantInfo } from "./types.ts";

export const ADAPTER_SKIP = Symbol("adapter-skip");
export type AdapterSkip = typeof ADAPTER_SKIP;

export type ProtocolAdapterId =
  | "openResponses"
  | "chatCompletions"
  | (string & {});

export interface ResponseRegistryEntry {
  participantId: string;
  adapterId: ProtocolAdapterId;
  roomId: string;
}

export interface ResponsesCreateAdapterContext {
  authHeaders: ParticipantAuthHeaders;
  entry: ResponseRegistryEntry;
  participant: ParticipantInfo;
  request: ResponsesCreateRequest;
}

export interface StoredResponseAdapterContext {
  action?: "cancel" | "input_items";
  authHeaders: ParticipantAuthHeaders;
  entry: ResponseRegistryEntry;
  participant: ParticipantInfo;
  req: Request;
  responseId: string;
}

export interface ChatCompletionsAdapterContext {
  authHeaders: ParticipantAuthHeaders;
  participant: ParticipantInfo;
  request: ChatCompletionRequest;
}

export interface ResponsesProtocolAdapter {
  id: ProtocolAdapterId;
  canCreate: (participant: ParticipantInfo) => boolean;
  create: (
    context: ResponsesCreateAdapterContext
  ) => Promise<Response | AdapterSkip>;
  proxyStoredResponse?: (
    context: StoredResponseAdapterContext
  ) => Promise<Response>;
}

export interface ChatCompletionsProtocolAdapter {
  id: ProtocolAdapterId;
  create: (context: ChatCompletionsAdapterContext) => Promise<Response>;
}
