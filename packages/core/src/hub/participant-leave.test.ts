import { expect } from "bun:test";
import {
  GAMBI_VERSION,
  ParticipantNotFound,
  ParticipantOfAnotherRuntime,
  RoomNotFound,
  TUNNEL_REMOVED_CLOSE_CODE,
} from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect, Layer, Queue } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { Socket } from "effect/socket";
import {
  openTunnel,
  type ParticipantRuntimeOptions,
  register,
  TunnelOpenFailed,
} from "../participant/runtime.ts";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { defaultHandlers, joinParticipant } from "../testing/participant.ts";
import { Hub } from "./hub.ts";
import { Tunnels } from "./tunnels.ts";

layer(layerHub(), { excludeTestServices: true })("leaving a room", (it) => {
  it.effect(
    "a participant that leaves is removed at once: the room hears it, the list forgets it and its tunnel closes",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        const watch = yield* watchRoom(room.code);

        const left = yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
          query: { runtimeId: participant.runtime.runtimeId },
        });

        expect(left).toEqual({ participantId: "arthur-1" });
        // The one event of leaving: the participant is not shown going
        // offline on its way out.
        expect(yield* watch.next).toEqual({
          type: "participant.removed",
          roomCode: room.code,
          timestamp: expect.any(Number),
          participantId: "arthur-1",
          reason: "left",
        });
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toEqual([]);
        yield* participant.runtime.tunnelDropped;
      })
  );

  it.effect("a participant that never opened its tunnel can leave too", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Maracatu" },
      });
      const registered = yield* client.participants.register({
        params: { code: room.code, id: "arthur-1" },
        payload: {
          nickname: "Arthur",
          model: "llama3.1:8b",
          runtimeId: "runtime-of-arthur",
          version: GAMBI_VERSION,
        },
      });

      yield* client.participants.remove({
        params: { code: room.code, id: "arthur-1" },
        query: { runtimeId: registered.participant.runtimeId },
      });

      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toEqual([]);
    })
  );

  it.effect(
    "leaving refuses a room that does not exist and a participant that is not in the room",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Ciranda" },
        });

        const query = { runtimeId: "a-runtime" };
        const noRoom = yield* client.participants
          .remove({ params: { code: "NOROOM", id: "arthur-1" }, query })
          .pipe(Effect.flip);
        const noParticipant = yield* client.participants
          .remove({ params: { code: room.code, id: "arthur-1" }, query })
          .pipe(Effect.flip);
        const response = yield* HttpClient.execute(
          HttpClientRequest.delete(
            `${hub.url}/v1/rooms/${room.code}/participants/arthur-1?runtimeId=a-runtime`
          )
        );

        expect(noRoom).toBeInstanceOf(RoomNotFound);
        expect(noParticipant).toBeInstanceOf(ParticipantNotFound);
        expect(noParticipant.message).toBe(
          `Participant 'arthur-1' is not in room '${room.code}'.`
        );
        expect(response.status).toBe(404);
        expect(yield* response.json).toEqual({
          error: {
            code: "PARTICIPANT_NOT_FOUND",
            message: `Participant 'arthur-1' is not in room '${room.code}'.`,
            hint: "List the participants of the room to see the ids that are in it.",
            details: { roomCode: room.code, participantId: "arthur-1" },
          },
          meta: { requestId: expect.any(String) },
        });
      })
  );

  it.effect(
    "a bootstrap token issued before the participant left opens no tunnel",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Coco" },
        });
        const options = {
          hubUrl: hub.url,
          roomCode: room.code,
          participantId: "arthur-1",
          runtimeId: "runtime-of-arthur",
          profile: { nickname: "Arthur", model: "llama3.1:8b" },
        } satisfies ParticipantRuntimeOptions;
        const { participant, tunnel } = yield* register(options);
        yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
          query: { runtimeId: participant.runtimeId },
        });

        const error = yield* openTunnel(options, tunnel.token).pipe(
          Effect.flip
        );

        // The tunnel does not open, and the runtime that dialed it is told
        // why: it left, and must not try again.
        expect(error).toBeInstanceOf(TunnelOpenFailed);
        expect(error.closed).toBe("removed");
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toEqual([]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            defaultHandlers,
            Socket.layerWebSocketConstructorGlobal
          )
        )
      )
  );

  it.effect(
    "a removal that names a runtime that no longer holds the participant id is refused, and who joined later with that id stays",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const tunnels = yield* Tunnels;
        const { room } = yield* client.rooms.create({
          payload: { name: "Caboclinho" },
        });
        const params = { code: room.code, id: "arthur-1" };
        const first = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        yield* first.stop;
        yield* tunnels.awaitDrop(room.code, "arthur-1");
        const second = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        const watch = yield* watchRoom(room.code);

        // The removal the first runtime asked for arrives only now.
        const late = yield* client.participants
          .remove({ params, query: { runtimeId: first.runtime.runtimeId } })
          .pipe(Effect.flip);
        const response = yield* HttpClient.execute(
          HttpClientRequest.delete(
            `${hub.url}/v1/rooms/${room.code}/participants/arthur-1?runtimeId=${first.runtime.runtimeId}`
          )
        );

        expect(late).toBeInstanceOf(ParticipantOfAnotherRuntime);
        expect(response.status).toBe(409);
        expect(yield* response.json).toEqual({
          error: {
            code: "PARTICIPANT_OF_ANOTHER_RUNTIME",
            message: `Participant 'arthur-1' of room '${room.code}' belongs to another participant runtime.`,
            hint: "Another runtime joined the room with this participant id. List the participants of the room: `runtimeId` names the runtime each one belongs to.",
            details: { roomCode: room.code, participantId: "arthur-1" },
          },
          meta: { requestId: expect.any(String) },
        });
        expect(second.runtime.runtimeId).not.toBe(first.runtime.runtimeId);
        expect(watch.snapshot.participants).toMatchObject([
          {
            id: "arthur-1",
            status: "online",
            runtimeId: second.runtime.runtimeId,
          },
        ]);
        // Nothing happened to the participant: the next thing the room
        // hears is its own runtime taking it out.
        yield* client.participants.remove({
          params,
          query: { runtimeId: second.runtime.runtimeId },
        });
        expect(yield* watch.next).toMatchObject({
          type: "participant.removed",
          participantId: "arthur-1",
        });
      })
  );

  it.effect("a removal that names no runtime is an invalid request", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const hub = yield* Hub;
      const { room } = yield* client.rooms.create({
        payload: { name: "Cavalo-marinho" },
      });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });

      const response = yield* HttpClient.execute(
        HttpClientRequest.delete(
          `${hub.url}/v1/rooms/${room.code}/participants/arthur-1`
        )
      );

      expect(response.status).toBe(400);
      expect(yield* response.json).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toMatchObject([{ id: "arthur-1", status: "online" }]);
    })
  );

  it.effect(
    "a participant whose tunnel is open stays its runtime's when another runtime registers its id: the removal that one asks for is refused",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Baião" },
        });
        const params = { code: room.code, id: "arthur-1" };
        const online = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });

        // Another runtime registers the same id and gives up before it dials.
        const registered = yield* client.participants.register({
          params,
          payload: {
            nickname: "Arthur",
            model: "llama3.1:8b",
            runtimeId: "another-runtime",
            version: GAMBI_VERSION,
          },
        });
        const refused = yield* client.participants
          .remove({ params, query: { runtimeId: "another-runtime" } })
          .pipe(Effect.flip);

        expect(registered.participant.runtimeId).toBe(online.runtime.runtimeId);
        expect(refused).toBeInstanceOf(ParticipantOfAnotherRuntime);
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toMatchObject([
          {
            id: "arthur-1",
            status: "online",
            runtimeId: online.runtime.runtimeId,
          },
        ]);
      })
  );

  it.effect(
    "a participant that is offline goes to the runtime that registers it",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Xaxado" },
        });
        const params = { code: room.code, id: "arthur-1" };
        const registerAs = (runtimeId: string) =>
          client.participants.register({
            params,
            payload: {
              nickname: "Arthur",
              model: "llama3.1:8b",
              runtimeId,
              version: GAMBI_VERSION,
            },
          });
        yield* registerAs("first-runtime");
        const second = yield* registerAs("second-runtime");

        const refused = yield* client.participants
          .remove({ params, query: { runtimeId: "first-runtime" } })
          .pipe(Effect.flip);
        const left = yield* client.participants.remove({
          params,
          query: { runtimeId: "second-runtime" },
        });

        expect(second.participant.runtimeId).toBe("second-runtime");
        expect(refused).toBeInstanceOf(ParticipantOfAnotherRuntime);
        expect(left).toEqual({ participantId: "arthur-1" });
      })
  );

  it.effect(
    "a bootstrap token issued before the participant left opens no tunnel after another runtime registered its id either",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Ciranda" },
        });
        const params = { code: room.code, id: "arthur-1" };
        const options = {
          hubUrl: hub.url,
          roomCode: room.code,
          participantId: "arthur-1",
          runtimeId: "runtime-of-arthur",
          profile: { nickname: "Arthur", model: "llama3.1:8b" },
        } satisfies ParticipantRuntimeOptions;
        const { tunnel } = yield* register(options);
        yield* client.participants.remove({
          params,
          query: { runtimeId: "runtime-of-arthur" },
        });
        yield* register({ ...options, runtimeId: "another-runtime" });

        // The runtime that left dials with the token it was handed before.
        const error = yield* openTunnel(options, tunnel.token).pipe(
          Effect.flip
        );

        expect(error).toBeInstanceOf(TunnelOpenFailed);
        expect(error.closed).toBe("removed");
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toMatchObject([
          { id: "arthur-1", status: "offline", runtimeId: "another-runtime" },
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            defaultHandlers,
            Socket.layerWebSocketConstructorGlobal
          )
        )
      )
  );

  /**
   * A WebSocket for the hub to serve a tunnel on, and what the other end of
   * it sees: each message, and the code it closed with.
   */
  const tunnelSocket = Effect.gen(function* () {
    const seen = yield* Queue.unbounded<
      { readonly message: string } | { readonly closedWith: number }
    >();
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (request, running) =>
            running.upgrade(request)
              ? undefined
              : new Response(null, { status: 400 }),
          websocket: {
            message: (_socket, message) => {
              Queue.offerUnsafe(seen, { message: String(message) });
            },
            close: (_socket, code) => {
              Queue.offerUnsafe(seen, { closedWith: code });
            },
          },
        })
      ),
      (running) => Effect.promise(() => running.stop(true))
    );
    const socket = yield* Socket.makeWebSocket(`ws://127.0.0.1:${server.port}`);
    return { socket, next: Queue.take(seen) };
  });

  it.effect(
    "a tunnel whose runtime left the room while it was on its way in is closed as removed, never welcomed, and takes nothing from who registered the id since",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const tunnels = yield* Tunnels;
        const { room } = yield* client.rooms.create({
          payload: { name: "Maracatu" },
        });
        const params = { code: room.code, id: "arthur-1" };
        const registerAs = (runtimeId: string) =>
          client.participants.register({
            params,
            payload: {
              nickname: "Arthur",
              model: "llama3.1:8b",
              runtimeId,
              version: GAMBI_VERSION,
            },
          });
        const { socket, next } = yield* tunnelSocket;
        const { tunnel } = yield* registerAs("runtime-of-arthur");

        // The hub took the token of the tunnel that is arriving, and before
        // the tunnel is in place its runtime leaves the room and another
        // one registers the same id.
        const redeemed = yield* tunnels.redeemToken(
          room.code,
          "arthur-1",
          tunnel.token
        );
        yield* client.participants.remove({
          params,
          query: { runtimeId: "runtime-of-arthur" },
        });
        yield* registerAs("another-runtime");
        yield* tunnels
          .serve(room.code, "arthur-1", socket, redeemed)
          .pipe(Effect.forkScoped);

        // The first thing the participant's end sees is the close, not a
        // `Welcome`: it is not online, and it is told why.
        expect(yield* next).toEqual({ closedWith: TUNNEL_REMOVED_CLOSE_CODE });
        expect(
          yield* tunnels.client(room.code, "arthur-1").pipe(Effect.flip)
        ).toMatchObject({ _tag: "TunnelNotOpen" });
        // The participant is still the other runtime's, to take out.
        expect(
          yield* client.participants.list({ params: { code: room.code } })
        ).toMatchObject([
          { id: "arthur-1", status: "offline", runtimeId: "another-runtime" },
        ]);
        yield* client.participants.remove({
          params,
          query: { runtimeId: "another-runtime" },
        });
      }).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
  );

  it.effect(
    "a token another runtime holds for a participant that left opens no tunnel, and that runtime is not told that it left",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const { room } = yield* client.rooms.create({
          payload: { name: "Coco" },
        });
        const online = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });
        const options = {
          hubUrl: hub.url,
          roomCode: room.code,
          participantId: "arthur-1",
          runtimeId: "another-runtime",
          profile: { nickname: "Arthur", model: "llama3.1:8b" },
        } satisfies ParticipantRuntimeOptions;
        const { tunnel } = yield* register(options);
        yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
          query: { runtimeId: online.runtime.runtimeId },
        });

        const error = yield* openTunnel(options, tunnel.token).pipe(
          Effect.flip
        );

        // Nobody took this runtime out: it may register again.
        expect(error).toBeInstanceOf(TunnelOpenFailed);
        expect(error.closed).toBeUndefined();
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            defaultHandlers,
            Socket.layerWebSocketConstructorGlobal
          )
        )
      )
  );
});
