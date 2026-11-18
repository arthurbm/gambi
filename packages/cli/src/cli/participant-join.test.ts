import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import {
  chatCompletionsOnly,
  FAKE_COMPLETION_TEXT,
  FAKE_MODEL,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { GAMBI_VERSION } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand, startCommand } from "./testing.ts";

/** A room of the hub of the block, for one test. */
const createRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return (yield* client.rooms.create({ payload: { name } })).room;
  });

/** A loopback URL nothing listens on. */
const closedPort = Effect.promise(async () => {
  const server = Bun.serve({
    fetch: () => new Response(),
    hostname: "127.0.0.1",
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  await server.stop(true);
  return url;
});

/** The participants of a room, as the hub lists them. */
const participantsOf = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return yield* client.participants.list({ params: { code: roomCode } });
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

    it.effect(
      "tells the room which inference APIs the endpoint answers, as probed on this machine",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          const room = yield* createRoom("Capacidades");

          const joining = yield* startCommand(
            joinWithEndpoint(hub.url, room.code, provider.url)
          );

          expect((yield* joining.nextEvent).data.participant).toMatchObject({
            capabilities: {
              chatCompletions: "supported",
              openResponses: "unsupported",
            },
          });
        })
    );

    it.effect(
      "a model the endpoint does not list fails before anything is registered",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Modelo errado");

          const result = yield* runCommand([
            "participant",
            "join",
            "--room",
            room.code,
            "--participant-id",
            "arthur-1",
            "--model",
            "llama-que-nao-existe",
            "--endpoint",
            provider.url,
            "--no-specs",
            "--hub",
            hub.url,
          ]);

          expect(result.exitCode).toBe(3);
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr).error).toMatchObject({
            name: "ModelNotOnEndpoint",
            message: `The endpoint ${provider.url} does not list the model 'llama-que-nao-existe'.`,
            hint: `Models it lists: ${FAKE_MODEL}.`,
            exitCode: 3,
          });
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect(
      "an endpoint where no provider answers is a connectivity failure",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const endpoint = yield* closedPort;
          const room = yield* createRoom("Sem provider");

          const result = yield* runCommand(
            joinWithEndpoint(hub.url, room.code, endpoint)
          );

          expect(result.exitCode).toBe(3);
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr).error).toMatchObject({
            name: "EndpointUnreachable",
            message: `No provider answered at ${endpoint}.`,
            details: { endpoint },
          });
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect(
      "--header and --header-env reach the provider and nothing else",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Com chave");
          const watch = yield* watchRoom(room.code);

          const joining = yield* startCommand(
            joinWithEndpoint(
              hub.url,
              room.code,
              provider.url,
              "--header",
              "Authorization=Bearer segredo-da-flag",
              "--header-env",
              "X-Api-Key=MINHA_CHAVE"
            ),
            { env: { MINHA_CHAVE: "segredo-do-ambiente" } }
          );
          yield* joining.nextEvent;
          yield* joining.nextEvent;

          // The probe that ran before the join carried them too.
          for (const call of yield* provider.calls) {
            expect(call.headers).toMatchObject({
              authorization: "Bearer segredo-da-flag",
              "x-api-key": "segredo-do-ambiente",
            });
          }
          yield* Effect.promise(() =>
            fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: "arthur-1", messages: [] }),
            }).then((response) => response.text())
          );
          expect((yield* provider.calls).at(-1)).toMatchObject({
            path: "/v1/chat/completions",
            headers: {
              authorization: "Bearer segredo-da-flag",
              "x-api-key": "segredo-do-ambiente",
            },
          });

          yield* joining.signal("SIGINT");
          const { stderr, stdout } = yield* joining.result;
          const seenByTheRoom = JSON.stringify([
            yield* watch.next,
            yield* watch.next,
          ]);
          for (const text of [stdout, stderr, seenByTheRoom]) {
            expect(text).not.toContain("segredo");
          }
        })
    );

    it.effect(
      "--header-env naming a variable that is not set is invalid usage",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Sem variável");

          const result = yield* runCommand(
            joinWithEndpoint(
              hub.url,
              room.code,
              provider.url,
              "--header-env",
              "X-Api-Key=NAO_EXISTE"
            )
          );

          expect(result.exitCode).toBe(2);
          expect(result.stdout).toBe("");
          expect(JSON.parse(result.stderr).error).toMatchObject({
            name: "InvalidValue",
            details: { option: "header-env", value: "X-Api-Key=NAO_EXISTE" },
          });
          expect(yield* provider.calls).toEqual([]);
        })
    );
  }
);
