import { describe, expect, test } from "bun:test";

import { nextTileLoadStatus } from "../../../board-web/src/features/city/tile-load-state";

describe("tile load state", () => {
  test("keeps a failed lot broken when a late ready event arrives", () => {
    const failed = nextTileLoadStatus("loading", "error");
    expect(nextTileLoadStatus(failed, "ready")).toBe("broken");
  });

  test("keeps a timed-out lot broken when a late ready event arrives", () => {
    const timedOut = nextTileLoadStatus("loading", "timeout");
    expect(nextTileLoadStatus(timedOut, "ready")).toBe("broken");
  });
});
