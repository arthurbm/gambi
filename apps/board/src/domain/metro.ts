export interface NormalizedStationPoint {
  x: number;
  y: number;
}

export function projectStationNormalized(
  x: number,
  z: number
): NormalizedStationPoint {
  return {
    x: Math.min(1, Math.max(0, 0.5 + (x - z) / (12 * Math.SQRT2))),
    y: Math.min(1, Math.max(0, 0.5 + (x + z) / (12 * Math.sqrt(6)))),
  };
}

export function projectStationToPixels(input: {
  stationX: number;
  stationZ: number;
  viewport: { left: number; top: number; width: number; height: number };
  container: { left: number; top: number };
}) {
  const normalized = projectStationNormalized(input.stationX, input.stationZ);
  return {
    x:
      input.viewport.left -
      input.container.left +
      normalized.x * input.viewport.width,
    y:
      input.viewport.top -
      input.container.top +
      normalized.y * input.viewport.height,
  };
}
