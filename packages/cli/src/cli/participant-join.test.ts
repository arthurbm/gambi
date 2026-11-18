import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import {
  FAKE_COMPLETION_TEXT,
  FAKE_MODEL,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { GAMBI_VERSION } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { startCommand } from "./testing.ts";

/** A room of the hub of the block, for one test. */
const createRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return (yield* client.rooms.create({ payload: { name } })).room;
  });

/** The arguments of `participant join` with a model endpoint. */
const joinWithEndpoint = (
  hubUrl: string,
  roomCode: string,
  endpoint: string,
  ...more: readonly string[]
) => [
  "participant",
  "join",
  "--room",
  roomCode,
  "--participant-id",
  "arthur-1",
  "--model",
  FAKE_MODEL,
  "--endpoint",
  endpoint,
  "--no-specs",
  "--hub",
  hubUrl,
  ...more,
];

layer(layerHub(), { excludeTestServices: true })(
  "participant join with a model endpoint",
  (it) => {
    it.effect(
      "registers, opens its tunnel and answers requests until told to leave",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Frevo");

          const joining = yield* startCommand(
            joinWithEndpoint(hub.url, room.code, provider.url)
          );

          expect(yield* joining.nextEvent).toMatchObject({
            type: "registered",
            data: {
              roomCode: room.code,
              participant: {
                id: "arthur-1",
                nickname: `${FAKE_MODEL}@arthur`,
                model: FAKE_MODEL,
                endpoint: provider.url,
              },
            },
          });
          expect(yield* joining.nextEvent).toMatchObject({
            type: "tunnel_connected",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              attempt: 0,
              hubVersion: GAMBI_VERSION,
            },
          });

          const response = yield* Effect.promise(() =>
            fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "arthur-1",
                messages: [{ role: "user", content: "Oi" }],
              }),
            })
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.text())).toContain(
            FAKE_COMPLETION_TEXT
          );

          const watch = yield* watchRoom(room.code);
          yield* joining.signal("SIGTERM");
          expect(yield* joining.nextEvent).toMatchObject({
            type: "leaving",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              signal: "SIGTERM",
            },
          });
          expect(yield* joining.nextEvent).toMatchObject({
            type: "left",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              reason: "stopped",
              removed: true,
            },
          });
          expect((yield* joining.result).exitCode).toBe(0);
          // The room hears one thing: the participant left.
          expect(yield* watch.next).toMatchObject({
            type: "participant.removed",
            participantId: "arthur-1",
            reason: "left",
          });
        })
    );
  }
);
