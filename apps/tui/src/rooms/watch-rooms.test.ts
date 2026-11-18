import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import { joinParticipant } from "@gambi/core/testing/participant";
import { fakeProvider, jsonAnswer } from "@gambi/core/testing/provider";
import { layer } from "@gambi/testing/effect";
import { Effect, Fiber } from "effect";
import { createClient } from "gambi-sdk";
import type { RoomState } from "../types";
import { type RoomsWatcher, watchRooms } from "./watch-rooms";

/** A watcher of the rooms of the hub at `hubUrl`, closed when the test ends. */
const watchingAt = (hubUrl: string) =>
  Effect.gen(function* () {
    const client = createClient({ hubUrl });
    const watcher = watchRooms(client, { reconnectDelayMs: 0 });
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        watcher.close();
        await client.close();
      })
    );
    return watcher;
  });

/** A watcher of the rooms of the hub of the block. */
const watching = Effect.flatMap(Hub, (hub) => watchingAt(hub.url));

/**
 * The hub of the block behind a server that can end the event streams going
 * through it the way a hub that closes does: the response just ends.
 */
const hubWhoseStreamsEnd = Effect.gen(function* () {
  const hub = yield* Hub;
  const open = new Set<() => void>();
  let streamsOpened = 0;
  const cancelled = Promise.withResolvers<void>();
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch: async (request) => {
          const { pathname } = new URL(request.url);
          const upstream = new AbortController();
          const answer = await fetch(`${hub.url}${pathname}`, {
            headers: request.headers,
            signal: upstream.signal,
          });
          if (!(pathname.endsWith("/events") && answer.body)) {
            return answer;
          }
          streamsOpened += 1;
          const reader = answer.body.getReader();
          return new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                let ended = false;
                const end = () => {
                  if (!ended) {
                    ended = true;
                    open.delete(end);
                    controller.close();
                    upstream.abort();
                  }
                };
                open.add(end);
                const pump = async () => {
                  while (!ended) {
                    const piece = await reader.read();
                    if (piece.done || ended) {
                      break;
                    }
                    controller.enqueue(piece.value);
                  }
                };
                pump().catch(() => undefined);
              },
              cancel: () => {
                upstream.abort();
                cancelled.resolve();
              },
            }),
            { headers: { "content-type": "text/event-stream" } }
          );
        },
      })
    ),
    (it) => Effect.promise(() => it.stop(true))
  );
  return {
    endStreams: Effect.sync(() => {
      for (const end of [...open]) {
        end();
      }
    }),
    /** Completes when a client gives up a stream it had open. */
    streamCancelled: Effect.promise(() => cancelled.promise),
    streamsOpened: Effect.sync(() => streamsOpened),
    url: `http://127.0.0.1:${server.port}`,
  };
});

/** The room as the watcher shows it, once it shows what the test waits for. */
const shown = (
  watcher: RoomsWatcher,
  roomCode: string,
  expected: (room: RoomState) => boolean
) =>
  Effect.promise(
    () =>
      new Promise<RoomState>((resolve) => {
        const check = () => {
          const room = watcher.rooms().get(roomCode);
          if (room !== undefined && expected(room)) {
            unsubscribe();
            resolve(room);
          }
        };
        const unsubscribe = watcher.subscribe(check);
        check();
      })
  );

const statuses = (room: RoomState) =>
  [...room.participants.values()].map((participant) => [
    participant.nickname,
    participant.status,
  ]);

layer(layerHub(), { excludeTestServices: true })("watched rooms", (it) => {
  it.effect("shows a room and the one status of who is in it", () =>
    Effect.gen(function* () {
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { nickname: "Arthur" },
      });
      const watcher = yield* watching;

      watcher.add(room.code);
      const watched = yield* shown(watcher, room.code, (it) => it.connected);

      expect(watched.name).toBe("Frevo");
      expect(statuses(watched)).toEqual([["Arthur", "online"]]);
    })
  );

  it.effect("follows a participant as its tunnel opens and drops", () =>
    Effect.gen(function* () {
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      const watcher = yield* watching;
      watcher.add(room.code);
      yield* shown(watcher, room.code, (it) => it.connected);

      const participant = yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { nickname: "Arthur" },
      });
      const online = yield* shown(
        watcher,
        room.code,
        (it) => it.participants.get("arthur-1")?.status === "online"
      );
      yield* participant.kill;
      const offline = yield* shown(
        watcher,
        room.code,
        (it) => it.participants.get("arthur-1")?.status === "offline"
      );

      expect(statuses(online)).toEqual([["Arthur", "online"]]);
      expect(statuses(offline)).toEqual([["Arthur", "offline"]]);
      expect(offline.logs.map((entry) => [entry.type, entry.message])).toEqual([
        ["join", "Arthur joined"],
        ["online", "Arthur online"],
        ["offline", "Arthur offline"],
      ]);
    })
  );

  it.effect("shows a request while a participant answers it", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      const answered = Promise.withResolvers<Response>();
      const provider = yield* fakeProvider({ answer: () => answered.promise });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { nickname: "Arthur", model: "llama3" },
        provider: { endpoint: provider.url },
      });
      const watcher = yield* watching;
      watcher.add(room.code);
      yield* shown(watcher, room.code, (it) => it.connected);

      const request = yield* Effect.forkChild(
        Effect.promise(() =>
          fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
            method: "POST",
            body: JSON.stringify({
              model: "arthur-1",
              messages: [{ role: "user", content: "Oi" }],
            }),
          })
        )
      );
      const answering = yield* shown(watcher, room.code, (it) =>
        it.processingRequests.has("arthur-1")
      );
      answered.resolve(
        jsonAnswer({
          choices: [{ message: { role: "assistant", content: "Olá" } }],
          usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
        })
      );
      yield* Fiber.join(request);
      const idle = yield* shown(
        watcher,
        room.code,
        (it) =>
          it.processingRequests.size === 0 &&
          it.participants.get("arthur-1")?.status === "online"
      );

      expect(statuses(answering)).toEqual([["Arthur", "busy"]]);
      expect(idle.logs.map((entry) => [entry.type, entry.message])).toEqual([
        ["request", "req → Arthur (llama3)"],
        ["complete", "complete"],
      ]);
      expect(idle.logs.at(-1)?.metrics?.latencyMs).toBeGreaterThanOrEqual(0);
    })
  );

  it.effect("watches again when the stream of a room just ends", () =>
    Effect.gen(function* () {
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      const hub = yield* hubWhoseStreamsEnd;
      const watcher = yield* watchingAt(hub.url);
      watcher.add(room.code);
      yield* shown(watcher, room.code, (it) => it.connected);

      yield* hub.endStreams;
      yield* shown(watcher, room.code, (it) => !it.connected);
      // What happens while nobody watches comes with the next snapshot.
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { nickname: "Arthur" },
      });
      const back = yield* shown(
        watcher,
        room.code,
        (it) => it.connected && it.participants.has("arthur-1")
      );

      expect(statuses(back)).toEqual([["Arthur", "online"]]);
      expect(yield* hub.streamsOpened).toBeGreaterThanOrEqual(2);
    })
  );

  it.effect(
    "keeps trying while the hub is gone and catches up when it is back",
    () =>
      Effect.gen(function* () {
        const management = yield* managementClient;
        const { room } = yield* management.rooms.create({
          payload: { name: "Frevo" },
        });
        const link = yield* linkToHub;
        const watcher = yield* watchingAt(link.url);
        watcher.add(room.code);
        yield* shown(watcher, room.code, (it) => it.connected);

        yield* link.cut;
        yield* shown(watcher, room.code, (it) => !it.connected);
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          profile: { nickname: "Arthur" },
        });
        yield* link.restore;
        const back = yield* shown(
          watcher,
          room.code,
          (it) => it.connected && it.participants.has("arthur-1")
        );

        expect(statuses(back)).toEqual([["Arthur", "online"]]);
      })
  );

  it.effect("forgets a room it stops watching", () =>
    Effect.gen(function* () {
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      const other = yield* management.rooms.create({
        payload: { name: "Maracatu" },
      });
      const watcher = yield* watching;
      watcher.add(room.code);
      watcher.add(other.room.code);
      yield* shown(watcher, room.code, (it) => it.connected);

      watcher.remove(room.code);
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { nickname: "Arthur" },
      });
      yield* joinParticipant({
        roomCode: other.room.code,
        participantId: "bia-1",
        profile: { nickname: "Bia" },
      });
      const stillWatched = yield* shown(
        watcher,
        other.room.code,
        (it) => it.participants.get("bia-1")?.status === "online"
      );

      expect(statuses(stillWatched)).toEqual([["Bia", "online"]]);
      expect([...watcher.rooms().keys()]).toEqual([other.room.code]);
    })
  );

  it.effect("closing gives up the streams it has open and opens no other", () =>
    Effect.gen(function* () {
      const management = yield* managementClient;
      const { room } = yield* management.rooms.create({
        payload: { name: "Frevo" },
      });
      const hub = yield* hubWhoseStreamsEnd;
      const watcher = yield* watchingAt(hub.url);
      watcher.add(room.code);
      yield* shown(watcher, room.code, (it) => it.connected);

      watcher.close();
      yield* hub.streamCancelled;

      // Nothing is left that would keep the process of the TUI alive.
      expect(yield* hub.streamsOpened).toBe(1);
    })
  );
});
