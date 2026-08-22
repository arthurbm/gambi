export type TileLoadStatus = "loading" | "ready" | "broken";

export function nextTileLoadStatus(
  current: TileLoadStatus,
  event: "error" | "ready" | "timeout"
): TileLoadStatus {
  if (current === "broken") {
    return "broken";
  }
  return event === "ready" ? "ready" : "broken";
}
