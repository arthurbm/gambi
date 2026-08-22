import { asc, desc, eq } from "drizzle-orm";

import { type TileManifest, tileManifestSchema } from "../tile-artifacts";
import type { BoardDatabase } from "./client";
import { tilePublications, tiles } from "./schema";

export interface TileVersionView {
  id: string;
  squadId: string;
  roundId: string | null;
  dispatchId: string | null;
  boardVersion: number;
  sourceParticipantId: string;
  sourceSessionId: string;
  sourceVersion: number;
  sourceHarnessId: string;
  sourceModel: string | null;
  sourceReason: string;
  manifest: TileManifest | null;
  readme: string | null;
  valid: boolean;
  validationError: string | null;
  authorPersonId: string | null;
  authorName: string | null;
  createdAt: string;
  isLive: boolean;
  publicationKind: string | null;
  publishedByName: string | null;
  publishedAt: string | null;
}

function parseManifest(value: string | null): TileManifest | null {
  if (!value) {
    return null;
  }
  try {
    const result = tileManifestSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export class TileRepository {
  private readonly db: BoardDatabase;

  constructor(db: BoardDatabase) {
    this.db = db;
  }

  async listVersions(squad?: string): Promise<TileVersionView[]> {
    const rows = await this.db
      .select({ tile: tiles, publication: tilePublications })
      .from(tiles)
      .leftJoin(tilePublications, eq(tilePublications.tileId, tiles.id))
      .orderBy(asc(tiles.squadId), desc(tiles.boardVersion));
    return rows
      .filter((row) => !squad || row.tile.squadId === squad)
      .map(({ tile, publication }) => ({
        id: tile.id,
        squadId: tile.squadId,
        roundId: tile.roundId,
        dispatchId: tile.dispatchId,
        boardVersion: tile.boardVersion,
        sourceParticipantId: tile.sourceParticipantId,
        sourceSessionId: tile.sourceSessionId,
        sourceVersion: tile.sourceVersion,
        sourceHarnessId: tile.sourceHarnessId,
        sourceModel: tile.sourceModel,
        sourceReason: tile.sourceReason,
        manifest: parseManifest(tile.manifestJson),
        readme: tile.readme,
        valid: tile.valid,
        validationError: tile.validationError,
        authorPersonId: tile.authorPersonId,
        authorName: tile.authorName,
        createdAt: tile.createdAt,
        isLive: publication !== null,
        publicationKind: publication?.publicationKind ?? null,
        publishedByName: publication?.publishedByName ?? null,
        publishedAt: publication?.publishedAt ?? null,
      }));
  }

  async listLive() {
    return (await this.listVersions()).filter((version) => version.isLive);
  }

  async getLiveDocument(squad: string) {
    const [row] = await this.db
      .select({ tile: tiles, publication: tilePublications })
      .from(tilePublications)
      .innerJoin(tiles, eq(tiles.id, tilePublications.tileId))
      .where(eq(tilePublications.squadId, squad));
    if (!(row?.tile.valid && row.tile.indexHtml)) {
      return null;
    }
    return {
      id: row.tile.id,
      squadId: row.tile.squadId,
      boardVersion: row.tile.boardVersion,
      indexHtml: row.tile.indexHtml,
      publishedAt: row.publication.publishedAt,
    };
  }
}
