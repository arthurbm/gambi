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
import { it, layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand, startCommand } from "./testing.ts";
import { CLI_VERSION } from "./version.ts";

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

    it.effect.each([
      { flag: "--header", value: " =valor" },
      { flag: "--header", value: "Authorization=   " },
      { flag: "--header-env", value: " =MINHA_CHAVE" },
    ])(
      "$flag with a blank name or value is invalid usage, and the provider is never called",
      ({ flag, value }) =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Header em branco");

          const result = yield* runCommand(
            joinWithEndpoint(hub.url, room.code, provider.url, flag, value),
            { env: { MINHA_CHAVE: "segredo" } }
          );

          // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
          expect(result.exitCode).toBe(2);
          // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
          expect(JSON.parse(result.stderr).error).toMatchObject({
            name: "InvalidValue",
            details: { option: flag.slice(2), value },
          });
          // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
          expect(yield* provider.calls).toEqual([]);
        })
    );

    it.effect(
      "--nickname and --config say how the room sees the participant",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Perfil");

          const joining = yield* startCommand(
            joinWithEndpoint(
              hub.url,
              room.code,
              provider.url,
              "--nickname",
              "Arthur",
              "--config",
              "-"
            ),
            {
              stdin: JSON.stringify({
                temperature: 0.2,
                instructions: "Seja breve.",
              }),
            }
          );

          expect((yield* joining.nextEvent).data.participant).toMatchObject({
            nickname: "Arthur",
            config: { temperature: 0.2, hasInstructions: true },
          });
        })
    );

    it.effect("--password opens a protected room and is never written", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = yield* managementClient;
        const provider = yield* fakeProvider();
        const { room } = yield* client.rooms.create({
          payload: { name: "Fechada", password: "senha-da-sala" },
        });

        const wrong = yield* runCommand(
          joinWithEndpoint(hub.url, room.code, provider.url, "-p", "errada")
        );
        expect(wrong.exitCode).toBe(4);
        expect(JSON.parse(wrong.stderr).error).toMatchObject({
          name: "InvalidPassword",
          hint: "Provide the room password and retry.",
        });

        const joining = yield* startCommand(
          joinWithEndpoint(
            hub.url,
            room.code,
            provider.url,
            "--password",
            "senha-da-sala"
          )
        );
        expect((yield* joining.nextEvent).type).toBe("registered");
        yield* joining.signal("SIGINT");
        const { exitCode, stderr, stdout } = yield* joining.result;
        expect(exitCode).toBe(0);
        expect(`${stdout}${stderr}`).not.toContain("senha-da-sala");
      })
    );

    it.effect("a room that does not exist is a remote rejection", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const provider = yield* fakeProvider();

        const result = yield* runCommand(
          joinWithEndpoint(hub.url, "NOPE00", provider.url)
        );

        expect(result.exitCode).toBe(4);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr).error).toMatchObject({
          name: "RoomNotFound",
          details: { roomCode: "NOPE00" },
          exitCode: 4,
        });
      })
    );

    it.effect("a hub that is not running is a connectivity failure", () =>
      Effect.gen(function* () {
        const provider = yield* fakeProvider();
        const hubUrl = yield* closedPort;

        const result = yield* runCommand(
          joinWithEndpoint(hubUrl, "ABC123", provider.url)
        );

        expect(result.exitCode).toBe(3);
        expect(result.stdout).toBe("");
        expect(JSON.parse(result.stderr).error).toMatchObject({
          name: "HubUnreachable",
          message: `Could not reach a hub at ${hubUrl}.`,
          hint: "Check that the hub is running (`gambi hub serve`) and that --hub, or GAMBI_HUB, points at it.",
        });
      })
    );

    it.effect(
      "--dry-run prints what would be registered and joins nothing",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = yield* fakeProvider();
          const room = yield* createRoom("Ensaio");

          const result = yield* runCommand(
            joinWithEndpoint(
              hub.url,
              room.code,
              provider.url,
              "--password",
              "senha-da-sala",
              "--header",
              "Authorization=Bearer segredo",
              "--dry-run"
            )
          );

          expect(result).toMatchObject({ exitCode: 0, stderr: "" });
          expect(JSON.parse(result.stdout).data).toEqual({
            hubUrl: hub.url,
            roomCode: room.code,
            participantId: "arthur-1",
            password: "[redacted]",
            authHeaders: { Authorization: "[redacted]" },
            profile: {
              nickname: `${FAKE_MODEL}@arthur`,
              model: FAKE_MODEL,
              endpoint: provider.url,
              capabilities: {
                chatCompletions: "supported",
                openResponses: "supported",
              },
            },
          });
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );
  }
);

it.effect(
  "without a terminal a missing --model is an error, never a prompt",
  () =>
    Effect.gen(function* () {
      const provider = yield* fakeProvider();

      const result = yield* runCommand([
        "participant",
        "join",
        "--room",
        "ABC123",
        "--participant-id",
        "arthur-1",
        "--endpoint",
        provider.url,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "MissingOption",
        message: "Missing required flag: --model",
      });
      expect(yield* provider.calls).toEqual([]);
    })
);

it.effect(
  "on a terminal it asks for the room, the participant id and one of the endpoint's models",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const provider = yield* fakeProvider();
      const room = yield* createRoom("Perguntada");

      const joining = yield* startCommand(
        [
          "participant",
          "join",
          "--endpoint",
          provider.url,
          "--no-specs",
          "--hub",
          hub.url,
          "--log-level",
          "none",
        ],
        // Enter on the list of models takes the first one.
        { tty: true, answers: [room.code, "arthur-1", ""] }
      );

      expect(yield* joining.nextLine).toBe(
        `Registered ${FAKE_MODEL}@arthur (arthur-1) in room ${room.code}.`
      );
      expect(yield* joining.nextLine).toBe(
        "Tunnel connected. Press Ctrl+C to leave."
      );
      yield* joining.signal("SIGINT");
      expect(yield* joining.nextLine).toBe(
        `Leaving room ${room.code} (SIGINT)...`
      );
      expect(yield* joining.nextLine).toBe(`Left room ${room.code}.`);
      const result = yield* joining.result;
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.terminal).toContain("Room code");
      expect(result.terminal).toContain("Participant id");
      expect(result.terminal).toContain("Model to share");
    }).pipe(Effect.provide(layerHub()))
);

it.effect(
  "a server that is not a hub is named as that, not as unreachable",
  () =>
    Effect.gen(function* () {
      const provider = yield* fakeProvider();
      const notAHub = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () => new Response("Not Found", { status: 404 }),
          })
        ),
        (server) => Effect.promise(() => server.stop(true))
      );
      const url = `http://127.0.0.1:${notAHub.port}`;

      const result = yield* runCommand(
        joinWithEndpoint(url, "ABC123", provider.url)
      );

      expect(result).toMatchObject({ exitCode: 3, stdout: "" });
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "NotAHub",
        message: `The server at ${url} did not answer like a Gambi hub (HTTP 404).`,
      });
    })
);

it.effect("an empty --nickname or --model is invalid usage", () =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider();

    const nickname = yield* runCommand(
      joinWithEndpoint(
        "http://127.0.0.1:9",
        "ABC123",
        provider.url,
        "--nickname",
        ""
      )
    );
    expect(nickname).toMatchObject({ exitCode: 2, stdout: "" });
    expect(JSON.parse(nickname.stderr).error).toMatchObject({
      name: "InvalidValue",
      details: { option: "nickname" },
    });

    const model = yield* runCommand([
      "participant",
      "join",
      "--room",
      "ABC123",
      "--participant-id",
      "arthur-1",
      "--model",
      "",
    ]);
    expect(model).toMatchObject({ exitCode: 2, stdout: "" });
    expect(JSON.parse(model.stderr).error).toMatchObject({
      name: "InvalidValue",
      details: { option: "model" },
    });
  })
);

it.effect("--endpoint that is not a URL is invalid usage", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(
      joinWithEndpoint("http://127.0.0.1:9", "ABC123", "localhost:11434")
    );

    expect(result).toMatchObject({ exitCode: 2, stdout: "" });
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "InvalidValue",
      details: { option: "endpoint", value: "localhost:11434" },
    });
  })
);

it.effect("there is no heartbeat command", () =>
  Effect.gen(function* () {
    const heartbeat = yield* runCommand(["participant", "heartbeat"]);
    expect(heartbeat).toMatchObject({ exitCode: 2, stdout: "" });
    expect(JSON.parse(heartbeat.stderr).error.name).toBe("UnknownSubcommand");

    const help = yield* runCommand(["participant", "--help"]);
    expect(help.stdout).toContain("join");
    expect(help.stdout).toContain("leave");
    expect(help.stdout).not.toContain("heartbeat");
  })
);

it.effect(
  "a hub of another minor version refuses the participant and says which version it expects",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const provider = yield* fakeProvider();
      const room = yield* createRoom("Outra versão");

      const result = yield* runCommand(
        joinWithEndpoint(hub.url, room.code, provider.url)
      );

      expect(result.exitCode).toBe(4);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).error).toMatchObject({
        name: "VersionMismatch",
        message: `This hub runs Gambi 9.4.1 and expects participants on 9.4.x; this participant runs ${CLI_VERSION}.`,
        hint: "Install Gambi 9.4 on the participant's machine, or update the hub, so both are on the same minor version.",
        exitCode: 4,
      });
      expect(yield* participantsOf(room.code)).toEqual([]);
    }).pipe(Effect.provide(layerHub({ version: "9.4.1" })))
);
