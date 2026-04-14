import { describe, expect, test } from "bun:test";
import { parseRoomSort } from "./room-list.ts";

describe("room list sort parsing", () => {
  test("accepts supported sort values", () => {
    expect(parseRoomSort("participant-count")).toBe("participant-count");
    expect(parseRoomSort("created-at")).toBe("created-at");
    expect(parseRoomSort("name")).toBe("name");
  });

  test("rejects unsupported sort values", () => {
    expect(parseRoomSort("random")).toBeNull();
  });
});
