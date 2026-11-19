import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

/** A server on a free loopback port that answers every request with `respond`. */
const serverThatAnswers = (respond: () => Response) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({ fetch: respond, hostname: "127.0.0.1", port: 0 })
    ),
    (server) => Effect.promise(() => server.stop(true))
  ).pipe(Effect.map((server) => `http://127.0.0.1:${server.port}`));

/** A loopback URL nothing listens on. */
const closedPort = Effect.scoped(serverThatAnswers(() => new Response()));

// Live: each test talks to a real socket.
it.live("a server that answers 404 without an envelope is not a hub", () =>
  Effect.gen(function* () {
    const url = yield* serverThatAnswers(
      () => new Response("Not Found", { status: 404 })
    );

    const result = yield* runCommand(["room", "list", "--hub", url]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("undefined");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "NotAHub",
      message: `The server at ${url} did not answer like a Gambi hub (HTTP 404).`,
      details: { hubUrl: url, status: 404 },
    });
  })
);

it.live("a server that answers 200 with a web page is not a hub", () =>
  Effect.gen(function* () {
    const url = yield* serverThatAnswers(
      () =>
        new Response("<html><body>router admin</body></html>", {
          headers: { "content-type": "text/html" },
        })
    );

    const result = yield* runCommand([
      "room",
      "get",
      "--code",
      "ABC123",
      "--hub",
      url,
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).not.toContain("undefined");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "NotAHub",
      message: `The server at ${url} did not answer like a Gambi hub.`,
    });
  })
);

it.live("a hub that is not running is a connectivity failure", () =>
  Effect.gen(function* () {
    const url = yield* closedPort;

    const result = yield* runCommand(["room", "list", "--hub", url]);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "HubUnreachable",
      message: `Could not reach a hub at ${url}.`,
    });
  })
);
