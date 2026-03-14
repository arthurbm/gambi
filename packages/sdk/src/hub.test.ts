import { describe, expect, test } from "bun:test";
import { hub } from "./hub.ts";

function getRandomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createHubWithRetry() {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return hub.create({ port: getRandomPort(), hostname: "127.0.0.1" });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

describe("SDK hub namespace", () => {
  test("re-exports createHub", () => {
    expect(hub.create).toBeDefined();
  });

  test("creates a hub", () => {
    const myHub = createHubWithRetry();

    expect(myHub.server).toBeDefined();
    expect(myHub.url.startsWith("http://127.0.0.1:")).toBe(true);
    expect(myHub.close).toBeDefined();

    myHub.close();
  });
});
