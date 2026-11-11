import { expect } from "bun:test";
import { managementOpenApi, RoomNotFound } from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import { Effect, Layer, Logger, Tracer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { layerHub, managementClient } from "../testing/hub.ts";
import { Hub } from "./hub.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROOM_CODE = /^[0-9A-Z]{6}$/;
const OPENAPI_3 = /^3\./;

/** A raw request to the hub, for what the derived client hides: the envelope on the wire. */
const raw = (request: (url: string) => HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const response = yield* HttpClient.execute(request(hub.url));
    return { status: response.status, body: yield* response.json };
  });

layer(layerHub(), { excludeTestServices: true })("management plane", (it) => {
  it.effect("answers health through the derived client", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;

      const health = yield* client.hub.health();

      expect(health.status).toBe("ok");
      expect(health.timestamp).toBeGreaterThan(1_700_000_000_000);
    })
  );

  it.effect("wraps a success in the envelope, with a request id", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.get(`${url}/v1/health`)
      );

      expect(status).toBe(200);
      expect(body).toEqual({
        data: { status: "ok", timestamp: expect.any(Number) },
        meta: { requestId: expect.stringMatching(UUID) },
      });
    })
  );

  it.effect("creates a room and reads it back by code", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;

      const created = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });
      const read = yield* client.rooms.get({
        params: { code: created.room.code },
      });

      expect(created.room.code).toMatch(ROOM_CODE);
      expect(created.hostId).toBe(created.room.hostId);
      expect(read).toEqual({
        id: created.room.id,
        code: created.room.code,
        name: "Frevo",
        hostId: created.hostId,
        createdAt: expect.any(Number),
        passwordProtected: false,
        participantCount: 0,
      });
    })
  );

  it.effect("answers 201 with the created room in the envelope", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.post(`${url}/v1/rooms`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ name: "Maracatu" })
        )
      );

      expect(status).toBe(201);
      expect(body).toEqual({
        data: {
          room: {
            id: expect.stringMatching(UUID),
            code: expect.stringMatching(ROOM_CODE),
            name: "Maracatu",
            hostId: expect.stringMatching(UUID),
            createdAt: expect.any(Number),
            passwordProtected: false,
            participantCount: 0,
          },
          hostId: expect.stringMatching(UUID),
        },
        meta: { requestId: expect.stringMatching(UUID) },
      });
      expect(
        Object.keys((body as { data: { room: object } }).data.room)
      ).not.toContain("defaults");
    })
  );

  it.effect("lists the rooms it holds", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const first = yield* client.rooms.create({ payload: { name: "Um" } });
      const second = yield* client.rooms.create({ payload: { name: "Dois" } });

      const codes = (yield* client.rooms.list()).map((room) => room.code);

      expect(codes).toContain(first.room.code);
      expect(codes).toContain(second.room.code);
    })
  );

  it.effect("finds a room whatever the letter case of the code", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const created = yield* client.rooms.create({ payload: { name: "Coco" } });

      const read = yield* client.rooms.get({
        params: { code: created.room.code.toLowerCase() },
      });

      expect(read.id).toBe(created.room.id);
    })
  );

  it.effect("never shows the password or the instructions of a room", () =>
    Effect.gen(function* () {
      const { body } = yield* raw((url) =>
        HttpClientRequest.post(`${url}/v1/rooms`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            name: "Ciranda",
            password: "segredo-da-sala",
            defaults: { temperature: 0.2, instructions: "Responda em verso." },
          })
        )
      );

      expect(body).toMatchObject({
        data: {
          room: {
            passwordProtected: true,
            defaults: { temperature: 0.2, hasInstructions: true },
          },
        },
      });
      const wire = JSON.stringify(body);
      expect(wire).not.toContain("segredo-da-sala");
      expect(wire).not.toContain("Responda em verso.");
      expect(wire).not.toContain("pbkdf2");
    })
  );

  it.effect("fails with RoomNotFound for a code no room has", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;

      const error = yield* client.rooms
        .get({ params: { code: "NOPE00" } })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(RoomNotFound);
      expect(error).toMatchObject({
        _tag: "RoomNotFound",
        roomCode: "NOPE00",
        message: "Room 'NOPE00' was not found.",
        requestId: expect.stringMatching(UUID),
      });
    })
  );

  it.effect("answers 404 with ROOM_NOT_FOUND in the error envelope", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.get(`${url}/v1/rooms/NOPE00`)
      );

      expect(status).toBe(404);
      expect(body).toEqual({
        error: {
          code: "ROOM_NOT_FOUND",
          message: "Room 'NOPE00' was not found.",
          hint: expect.any(String),
          details: { roomCode: "NOPE00" },
        },
        meta: { requestId: expect.stringMatching(UUID) },
      });
    })
  );

  it.effect("answers 400 with INVALID_REQUEST and where the problem is", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.post(`${url}/v1/rooms`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ password: "x" })
        )
      );

      expect(status).toBe(400);
      expect(body).toMatchObject({
        error: {
          code: "INVALID_REQUEST",
          details: { issues: [{ path: ["payload", "name"] }] },
        },
        meta: { requestId: expect.stringMatching(UUID) },
      });
    })
  );

  it.effect("fails with InvalidRequest for a body that is not JSON", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.post(`${url}/v1/rooms`).pipe(
          HttpClientRequest.bodyText("{not json", "application/json")
        )
      );

      expect(status).toBe(400);
      expect(body).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    })
  );

  it.effect("serves the OpenAPI document generated from the contract", () =>
    Effect.gen(function* () {
      const { status, body } = yield* raw((url) =>
        HttpClientRequest.get(`${url}/v1/openapi.json`)
      );

      expect(status).toBe(200);
      expect(body).toEqual(JSON.parse(JSON.stringify(managementOpenApi())));
      expect(body).toMatchObject({
        openapi: expect.stringMatching(OPENAPI_3),
        paths: {
          "/v1/health": { get: { operationId: "hub.health" } },
          "/v1/rooms": {
            get: { operationId: "rooms.list" },
            post: { operationId: "rooms.create" },
          },
          "/v1/rooms/{code}": {
            get: {
              operationId: "rooms.get",
              responses: { "200": {}, "400": {}, "404": {}, "500": {} },
            },
          },
        },
      });
    })
  );
});

it.live("logs each operation with structure and runs it in a named span", () =>
  Effect.gen(function* () {
    const logs: { message: unknown; annotations: Record<string, unknown> }[] =
      [];
    const spans: string[] = [];
    const native = yield* Effect.tracer;
    const tracer = Tracer.make({
      span(options) {
        spans.push(options.name);
        return native.span(options);
      },
    });
    const capture = Logger.make<unknown, void>((options) => {
      const { message, annotations } = Logger.formatStructured.log(options);
      logs.push({ message, annotations });
    });

    yield* Effect.gen(function* () {
      const client = yield* managementClient;
      const created = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });

      expect(logs).toContainEqual({
        message: "room created",
        annotations: {
          requestId: expect.stringMatching(UUID),
          roomCode: created.room.code,
          passwordProtected: false,
        },
      });
      expect(logs.map((log) => log.message)).toContain("hub listening");
      expect(spans).toContain("Rooms.create");
    }).pipe(
      Effect.provide(
        layerHub({ loggers: [capture] }).pipe(
          Layer.provide(Layer.succeed(Tracer.Tracer, tracer))
        )
      )
    );
  })
);
