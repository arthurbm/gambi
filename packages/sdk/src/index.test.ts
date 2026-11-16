import { expect, test } from "bun:test";

test("the default entry exports the client, the provider and their error, and nothing that hosts a hub", async () => {
  const entry = await import("./index.ts");

  expect(Object.keys(entry).sort()).toEqual([
    "ClientError",
    "createClient",
    "createGambi",
  ]);
});
