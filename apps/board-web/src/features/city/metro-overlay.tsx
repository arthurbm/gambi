import { projectStationToPixels } from "@gambi/board/metro";
import { useLayoutEffect, useRef, useState } from "react";

import type { BoardState } from "@/lib/orpc";

type Squad = BoardState["squads"][number];
type Tile = BoardState["tiles"][number];

interface MetroPoint {
  x: number;
  y: number;
  label: string;
  squadId: string;
  connected: boolean;
}

function measureMetro(container: HTMLElement, squads: Squad[], tiles: Tile[]) {
  const containerRect = container.getBoundingClientRect();
  const tilesBySquad = new Map(tiles.map((tile) => [tile.squadId, tile]));
  const points = squads.map<MetroPoint | null>((squad) => {
    const parcel = container.querySelector<HTMLElement>(
      `[data-city-parcel][data-squad-id="${CSS.escape(squad.id)}"]`
    );
    const viewport = parcel?.querySelector<HTMLElement>("[data-tile-viewport]");
    if (!(parcel && viewport)) {
      return null;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const tile = tilesBySquad.get(squad.id);
    const station = tile?.manifest?.station;
    const broken = parcel.dataset.tileBroken === "true";
    if (station && !broken) {
      return {
        ...projectStationToPixels({
          stationX: station.x,
          stationZ: station.z,
          viewport: viewportRect,
          container: containerRect,
        }),
        label: station.name,
        squadId: squad.id,
        connected: true,
      };
    }
    return {
      x: viewportRect.left - containerRect.left + viewportRect.width / 2,
      y: viewportRect.top - containerRect.top + viewportRect.height / 2,
      label: "Fora da rede",
      squadId: squad.id,
      connected: false,
    };
  });
  return {
    width: containerRect.width,
    height: containerRect.height,
    points: points.filter((point): point is MetroPoint => point !== null),
  };
}

export function MetroOverlay({
  squads,
  tiles,
}: {
  squads: Squad[];
  tiles: Tile[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof measureMetro>>({
    width: 1,
    height: 1,
    points: [],
  });
  useLayoutEffect(() => {
    const overlay = container.current;
    const map = overlay?.parentElement;
    if (!(overlay && map)) {
      return;
    }
    let animationFrame = 0;
    const update = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setLayout(measureMetro(map, squads, tiles));
      });
    };
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(map);
    for (const viewport of map.querySelectorAll("[data-tile-viewport]")) {
      resizeObserver.observe(viewport);
    }
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(map, {
      attributes: true,
      attributeFilter: ["data-tile-broken"],
      subtree: true,
    });
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [squads, tiles]);

  const connected = layout.points.filter((point) => point.connected);
  const polyline = connected.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="metro-overlay" data-metro-overlay ref={container}>
      <svg
        aria-label="Linha do metrô entre os bairros"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        {connected.length > 1 ? (
          <polyline className="metro-line" points={polyline} />
        ) : null}
        {layout.points.map((point) => (
          <g
            className={point.connected ? "metro-stop" : "metro-stop offline"}
            key={point.squadId}
            transform={`translate(${point.x} ${point.y})`}
          >
            {point.connected ? (
              <circle r="6" />
            ) : (
              <path d="M-7 -7 L7 7 M7 -7 L-7 7" />
            )}
            <text x="10" y={point.connected ? -8 : 4}>
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
