import { afterEach, expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import { joinParticipant } from "@gambi/core/testing/participant";
import { fakeProvider } from "@gambi/core/testing/provider";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { useSessionStore } from "../store/session-store";
import {
  followLifecycle,
  joinAsParticipant,
  leaveAsParticipant,
} from "./participant-session";

const session = () => useSessionStore.getState();

type Session = ReturnType<typeof session>;

/** The session, once it shows what the test waits for. */
const shown = (expected: (session: Session) => boolean) =>
  Effect.promise(
    () =>
      new Promise<Session>((resolve) => {
        const check = (state: Session) => {
          if (expected(state)) {
            unsubscribe();
            resolve(state);
          }
        };
        const unsubscribe = useSessionStore.subscribe(check);
        check(session());
      })
  );

const arthur = (endpoint: string) => ({
  id: "arthur-1",
  nickname: "Arthur",
  model: "llama3",
  endpoint,
});

afterEach(async () => {
  await leaveAsParticipant();
  session().reset();
});

layer(layerHub(), { excludeTestServices: true })(
  "participant session",
  (it) => {
    it.effect("joining puts this machine's model online in the room", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const management = yield* managementClient;
        const { room } = yield* management.rooms.create({
          payload: { name: "Frevo" },
        });
        const provider = yield* fakeProvider();

        const joined = yield* Effect.promise(() =>
          joinAsParticipant(hub.url, room.code, {
            id: "arthur-1",
            nickname: "Arthur",
            model: "llama3",
            endpoint: provider.url,
            // What the join form sends for the fields left empty.
            password: undefined,
            specs: undefined,
            config: {},
            capabilities: undefined,
            authHeaders: { Authorization: "Bearer segredo" },
          })
        );

        expect(joined).toBe(true);
        expect(session()).toMatchObject({
          status: "joined",
          participantId: "arthur-1",
          roomCode: room.code,
          nickname: "Arthur",
          model: "llama3",
          healthStatus: "healthy",
          error: null,
        });
        const participants = yield* management.participants.list({
          params: { code: room.code },
        });
        expect(
          participants.map((it) => [it.id, it.nickname, it.status])
        ).toEqual([["arthur-1", "Arthur", "online"]]);
        // `ParticipantAuthHeaders` stay on this machine.
        expect(JSON.stringify(participants)).not.toContain("segredo");

        const answer = yield* Effect.promise(() =>
          fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
            method: "POST",
            body: JSON.stringify({
              model: "arthur-1",
              messages: [{ role: "user", content: "Oi" }],
            }),
          })
        );
        const call = yield* provider.nextCall;
        expect(answer.status).toBe(200);
        expect(call.path).toBe("/v1/chat/completions");
        expect(call.headers.authorization).toBe("Bearer segredo");
      })
    );

    it.effect("leaving takes the participant out of the room at once", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const management = yield* managementClient;
        const { room } = yield* management.rooms.create({
          payload: { name: "Frevo" },
        });
        yield* Effect.promise(() =>
          joinAsParticipant(hub.url, room.code, arthur("http://127.0.0.1:1"))
        );
        const watch = yield* watchRoom(room.code);

        yield* Effect.promise(() => leaveAsParticipant());

        // The room hears one thing: the participant left.
        expect(yield* watch.next).toMatchObject({
          type: "participant.removed",
          participantId: "arthur-1",
          reason: "left",
        });
        expect(session()).toMatchObject({
          status: "idle",
          participantId: null,
          roomCode: null,
        });
        expect(
          yield* management.participants.list({ params: { code: room.code } })
        ).toEqual([]);
      })
    );

    it.effect("a room that does not exist is an error the screen shows", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const joined = yield* Effect.promise(() =>
          joinAsParticipant(hub.url, "NOPE00", arthur("http://127.0.0.1:1"))
        );

        expect(joined).toBe(false);
        expect(session()).toMatchObject({
          status: "error",
          error: "Room 'NOPE00' was not found.",
          healthStatus: "unhealthy",
        });
      })
    );

    it.effect("a wrong password is refused and joining again works", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const management = yield* managementClient;
        const { room } = yield* management.rooms.create({
          payload: { name: "Frevo", password: "olinda" },
        });

        const refused = yield* Effect.promise(() =>
          joinAsParticipant(hub.url, room.code, {
            ...arthur("http://127.0.0.1:1"),
            password: "recife",
          })
        );
        const refusal = session().error;
        const joined = yield* Effect.promise(() =>
          joinAsParticipant(hub.url, room.code, {
            ...arthur("http://127.0.0.1:1"),
            password: "olinda",
          })
        );

        expect(refused).toBe(false);
        expect(refusal).toContain("password");
        expect(joined).toBe(true);
        expect(session()).toMatchObject({ status: "joined", error: null });
      })
    );

    it.effect(
      "a hub that goes away shows as a degraded session, not a lost one",
      () =>
        Effect.gen(function* () {
          const management = yield* managementClient;
          const { room } = yield* management.rooms.create({
            payload: { name: "Frevo" },
          });
          const link = yield* linkToHub;
          yield* Effect.promise(() =>
            joinAsParticipant(link.url, room.code, arthur("http://127.0.0.1:1"))
          );

          yield* link.cut;
          const away = yield* shown((it) => it.healthStatus !== "healthy");

          // The runtime comes back by itself: the session is still in the room.
          expect(away).toMatchObject({
            status: "joined",
            healthStatus: "degraded",
            error: null,
          });
        })
    );

    it.effect(
      "a hub that refuses the participant on its way back ends the session",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const management = yield* managementClient;
          const { room } = yield* management.rooms.create({
            payload: { name: "Frevo" },
          });
          yield* Effect.promise(() =>
            joinAsParticipant(hub.url, room.code, arthur("http://127.0.0.1:1"))
          );
          const identity = { roomCode: room.code, participantId: "arthur-1" };

          followLifecycle({
            type: "reconnecting",
            ...identity,
            attempt: 1,
            delayMillis: 1000,
            reason: "tunnelDropped",
          });
          const trying = session().healthStatus;
          followLifecycle({
            type: "connected",
            ...identity,
            attempt: 1,
            hubVersion: "0.8.0",
          });
          const back = session().healthStatus;
          followLifecycle({
            type: "left",
            ...identity,
            reason: "refused",
            error: {
              name: "RoomNotFound",
              message: "Room 'ABC123' was not found.",
            },
          });

          expect([trying, back]).toEqual(["degraded", "healthy"]);
          expect(session()).toMatchObject({
            status: "error",
            error: "Room 'ABC123' was not found.",
            healthStatus: "unhealthy",
          });
          // The session is over: a new join is possible.
          expect(
            yield* Effect.promise(() =>
              joinAsParticipant(
                hub.url,
                room.code,
                arthur("http://127.0.0.1:1")
              )
            )
          ).toBe(true);
        })
    );

    it.effect(
      "a session replaced by another runtime with its id ends saying so",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const management = yield* managementClient;
          const { room } = yield* management.rooms.create({
            payload: { name: "Frevo" },
          });
          yield* Effect.promise(() =>
            joinAsParticipant(hub.url, room.code, arthur("http://127.0.0.1:1"))
          );

          // The same participant joins from somewhere else: the hub keeps the
          // newer tunnel and tells this runtime it was replaced.
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
          });
          const ended = yield* shown((it) => it.status === "error");

          expect(ended.error).toBe(
            "Another participant runtime joined the room with this participant's id."
          );
          // The other runtime is the participant now: it stays in the room.
          expect(
            (yield* management.participants.list({
              params: { code: room.code },
            })).map((it) => [it.id, it.status])
          ).toEqual([["arthur-1", "online"]]);
        })
    );
  }
);
