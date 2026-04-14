import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ApiErrorResponse, ParticipantInfo } from "@gambi/core/types";
import { parseErrorEnvelope } from "./client.ts";

export type GambiProtocol = "openResponses" | "chatCompletions";
const DEFAULT_PROTOCOL: GambiProtocol = "openResponses";

export interface GambiOptions {
  hubUrl?: string;
  roomCode: string;
  defaultProtocol?: GambiProtocol;
}

export interface GambiModel {
  id: string;
  nickname: string;
  model: string;
  endpoint: string;
  capabilities: ParticipantInfo["capabilities"];
}

interface ParticipantsResponse {
  data: ParticipantInfo[];
}

interface ModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    gambi?: {
      nickname: string;
      model: string;
      endpoint: string;
      capabilities?: ParticipantInfo["capabilities"];
    };
  }>;
}

export interface GambiProtocolNamespace {
  participant: (id: string) => LanguageModelV3;
  model: (name: string) => LanguageModelV3;
  any: () => LanguageModelV3;
}

export interface GambiProvider extends GambiProtocolNamespace {
  chatCompletions: GambiProtocolNamespace;
  defaultProtocol: GambiProtocol;
  listModels: () => Promise<GambiModel[]>;
  listParticipants: () => Promise<ParticipantInfo[]>;
  openResponses: GambiProtocolNamespace;
  baseURL: string;
}

type ProtocolNamespaceFactory = (baseURL: string) => GambiProtocolNamespace;

const protocolNamespaceFactories: Record<
  GambiProtocol,
  ProtocolNamespaceFactory
> = {
  openResponses(baseURL) {
    const provider = createOpenResponses({
      url: `${baseURL}/responses`,
      name: "gambi",
    });

    return {
      participant: (id: string) => provider(id),
      model: (name: string) => provider(`model:${name}`),
      any: () => provider("*"),
    };
  },
  chatCompletions(baseURL) {
    const provider = createOpenAICompatible({
      baseURL,
      name: "gambi",
    });

    return {
      participant: (id: string) => provider(id),
      model: (name: string) => provider(`model:${name}`),
      any: () => provider("*"),
    };
  },
};

function createNamespace(
  protocol: GambiProtocol,
  baseURL: string
): GambiProtocolNamespace {
  return protocolNamespaceFactories[protocol](baseURL);
}

/**
 * Create a Gambi provider for use with AI SDK.
 *
 * Defaults to OpenResponses and keeps chat/completions available explicitly.
 */
export function createGambi(options: GambiOptions): GambiProvider {
  const hubUrl = options.hubUrl ?? "http://localhost:3000";
  const baseURL = `${hubUrl}/rooms/${options.roomCode}/v1`;
  const defaultProtocol = options.defaultProtocol ?? DEFAULT_PROTOCOL;

  const openResponses = createNamespace("openResponses", baseURL);
  const chatCompletions = createNamespace("chatCompletions", baseURL);
  const selectedNamespace =
    defaultProtocol === "openResponses" ? openResponses : chatCompletions;

  return {
    participant: (id: string) => selectedNamespace.participant(id),
    model: (name: string) => selectedNamespace.model(name),
    any: () => selectedNamespace.any(),
    openResponses,
    chatCompletions,
    defaultProtocol,

    async listParticipants(): Promise<ParticipantInfo[]> {
      const response = await fetch(
        `${hubUrl}/v1/rooms/${options.roomCode}/participants`
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          | Partial<ApiErrorResponse>
          | undefined;
        throw parseErrorEnvelope(
          response.status,
          body,
          `Failed to fetch participants: ${response.statusText}`
        );
      }
      const data = (await response.json()) as ParticipantsResponse;
      return data.data;
    },

    async listModels(): Promise<GambiModel[]> {
      const response = await fetch(`${baseURL}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data = (await response.json()) as ModelsResponse;
      return data.data.map((model) => ({
        id: model.id,
        nickname: model.gambi?.nickname ?? model.owned_by,
        model: model.gambi?.model ?? model.id,
        endpoint: model.gambi?.endpoint ?? "",
        capabilities: model.gambi?.capabilities ?? {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
      }));
    },

    baseURL,
  };
}

export type { ParticipantInfo } from "@gambi/core/types";
