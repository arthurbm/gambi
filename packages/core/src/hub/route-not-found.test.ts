import { expect } from "bun:test";
import { GAMBI_VERSION, managementOpenApi } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { layerHub, managementClient } from "../testing/hub.ts";
import { Hub } from "./hub.ts";

/** A raw request to the hub: the status and the JSON on the wire. */
const raw = (request: (url: string) => HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const response = yield* HttpClient.execute(request(hub.url));
    return { status: response.status, body: yield* response.json };
  });

layer(layerHub(), { excludeTestServices: true })(
  "routes the management plane does not have",
  (it) => {
    it.effect(
      "a route that does not exist answers the error envelope, with a code of its own",
      () =>
        Effect.gen(function* () {
          const answer = yield* raw((url) =>
            HttpClientRequest.get(`${url}/v1/nothing/here?x=1`)
          );

          expect(answer.status).toBe(404);
          expect(answer.body).toEqual({
            error: {
              code: "ROUTE_NOT_FOUND",
              message: "This hub has no route GET /v1/nothing/here.",
              hint: "Check the path and the method against the management contract, served at /v1/openapi.json. A hub of another version may not have this route.",
              details: { method: "GET", path: "/v1/nothing/here" },
            },
            meta: { requestId: expect.any(String) },
          });
        })
    );

    it.effect(
      "a path that exists, asked with a method it does not have, is a route that does not exist",
      () =>
        Effect.gen(function* () {
          const answer = yield* raw((url) =>
            HttpClientRequest.delete(`${url}/v1/rooms`)
          );

          expect(answer.status).toBe(404);
          expect(answer.body).toMatchObject({
            error: {
              code: "ROUTE_NOT_FOUND",
              details: { method: "DELETE", path: "/v1/rooms" },
            },
          });
        })
    );

    it.effect("the hub has no heartbeat endpoint", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        yield* client.participants.register({
          params: { code: room.code, id: "arthur-1" },
          payload: {
            nickname: "Arthur",
            model: "llama3.1:8b",
            version: GAMBI_VERSION,
          },
        });

        const answer = yield* raw((url) =>
          HttpClientRequest.post(
            `${url}/v1/rooms/${room.code}/participants/arthur-1/heartbeat`
          )
        );

        expect(answer.status).toBe(404);
        expect(answer.body).toMatchObject({
          error: { code: "ROUTE_NOT_FOUND" },
        });
        // Nor does the contract: no path of the OpenAPI document is one.
        const paths = Object.keys(managementOpenApi().paths);
        expect(paths.length).toBeGreaterThan(0);
        expect(paths.filter((path) => path.includes("heartbeat"))).toEqual([]);
        // The participant's status never depended on it.
        expect(
          (yield* client.participants.list({
            params: { code: room.code },
          })).map((participant) => participant.status)
        ).toEqual(["offline"]);
      })
    );

    it.effect("the routes that exist are not shadowed", () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const openapi = yield* raw((url) =>
          HttpClientRequest.get(`${url}/v1/openapi.json`)
        );

        expect((yield* client.hub.health()).status).toBe("ok");
        expect(openapi.status).toBe(200);
      })
    );
  }
);
