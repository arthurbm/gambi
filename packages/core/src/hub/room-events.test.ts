import { expect } from "bun:test";
import { RoomNotFound } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { Hub } from "./hub.ts";
import { Tunnels } from "./tunnels.ts";

layer(layerHub(), { excludeTestServices: true })("room events", (it) => {
  it.effect(
    "the stream of a room starts with a snapshot of the room and its participants",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });

        // The derived client hands the stream back: this is the one SSE
        // parser of the management plane.
        const events = yield* client.events.watch({
          params: { code: room.code },
        });
        const [first] = yield* Stream.runCollect(Stream.take(events, 1));

        expect(first).toEqual({
          type: "room.snapshot",
          roomCode: room.code,
          timestamp: expect.any(Number),
          room: { ...room, participantCount: 1 },
          participants: [
            expect.objectContaining({ id: "arthur-1", status: "online" }),
          ],
        });
      })
  );

  it.effect(
    "a participant that registers, opens its tunnel and loses it shows up as joined, online and offline",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const tunnels = yield* Tunnels;
        const { room } = yield* client.rooms.create({
          payload: { name: "Maracatu" },
        });
        const watch = yield* watchRoom(room.code);

        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        const joined = yield* watch.next;
        const online = yield* watch.next;
        yield* participant.kill;
        yield* tunnels.awaitDrop(room.code, "arthur-1");
        const offline = yield* watch.next;

        expect(watch.snapshot.participants).toEqual([]);
        expect(joined).toEqual({
          type: "participant.joined",
          roomCode: room.code,
          timestamp: expect.any(Number),
          participant: expect.objectContaining({
            id: "arthur-1",
            status: "offline",
          }),
        });
        expect(online).toEqual({
          type: "participant.online",
          roomCode: room.code,
          timestamp: expect.any(Number),
          previousStatus: "offline",
          participant: expect.objectContaining({
            id: "arthur-1",
            status: "online",
          }),
        });
        expect(offline).toEqual({
          type: "participant.offline",
          roomCode: room.code,
          timestamp: expect.any(Number),
          previousStatus: "online",
          participant: expect.objectContaining({
            id: "arthur-1",
            status: "offline",
          }),
        });
      })
  );

  it.effect(
    "on the wire each event is one SSE event, named after its type, with the event as JSON",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Ciranda" },
        });

        const response = yield* HttpClient.execute(
          HttpClientRequest.get(`${hub.url}/v1/rooms/${room.code}/events`)
        );
        const text = yield* response.stream.pipe(
          Stream.decodeText,
          Stream.takeUntil((chunk) => chunk.includes("\n\n")),
          Stream.mkString
        );

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");
        const [event, data, ...rest] = text.split("\n");
        expect(event).toBe("event: room.snapshot");
        expect(data?.startsWith("data: ")).toBe(true);
        expect(JSON.parse(data?.slice("data: ".length) ?? "")).toMatchObject({
          type: "room.snapshot",
          roomCode: room.code,
          participants: [],
        });
        expect(rest).toEqual(["", ""]);
      })
  );

  it.effect("a room that does not exist has no stream", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;

      const error = yield* client.events
        .watch({ params: { code: "NOROOM" } })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(RoomNotFound);
    })
  );
});
