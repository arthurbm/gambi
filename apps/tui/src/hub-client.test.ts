import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createRoom, hubClient } from "./hub-client";

layer(layerHub(), { excludeTestServices: true })("hub client", (it) => {
  it.effect(
    "creates a room from a form that left the optional fields empty",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = hubClient(hub.url);

        // What the create-room screen sends when only the name was typed.
        const created = yield* Effect.promise(() =>
          createRoom(client, {
            name: "Frevo",
            password: undefined,
            defaults: undefined,
          })
        );
        const rooms = yield* Effect.promise(() => client.rooms.list());

        expect(created.room.name).toBe("Frevo");
        expect(created.room.passwordProtected).toBe(false);
        expect(rooms.map((room) => room.code)).toContain(created.room.code);
      })
  );

  it.effect("hands out one client per hub", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      expect(hubClient(hub.url)).toBe(hubClient(hub.url));
      expect(hubClient(hub.url)).not.toBe(hubClient("http://127.0.0.1:1"));
    })
  );
});
