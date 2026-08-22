import { describe, expect, test } from "bun:test";
import { exists, rm } from "node:fs/promises";
import { createDatabasePlan, parseEventArgs } from "./event";

describe("event supervisor", () => {
  test("parses production and deterministic E2E modes", () => {
    expect(parseEventArgs([])).toEqual({ ephemeral: false, fake: false });
    expect(parseEventArgs(["--fake", "--ephemeral"])).toEqual({
      ephemeral: true,
      fake: true,
    });
    expect(() => parseEventArgs(["--unknown"])).toThrow("Unknown option");
  });

  test("keeps an explicit database URL", async () => {
    expect(
      await createDatabasePlan({
        configuredUrl: "file:/tmp/event.db",
        ephemeral: true,
        roomCode: "ABC123",
      })
    ).toEqual({
      displayPath: "file:/tmp/event.db",
      url: "file:/tmp/event.db",
    });
  });

  test("creates an isolated database directory for E2E", async () => {
    const plan = await createDatabasePlan({
      ephemeral: true,
      roomCode: "ABC123",
    });
    expect(plan.cleanupDirectory).toBeDefined();
    expect(plan.url).toStartWith("file:/");
    expect(await exists(plan.cleanupDirectory as string)).toBe(true);
    await rm(plan.cleanupDirectory as string, { recursive: true });
  });
});
