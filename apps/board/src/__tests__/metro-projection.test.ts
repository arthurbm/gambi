import { describe, expect, test } from "bun:test";

import {
  projectStationNormalized,
  projectStationToPixels,
} from "../domain/metro";

describe("metro station projection", () => {
  test("maps the world origin to the center of a tile", () => {
    expect(projectStationNormalized(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  test("keeps every allowed manifest corner inside the viewport", () => {
    for (const x of [-4.5, 4.5]) {
      for (const z of [-4.5, 4.5]) {
        const point = projectStationNormalized(x, z);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(1);
      }
    }
  });

  test("scales pixels without changing normalized station coordinates", () => {
    const normalized = projectStationNormalized(2, -1);
    const small = projectStationToPixels({
      stationX: 2,
      stationZ: -1,
      viewport: { left: 10, top: 20, width: 200, height: 100 },
      container: { left: 10, top: 20 },
    });
    const large = projectStationToPixels({
      stationX: 2,
      stationZ: -1,
      viewport: { left: 10, top: 20, width: 400, height: 200 },
      container: { left: 10, top: 20 },
    });

    expect(small).toEqual({ x: normalized.x * 200, y: normalized.y * 100 });
    expect(large).toEqual({ x: normalized.x * 400, y: normalized.y * 200 });
  });
});
