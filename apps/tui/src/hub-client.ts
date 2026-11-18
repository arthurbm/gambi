/**
 * How the TUI reaches a hub: the management client of `gambi-sdk`, which is
 * derived from the management contract. Every screen and hook goes through
 * it. Nothing in the TUI calls `fetch` on a hub, reads an event stream by
 * hand or declares the shape of an answer.
 */
import {
  type CreateRoomInput,
  createClient,
  type GambiClient,
  type RoomCreated,
} from "gambi-sdk";

const clients = new Map<string, GambiClient>();

/**
 * The management client of the hub at `hubUrl`: one per hub, kept for the
 * life of the process. A client holds nothing open by itself, so it is never
 * closed.
 */
export const hubClient = (hubUrl: string): GambiClient => {
  let client = clients.get(hubUrl);
  if (client === undefined) {
    client = createClient({ hubUrl });
    clients.set(hubUrl, client);
  }
  return client;
};

/**
 * What the create-room form collects. An empty optional field is `undefined`,
 * which the client takes for a field not given.
 */
export interface CreateRoomData {
  defaults?: CreateRoomInput["defaults"] | undefined;
  name: string;
  password?: string | undefined;
}

export const createRoom = (
  client: GambiClient,
  data: CreateRoomData
): Promise<RoomCreated> => client.rooms.create(data);
