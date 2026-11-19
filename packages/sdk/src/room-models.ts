/**
 * The one route of the inference plane the SDK calls by itself: the models
 * of a room. It is outside the management contract, so it is asked with a
 * plain `fetch`, and its failures become the `ClientError` the management
 * client rejects with.
 */
import { INFERENCE_FAILURES } from "@gambi/protocol";
import { hubUnreachable, notAHub, roomNotFound } from "./contract.ts";
import type { ParticipantCapabilities, ParticipantStatus } from "./types.ts";

/**
 * One entry of the list. Only `id` is checked; the rest is read as the hub
 * of this version writes it.
 */
export interface RoomModelEntry {
  readonly gambi?: {
    readonly capabilities?: ParticipantCapabilities;
    readonly endpoint?: string;
    readonly model?: string;
    readonly nickname?: string;
    readonly status?: Exclude<ParticipantStatus, "offline">;
  };
  readonly id: string;
  readonly owned_by?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isEntry = (value: unknown): value is RoomModelEntry =>
  isRecord(value) && typeof value.id === "string";

/** The `code` of an error in the OpenAI format, when the body is one. */
const openAiErrorCode = (body: unknown): unknown =>
  isRecord(body) && isRecord(body.error) ? body.error.code : undefined;

/**
 * Asks the hub for the models of a room. Rejects with a `ClientError`:
 * `ROOM_NOT_FOUND`, `HUB_UNREACHABLE` when nothing answered, and `NOT_A_HUB`
 * for any other answer than a list of models.
 */
export const fetchRoomModels = async (
  hubUrl: string,
  roomCode: string
): Promise<readonly RoomModelEntry[]> => {
  const response = await fetch(`${hubUrl}/rooms/${roomCode}/v1/models`).catch(
    (cause: unknown) => {
      throw hubUnreachable(hubUrl, cause);
    }
  );
  const body: unknown = await response.json().catch(() => undefined);
  const { code, status } = INFERENCE_FAILURES.RoomNotFound;
  if (response.status === status && openAiErrorCode(body) === code) {
    throw roomNotFound(roomCode);
  }
  if (!response.ok) {
    throw notAHub(hubUrl, body, response.status);
  }
  if (!(isRecord(body) && Array.isArray(body.data))) {
    throw notAHub(hubUrl, body);
  }
  const entries: readonly unknown[] = body.data;
  if (!entries.every(isEntry)) {
    throw notAHub(hubUrl, body);
  }
  return entries;
};
