import { expect } from "bun:test";
import {
  InvalidPassword,
  RoomNotFound,
  VersionMismatch,
} from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Clock, Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { layerHub, managementClient } from "../testing/hub.ts";
import { Hub } from "./hub.ts";

const registration = {
  nickname: "Arthur",
  model: "llama3.1:8b",
  endpoint: "http://127.0.0.1:11434",
  version: "0.8.0",
};

/** A raw request to the hub, for what the derived client hides: the JSON on the wire. */
const raw = (request: (url: string) => HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const response = yield* HttpClient.execute(request(hub.url));
    return { status: response.status, body: yield* response.json };
  });

layer(layerHub({ version: "0.8.3" }), { excludeTestServices: true })(
  "participant registration",
  (it) => {
    it.effect(
      "registers a participant offline and hands it a bootstrap token valid for 60 s",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Frevo" },
          });
          const before = yield* Clock.currentTimeMillis;

          const registered = yield* client.participants.register({
            params: { code: room.code, id: "arthur-1" },
            payload: registration,
          });

          const after = yield* Clock.currentTimeMillis;
          expect(registered.participant).toEqual({
            id: "arthur-1",
            nickname: "Arthur",
            model: "llama3.1:8b",
            endpoint: "http://127.0.0.1:11434",
            config: { hasInstructions: false },
            specs: {},
            capabilities: {
              openResponses: "unknown",
              chatCompletions: "unknown",
            },
            status: "offline",
            joinedAt: expect.any(Number),
            updatedAt: expect.any(Number),
          });
          expect(registered.tunnel.token.length).toBeGreaterThan(20);
          expect(registered.tunnel.expiresAt).toBeGreaterThanOrEqual(
            before + 60_000
          );
          expect(registered.tunnel.expiresAt).toBeLessThanOrEqual(
            after + 60_000
          );
        })
    );

    it.effect("lists the participants of a room with a single status", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Maracatu" },
        });
        yield* client.participants.register({
          params: { code: room.code, id: "arthur-1" },
          payload: registration,
        });

        const listed = yield* client.participants.list({
          params: { code: room.code },
        });
        const onTheWire = yield* raw((url) =>
          HttpClientRequest.get(`${url}/v1/rooms/${room.code}/participants`)
        );
        const summary = yield* client.rooms.get({
          params: { code: room.code },
        });

        expect(listed.map((participant) => participant.status)).toEqual([
          "offline",
        ]);
        expect(onTheWire.body).toEqual({
          data: [
            {
              id: "arthur-1",
              nickname: "Arthur",
              model: "llama3.1:8b",
              endpoint: "http://127.0.0.1:11434",
              config: { hasInstructions: false },
              specs: {},
              capabilities: {
                openResponses: "unknown",
                chatCompletions: "unknown",
              },
              status: "offline",
              joinedAt: expect.any(Number),
              updatedAt: expect.any(Number),
            },
          ],
          meta: { requestId: expect.any(String) },
        });
        expect(summary.participantCount).toBe(1);
      })
    );

    it.effect(
      "refuses a participant on another minor, saying which version the hub expects",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Ciranda" },
          });

          const error = yield* client.participants
            .register({
              params: { code: room.code, id: "arthur-1" },
              payload: { ...registration, version: "0.7.2" },
            })
            .pipe(Effect.flip);
          const onTheWire = yield* raw((url) =>
            HttpClientRequest.put(
              `${url}/v1/rooms/${room.code}/participants/arthur-1`
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                ...registration,
                version: "0.7.2",
              })
            )
          );

          expect(error).toBeInstanceOf(VersionMismatch);
          expect(error.message).toBe(
            "This hub runs Gambi 0.8.3 and expects participants on 0.8.x; this participant runs 0.7.2."
          );
          expect(onTheWire.status).toBe(409);
          expect(onTheWire.body).toMatchObject({
            error: {
              code: "VERSION_MISMATCH",
              details: { hubVersion: "0.8.3", participantVersion: "0.7.2" },
            },
          });
          // The refused participant is not in the room.
          expect(
            yield* client.participants.list({ params: { code: room.code } })
          ).toEqual([]);
        })
    );

    it.effect("accepts a participant on another patch of the same minor", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Coco" },
        });

        const registered = yield* client.participants.register({
          params: { code: room.code, id: "arthur-1" },
          payload: { ...registration, version: "0.8.11" },
        });

        expect(registered.participant.id).toBe("arthur-1");
      })
    );

    it.effect("refuses a registration without the room password", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Baião", password: "sanfona" },
        });
        const register = (password: string | undefined) =>
          client.participants.register({
            params: { code: room.code, id: "arthur-1" },
            payload: {
              ...registration,
              ...(password === undefined ? {} : { password }),
            },
          });

        const missing = yield* register(undefined).pipe(Effect.flip);
        const wrong = yield* register("zabumba").pipe(Effect.flip);
        const right = yield* register("sanfona");

        expect(missing).toBeInstanceOf(InvalidPassword);
        expect(wrong).toBeInstanceOf(InvalidPassword);
        expect(right.participant.status).toBe("offline");
      })
    );

    it.effect("refuses a registration in a room that does not exist", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;

        const registerError = yield* client.participants
          .register({
            params: { code: "NOROOM", id: "arthur-1" },
            payload: registration,
          })
          .pipe(Effect.flip);
        const listError = yield* client.participants
          .list({ params: { code: "NOROOM" } })
          .pipe(Effect.flip);

        expect(registerError).toBeInstanceOf(RoomNotFound);
        expect(listError).toBeInstanceOf(RoomNotFound);
      })
    );

    it.effect(
      "refuses a registration that carries ParticipantAuthHeaders, and stores nothing",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Xote" },
          });

          const { status, body } = yield* raw((url) =>
            HttpClientRequest.put(
              `${url}/v1/rooms/${room.code}/participants/arthur-1`
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                ...registration,
                authHeaders: { authorization: "Bearer sk-secret" },
              })
            )
          );

          expect(status).toBe(400);
          expect(body).toMatchObject({
            error: {
              code: "INVALID_REQUEST",
              details: { issues: [{ path: ["payload", "authHeaders"] }] },
            },
          });
          expect(JSON.stringify(body)).not.toContain("sk-secret");
          expect(
            yield* client.participants.list({ params: { code: room.code } })
          ).toEqual([]);
        })
    );

    it.effect(
      "registering the same id again updates the participant and keeps when it joined",
      () =>
        Effect.gen(function* () {
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: { name: "Forró" },
          });
          const register = (nickname: string) =>
            client.participants.register({
              params: { code: room.code, id: "arthur-1" },
              payload: { ...registration, nickname },
            });

          const first = yield* register("Arthur");
          const second = yield* register("Arthur M.");
          const listed = yield* client.participants.list({
            params: { code: room.code },
          });

          expect(listed).toEqual([second.participant]);
          expect(second.participant.nickname).toBe("Arthur M.");
          expect(second.participant.joinedAt).toBe(first.participant.joinedAt);
          expect(second.tunnel.token).not.toBe(first.tunnel.token);
        })
    );
  }
);
