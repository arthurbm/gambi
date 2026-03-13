import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ParticipantInfo } from "@gambiarra/core/types";

export type GambiarraProtocol = "openResponses" | "chatCompletions";
const DEFAULT_PROTOCOL: GambiarraProtocol = "openResponses";

export interface GambiarraOptions {
  hubUrl?: string;
  roomCode: string;
  defaultProtocol?: GambiarraProtocol;
}

export interface GambiarraModel {
  id: string;
  nickname: string;
  model: string;
  endpoint: string;
  capabilities: ParticipantInfo["capabilities"];
}

interface ParticipantsResponse {
  participants: ParticipantInfo[];
}

interface ModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    gambiarra?: {
      nickname: string;
      model: string;
      endpoint: string;
      capabilities?: ParticipantInfo["capabilities"];
    };
  }>;
}

export interface GambiarraProtocolNamespace {
  participant: (id: string) => LanguageModelV3;
  model: (name: string) => LanguageModelV3;
  any: () => LanguageModelV3;
}

export interface GambiarraProvider extends GambiarraProtocolNamespace {
  chatCompletions: GambiarraProtocolNamespace;
  defaultProtocol: GambiarraProtocol;
  listModels: () => Promise<GambiarraModel[]>;
  listParticipants: () => Promise<ParticipantInfo[]>;
  openResponses: GambiarraProtocolNamespace;
  baseURL: string;
}

type ProtocolNamespaceFactory = (baseURL: string) => GambiarraProtocolNamespace;

const protocolNamespaceFactories: Record<
  GambiarraProtocol,
  ProtocolNamespaceFactory
> = {
  openResponses(baseURL) {
    const provider = createOpenResponses({
      url: `${baseURL}/responses`,
      name: "gambiarra",
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
      name: "gambiarra",
    });

    return {
      participant: (id: string) => provider(id),
      model: (name: string) => provider(`model:${name}`),
      any: () => provider("*"),
    };
  },
};

function createNamespace(
  protocol: GambiarraProtocol,
  baseURL: string
): GambiarraProtocolNamespace {
  return protocolNamespaceFactories[protocol](baseURL);
}

/**
 * Create a Gambiarra provider for use with AI SDK.
 *
 * Defaults to OpenResponses and keeps chat/completions available explicitly.
 */
export function createGambiarra(options: GambiarraOptions): GambiarraProvider {
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
        `${hubUrl}/rooms/${options.roomCode}/participants`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch participants: ${response.statusText}`);
      }
      const data = (await response.json()) as ParticipantsResponse;
      return data.participants;
    },

    async listModels(): Promise<GambiarraModel[]> {
      const response = await fetch(`${baseURL}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const data = (await response.json()) as ModelsResponse;
      return data.data.map((model) => ({
        id: model.id,
        nickname: model.gambiarra?.nickname ?? model.owned_by,
        model: model.gambiarra?.model ?? model.id,
        endpoint: model.gambiarra?.endpoint ?? "",
        capabilities: model.gambiarra?.capabilities ?? {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
      }));
    },

    baseURL,
  };
}

export type { ParticipantInfo } from "@gambiarra/core/types";
