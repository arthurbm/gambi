import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createClient, DEFAULT_HUB_URL, type GambiClient } from "./client.ts";
import { fetchRoomModels } from "./room-models.ts";
import type {
  ParticipantCapabilities,
  ParticipantStatus,
  ParticipantSummary,
} from "./types.ts";

export type GambiProtocol = "openResponses" | "chatCompletions";
const DEFAULT_PROTOCOL: GambiProtocol = "openResponses";

export interface GambiOptions {
  hubUrl?: string;
  roomCode: string;
  defaultProtocol?: GambiProtocol;
}

/** A participant the room can be asked for: one that shares a model and is not offline. */
export interface GambiModel {
  /** The participant id, which is also a model selector. */
  id: string;
  nickname: string;
  model: string;
  endpoint: string;
  capabilities: ParticipantCapabilities;
  /** `busy` while the participant answers another request. */
  status: Exclude<ParticipantStatus, "offline">;
}

export interface GambiProtocolNamespace {
  participant: (id: string) => LanguageModelV3;
  model: (name: string) => LanguageModelV3;
  any: () => LanguageModelV3;
}

export interface GambiProvider extends GambiProtocolNamespace {
  chatCompletions: GambiProtocolNamespace;
  defaultProtocol: GambiProtocol;
  /**
   * The models the room can be asked for, from the hub's inference plane.
   * Rejects with a `ClientError`, like the management client.
   */
  listModels: () => Promise<GambiModel[]>;
  /**
   * The participants of the room, from the hub's management plane. Rejects
   * with a `ClientError`, like the management client.
   */
  listParticipants: () => Promise<readonly ParticipantSummary[]>;
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
  const hubUrl = options.hubUrl ?? DEFAULT_HUB_URL;
  const baseURL = `${hubUrl}/rooms/${options.roomCode}/v1`;
  const defaultProtocol = options.defaultProtocol ?? DEFAULT_PROTOCOL;

  const openResponses = createNamespace("openResponses", baseURL);
  const chatCompletions = createNamespace("chatCompletions", baseURL);
  const selectedNamespace =
    defaultProtocol === "openResponses" ? openResponses : chatCompletions;
  // Built by the first call that needs the management plane.
  let management: GambiClient | undefined;

  return {
    participant: (id: string) => selectedNamespace.participant(id),
    model: (name: string) => selectedNamespace.model(name),
    any: () => selectedNamespace.any(),
    openResponses,
    chatCompletions,
    defaultProtocol,

    listParticipants() {
      management ??= createClient({ hubUrl });
      return management.participants.list(options.roomCode);
    },

    async listModels(): Promise<GambiModel[]> {
      const entries = await fetchRoomModels(hubUrl, options.roomCode);
      return entries.map((entry) => ({
        id: entry.id,
        nickname: entry.gambi?.nickname ?? entry.owned_by ?? entry.id,
        model: entry.gambi?.model ?? entry.id,
        endpoint: entry.gambi?.endpoint ?? "",
        capabilities: entry.gambi?.capabilities ?? {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
        status: entry.gambi?.status ?? "online",
      }));
    },

    baseURL,
  };
}
