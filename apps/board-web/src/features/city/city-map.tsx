import { Link } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { BoardState } from "@/lib/orpc";
import { MetroOverlay } from "./metro-overlay";
import { nextTileLoadStatus, type TileLoadStatus } from "./tile-load-state";

type Squad = BoardState["squads"][number];
type Tile = BoardState["tiles"][number];

const READY_TIMEOUT_MS = 5000;

function plateDescription(tile: Tile | undefined) {
  const readmeLine = tile?.readme
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  return readmeLine ?? tile?.manifest?.description ?? "Aguardando publicação.";
}

function parcelStatus(input: {
  broken: boolean;
  hasMembers: boolean;
  tile?: Tile;
}) {
  if (input.broken) {
    return { label: "Falha no tile", variant: "destructive" as const };
  }
  if (input.tile) {
    return {
      label: `v${input.tile.boardVersion} no ar`,
      variant: "default" as const,
    };
  }
  return {
    label: "Lote vazio",
    variant: input.hasMembers ? ("secondary" as const) : ("outline" as const),
  };
}

function parcelProvenance(squad: Squad, tile: Tile | undefined) {
  if (tile) {
    return `${tile.sourceHarnessId} · ${tile.sourceModel ?? "modelo local"}`;
  }
  if (squad.members.length) {
    const peopleLabel = squad.members.length === 1 ? "pessoa" : "pessoas";
    return `${squad.members.length} ${peopleLabel} · sem publicação`;
  }
  return "Squad em formação";
}

function EmptyLot({ broken = false }: { broken?: boolean }) {
  return (
    <div aria-hidden="true" className="measured-empty-lot" data-broken={broken}>
      <span />
      <span />
      <span />
      <span />
      <span />
      {broken ? <CircleAlertIcon /> : null}
    </div>
  );
}

function TileSurface({
  onBroken,
  squad,
  tile,
}: {
  onBroken: () => void;
  squad: Squad;
  tile?: Tile;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<TileLoadStatus>(
    tile ? "loading" : "ready"
  );

  useEffect(() => {
    if (!tile) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setStatus((current) => nextTileLoadStatus(current, "timeout"));
      onBroken();
    }, READY_TIMEOUT_MS);
    const receiveStatus = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== "null" ||
        typeof event.data !== "object" ||
        event.data === null ||
        event.data.type !== "gambi.tile.status" ||
        event.data.tileId !== tile.id ||
        event.data.boardVersion !== tile.boardVersion
      ) {
        return;
      }
      if (event.data.status === "ready") {
        window.clearTimeout(timeout);
        setStatus((current) => nextTileLoadStatus(current, "ready"));
      } else if (event.data.status === "error") {
        window.clearTimeout(timeout);
        setStatus((current) => nextTileLoadStatus(current, "error"));
        onBroken();
      }
    };
    window.addEventListener("message", receiveStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveStatus);
    };
  }, [onBroken, tile]);

  if (!tile || status === "broken") {
    return <EmptyLot broken={status === "broken"} />;
  }

  return (
    <div className="tile-publication" key={tile.id}>
      <iframe
        aria-label={`Tile no ar de ${squad.name}`}
        className="tile-frame"
        ref={iframe}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        src={`/tiles/${encodeURIComponent(squad.id)}/live/index.html?v=${tile.boardVersion}`}
        title={`Bairro ${tile.manifest?.name ?? squad.name}`}
      />
      {status === "loading" ? (
        <span aria-live="polite" className="tile-loading">
          Conferindo tile…
        </span>
      ) : null}
    </div>
  );
}

function CityParcel({ squad, tile }: { squad: Squad; tile?: Tile }) {
  const [broken, setBroken] = useState(false);
  const station = tile?.manifest?.station;
  const handleBroken = useCallback(() => setBroken(true), []);
  const status = parcelStatus({
    broken,
    hasMembers: squad.members.length > 0,
    tile,
  });

  return (
    <article
      className="parcel"
      data-board-version={tile?.boardVersion}
      data-city-parcel
      data-squad-id={squad.id}
      data-station-name={station?.name}
      data-station-x={station?.x}
      data-station-z={station?.z}
      data-tile-broken={broken || undefined}
      data-tile-id={tile?.id}
    >
      <div className="parcel-number">
        {String(squad.ordinal).padStart(2, "0")}
      </div>
      <div className="tile-viewport" data-tile-viewport>
        <TileSurface onBroken={handleBroken} squad={squad} tile={tile} />
      </div>
      <div className="parcel-plate">
        <div className="parcel-plate-heading">
          <h3>
            <Link params={{ id: squad.id }} to="/squad/$id">
              {tile?.manifest?.name ?? squad.name}
            </Link>
          </h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="parcel-provenance">{parcelProvenance(squad, tile)}</p>
        <p className="parcel-description">
          {broken
            ? "O script não abriu. O lote medido continua reservado para este squad."
            : plateDescription(tile)}
        </p>
      </div>
    </article>
  );
}

export function CityMap({
  revision,
  squads,
  theme,
  tiles,
  showMetro = false,
}: {
  revision: number;
  squads: Squad[];
  theme: string;
  tiles: Tile[];
  showMetro?: boolean;
}) {
  const tilesBySquad = new Map(tiles.map((tile) => [tile.squadId, tile]));

  return (
    <section aria-labelledby="city-title" className="city-sheet">
      <header className="plan-heading">
        <div>
          <p>Planta cadastral</p>
          <h2 id="city-title">{theme}</h2>
        </div>
        <dl>
          <div>
            <dt>Escala</dt>
            <dd>1:1000</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{revision}</dd>
          </div>
        </dl>
      </header>
      <div className="parcel-map">
        <svg aria-hidden="true" className="survey-lines" viewBox="0 0 1000 640">
          <path d="M20 76 L982 28 M5 534 L988 591 M152 8 L88 632 M838 4 L914 634" />
          <path d="M0 310 C210 278 345 350 530 318 S807 244 1000 292" />
        </svg>
        <div className="parcel-grid" data-city-grid data-count={squads.length}>
          {squads.map((squad) => {
            const tile = tilesBySquad.get(squad.id);
            return (
              <CityParcel
                key={`${squad.id}:${tile?.id ?? "empty"}`}
                squad={squad}
                tile={tile}
              />
            );
          })}
        </div>
        {showMetro ? <MetroOverlay squads={squads} tiles={tiles} /> : null}
      </div>
    </section>
  );
}
