import type { HarnessArtifactFile } from "@gambi/agents";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  type BoardPhase,
  isBoardPhase,
  nextPhase,
  roundNumberForPhase,
} from "../domain/phase";
import { SEEDED_ROUNDS } from "../domain/rounds";
import {
  prepareTileArtifact,
  type TileManifest,
  tileManifestSchema,
} from "../tile-artifacts";
import type { BoardDatabase } from "./client";
import {
  boardConfig,
  events,
  harnessParticipants,
  harnessSessions,
  memberships,
  people,
  roundHarnessAssignments,
  rounds,
  squads,
  steerers,
  tileAcceptances,
  tilePublications,
  tiles,
} from "./schema";

const DEFAULT_THEME = "Cidade das inteligências mistas";
const DEFAULT_SQUAD_COUNT = 6;
const SQUAD_NAMES = [
  "Alto da Serra",
  "Vila Nova",
  "Jardim das Flores",
  "Rua das Acácias",
  "Praça do Mercado",
  "Estação Central",
  "Morro do Sol",
  "Cais do Norte",
  "Ponte Velha",
  "Largo da Feira",
  "Parque das Águas",
  "Travessa do Campo",
] as const;

export interface AuditEvent {
  sequence: number;
  type: string;
  actorPersonId: string | null;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BoardState {
  config: {
    theme: string;
    squadCount: number;
    hostedHarnessCount: number;
    currentPhase: BoardPhase;
    roomCode: string | null;
  };
  squads: Array<{
    id: string;
    ordinal: number;
    name: string;
    members: Array<{ id: string; name: string; joinedAt: string }>;
  }>;
  rounds: Array<{
    number: number;
    slug: string;
    title: string;
    skippable: boolean;
    status: string;
  }>;
  events: AuditEvent[];
  harnesses: HarnessView[];
  tiles: TileVersionView[];
  revision: number;
}

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

export interface HarnessView {
  participantId: string;
  nickname: string;
  harnessId: string;
  model: string | null;
  hosted: boolean;
  ownerPersonId: string | null;
  ownerName: string | null;
  connected: boolean;
  lastSeenAt: string | null;
}

export interface SquadHarnessView {
  squadId: string;
  roundId: string;
  assignment: HarnessView | null;
  steerer: { personId: string; personName: string } | null;
  session: { sessionId: string; status: string } | null;
}

export interface HubHarnessParticipant {
  id: string;
  nickname: string;
  model: string;
  harness: { id: string; model?: string; hosted?: boolean };
  connection: { connected: boolean; lastTunnelSeenAt?: number | null };
}

interface Actor {
  personId?: string;
  name?: string;
}

function parsePhase(value: string): BoardPhase {
  if (!isBoardPhase(value)) {
    throw new Error(`Invalid phase stored in SQLite: ${value}`);
  }
  return value;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { raw: value };
  }
}

function squadId(ordinal: number) {
  return `squad-${ordinal}`;
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

export class BoardRepository {
  private readonly db: BoardDatabase;

  constructor(db: BoardDatabase) {
    this.db = db;
  }

  async initialize() {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(boardConfig)
        .values({
          id: 1,
          theme: DEFAULT_THEME,
          squadCount: DEFAULT_SQUAD_COUNT,
          hostedHarnessCount: 0,
          currentPhase: "lobby",
        })
        .onConflictDoNothing();

      for (const round of SEEDED_ROUNDS) {
        await tx
          .insert(rounds)
          .values({ id: `round-${round.number}`, ...round })
          .onConflictDoNothing();
      }
    });

    const config = await this.getConfig();
    await this.ensureSquads(config.squadCount);
  }

  async getConfig() {
    const [config] = await this.db
      .select()
      .from(boardConfig)
      .where(eq(boardConfig.id, 1));
    if (!config) {
      throw new Error("Board configuration was not initialized");
    }
    return {
      theme: config.theme,
      squadCount: config.squadCount,
      hostedHarnessCount: config.hostedHarnessCount,
      currentPhase: parsePhase(config.currentPhase),
      roomCode: config.roomCode,
    };
  }

  async setRoomCode(roomCode: string) {
    const normalized = roomCode.trim();
    const config = await this.getConfig();
    if (config.roomCode && config.roomCode !== normalized) {
      throw new Error(
        `This board belongs to room ${config.roomCode}; refusing to switch it to ${normalized}.`
      );
    }
    if (!config.roomCode) {
      await this.db
        .update(boardConfig)
        .set({ roomCode: normalized, updatedAt: new Date().toISOString() })
        .where(eq(boardConfig.id, 1));
    }
  }

  async getRevision() {
    const [row] = await this.db
      .select({ revision: sql<number>`coalesce(max(${events.sequence}), 0)` })
      .from(events);
    return Number(row?.revision ?? 0);
  }

  async getEvents(limit = 40): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .orderBy(desc(events.sequence))
      .limit(limit);
    return rows.reverse().map((event) => ({
      ...event,
      payload: parsePayload(event.payload),
    }));
  }

  async listSquads() {
    const squadRows = await this.db
      .select()
      .from(squads)
      .where(eq(squads.active, true))
      .orderBy(asc(squads.ordinal));
    const memberRows = await this.db
      .select({
        personId: people.id,
        name: people.name,
        squadId: memberships.squadId,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .orderBy(asc(memberships.joinedAt));

    return squadRows.map((squad) => ({
      id: squad.id,
      ordinal: squad.ordinal,
      name: squad.name,
      members: memberRows
        .filter((member) => member.squadId === squad.id)
        .map((member) => ({
          id: member.personId,
          name: member.name,
          joinedAt: member.joinedAt,
        })),
    }));
  }

  async getState(): Promise<BoardState> {
    const [
      config,
      squadList,
      roundRows,
      eventRows,
      revision,
      harnesses,
      liveTiles,
    ] = await Promise.all([
      this.getConfig(),
      this.listSquads(),
      this.db.select().from(rounds).orderBy(asc(rounds.number)),
      this.getEvents(),
      this.getRevision(),
      this.listHarnesses(),
      this.listLiveTiles(),
    ]);
    return {
      config,
      squads: squadList,
      rounds: roundRows.map((round) => ({
        number: round.number,
        slug: round.slug,
        title: round.title,
        skippable: round.skippable,
        status: round.status,
      })),
      events: eventRows,
      harnesses,
      tiles: liveTiles,
      revision,
    };
  }

  async listTileVersions(squad?: string): Promise<TileVersionView[]> {
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

  async listLiveTiles() {
    const versions = await this.listTileVersions();
    return versions.filter((version) => version.isLive);
  }

  async getLiveTileDocument(squad: string) {
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

  ingestTileArtifact(input: {
    participantId: string;
    sessionId: string;
    sourceVersion: number;
    reason: "watch" | "final";
    files: HarnessArtifactFile[];
  }) {
    const prepared = prepareTileArtifact(input.files);
    return this.db.transaction(async (tx) => {
      const [binding] = await tx
        .select({
          squadId: harnessSessions.squadId,
          roundId: harnessSessions.roundId,
          participantId: harnessSessions.participantId,
          harnessId: harnessParticipants.harnessId,
          model: harnessParticipants.model,
          authorPersonId: harnessParticipants.ownerPersonId,
          authorName: people.name,
        })
        .from(harnessSessions)
        .innerJoin(
          harnessParticipants,
          eq(harnessParticipants.participantId, harnessSessions.participantId)
        )
        .leftJoin(people, eq(people.id, harnessParticipants.ownerPersonId))
        .where(eq(harnessSessions.sessionId, input.sessionId));
      if (!binding || binding.participantId !== input.participantId) {
        throw new Error(
          "Artifact recebido para uma sessão que não pertence a este harness."
        );
      }

      const [existing] = await tx
        .select({ id: tiles.id, boardVersion: tiles.boardVersion })
        .from(tiles)
        .where(
          and(
            eq(tiles.sourceParticipantId, input.participantId),
            eq(tiles.sourceSessionId, input.sessionId),
            eq(tiles.sourceVersion, input.sourceVersion),
            eq(tiles.sourceFingerprint, prepared.fingerprint)
          )
        );
      if (existing) {
        return { ...existing, created: false as const, revision: null };
      }

      const [versionRow] = await tx
        .select({
          boardVersion: sql<number>`coalesce(max(${tiles.boardVersion}), 0) + 1`,
        })
        .from(tiles)
        .where(eq(tiles.squadId, binding.squadId));
      const boardVersion = Number(versionRow?.boardVersion ?? 1);
      const id = `tile-${crypto.randomUUID()}`;
      await tx.insert(tiles).values({
        id,
        squadId: binding.squadId,
        roundId: binding.roundId,
        boardVersion,
        sourceParticipantId: input.participantId,
        sourceSessionId: input.sessionId,
        sourceVersion: input.sourceVersion,
        sourceFingerprint: prepared.fingerprint,
        sourceHarnessId: binding.harnessId,
        sourceModel: binding.model,
        sourceReason: input.reason,
        manifestJson: prepared.manifestJson,
        indexHtml: prepared.indexHtml,
        readme: prepared.readme,
        valid: prepared.valid,
        validationError: prepared.validationError,
        authorPersonId: binding.authorPersonId,
        authorName: binding.authorName,
      });
      let revision = await this.appendEvent(
        tx,
        "tile.versioned",
        {
          tileId: id,
          squadId: binding.squadId,
          roundId: binding.roundId,
          boardVersion,
          sourceParticipantId: input.participantId,
          sourceSessionId: input.sessionId,
          sourceVersion: input.sourceVersion,
          valid: prepared.valid,
          validationError: prepared.validationError,
        },
        {
          personId: binding.authorPersonId ?? undefined,
          name: binding.authorName ?? undefined,
        }
      );

      const [acceptance] = await tx
        .select()
        .from(tileAcceptances)
        .where(
          and(
            eq(tileAcceptances.squadId, binding.squadId),
            eq(tileAcceptances.sourceSessionId, input.sessionId),
            sql`${tileAcceptances.publishedTileId} IS NULL`
          )
        );
      if (acceptance && prepared.valid) {
        revision = await this.publishTileInTransaction(tx, {
          tileId: id,
          squadId: binding.squadId,
          personId: acceptance.acceptedByPersonId,
          personName: acceptance.acceptedByName,
          kind: "accepted",
        });
        await tx
          .update(tileAcceptances)
          .set({ publishedTileId: id })
          .where(
            and(
              eq(tileAcceptances.squadId, binding.squadId),
              eq(tileAcceptances.sourceSessionId, input.sessionId)
            )
          );
      }
      return {
        id,
        boardVersion,
        created: true as const,
        revision,
        valid: prepared.valid,
      };
    });
  }

  async acceptLatestTile(input: { actorPersonId: string; squadId: string }) {
    const binding = await this.requirePromptBinding(input);
    if (!binding.session) {
      throw new Error("A sessão do squad ainda não foi aberta.");
    }
    const sessionId = binding.session.sessionId;
    const actor = await this.requireSquadMember(
      input.actorPersonId,
      input.squadId
    );
    return this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx
        .insert(tileAcceptances)
        .values({
          squadId: input.squadId,
          sourceSessionId: sessionId,
          acceptedByPersonId: actor.id,
          acceptedByName: actor.name,
          acceptedAt: now,
        })
        .onConflictDoUpdate({
          target: [tileAcceptances.squadId, tileAcceptances.sourceSessionId],
          set: {
            acceptedByPersonId: actor.id,
            acceptedByName: actor.name,
            acceptedAt: now,
          },
        });
      let revision = await this.appendEvent(
        tx,
        "tile.accepted",
        {
          squadId: input.squadId,
          sourceSessionId: sessionId,
        },
        { personId: actor.id, name: actor.name }
      );
      const [latest] = await tx
        .select({ id: tiles.id, boardVersion: tiles.boardVersion })
        .from(tiles)
        .where(
          and(
            eq(tiles.squadId, input.squadId),
            eq(tiles.sourceSessionId, sessionId),
            eq(tiles.valid, true)
          )
        )
        .orderBy(desc(tiles.boardVersion))
        .limit(1);
      if (latest) {
        revision = await this.publishTileInTransaction(tx, {
          tileId: latest.id,
          squadId: input.squadId,
          personId: actor.id,
          personName: actor.name,
          kind: "accepted",
        });
        await tx
          .update(tileAcceptances)
          .set({ publishedTileId: latest.id })
          .where(
            and(
              eq(tileAcceptances.squadId, input.squadId),
              eq(tileAcceptances.sourceSessionId, sessionId)
            )
          );
      }
      return {
        squadId: input.squadId,
        sourceSessionId: sessionId,
        boardVersion: latest?.boardVersion ?? null,
        awaitingArtifact: !latest,
        revision,
      };
    });
  }

  async publishTileOverride(input: {
    squadId: string;
    boardVersion: number;
    actorName: string;
  }) {
    const [tile] = await this.db
      .select({ id: tiles.id, valid: tiles.valid })
      .from(tiles)
      .where(
        and(
          eq(tiles.squadId, input.squadId),
          eq(tiles.boardVersion, input.boardVersion)
        )
      );
    if (!tile) {
      throw new Error("Esta versão de tile não existe.");
    }
    if (!tile.valid) {
      throw new Error("Uma versão inválida não pode ir ao ar.");
    }
    const revision = await this.db.transaction((tx) =>
      this.publishTileInTransaction(tx, {
        tileId: tile.id,
        squadId: input.squadId,
        personName: input.actorName.trim(),
        kind: "admin_override",
      })
    );
    return { ...input, tileId: tile.id, revision };
  }

  async listHarnesses(): Promise<HarnessView[]> {
    const rows = await this.db
      .select({
        participantId: harnessParticipants.participantId,
        nickname: harnessParticipants.nickname,
        harnessId: harnessParticipants.harnessId,
        model: harnessParticipants.model,
        hosted: harnessParticipants.hosted,
        ownerPersonId: harnessParticipants.ownerPersonId,
        ownerName: people.name,
        connected: harnessParticipants.connected,
        lastSeenAt: harnessParticipants.lastSeenAt,
      })
      .from(harnessParticipants)
      .leftJoin(people, eq(people.id, harnessParticipants.ownerPersonId))
      .orderBy(asc(harnessParticipants.participantId));
    return rows;
  }

  async reconcileHarnessParticipants(participants: HubHarnessParticipant[]) {
    const now = new Date().toISOString();
    const activeIds = participants.map((participant) => participant.id);
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: reconciliation keeps the authoritative participant merge atomic.
    await this.db.transaction(async (tx) => {
      await tx
        .update(harnessParticipants)
        .set({ connected: false, updatedAt: now });
      for (const participant of participants) {
        const personId = participant.id.startsWith("board-person-")
          ? participant.id.slice("board-person-".length)
          : undefined;
        const [person] = personId
          ? await tx.select().from(people).where(eq(people.id, personId))
          : [];
        if (person) {
          await tx
            .update(harnessParticipants)
            .set({ ownerPersonId: null, updatedAt: now })
            .where(
              and(
                eq(harnessParticipants.ownerPersonId, person.id),
                sql`${harnessParticipants.participantId} <> ${participant.id}`
              )
            );
        }
        await tx
          .insert(harnessParticipants)
          .values({
            participantId: participant.id,
            nickname: participant.nickname,
            harnessId: participant.harness.id,
            model: participant.harness.model ?? participant.model,
            hosted: participant.harness.hosted ?? false,
            ownerPersonId: person?.id,
            connected: participant.connection.connected,
            lastSeenAt: participant.connection.connected ? now : null,
          })
          .onConflictDoUpdate({
            target: harnessParticipants.participantId,
            set: {
              nickname: participant.nickname,
              harnessId: participant.harness.id,
              model: participant.harness.model ?? participant.model,
              hosted: participant.harness.hosted ?? false,
              ...(person ? { ownerPersonId: person.id } : {}),
              connected: participant.connection.connected,
              lastSeenAt: participant.connection.connected ? now : null,
              updatedAt: now,
            },
          });
      }
      if (activeIds.length > 0) {
        await tx
          .update(harnessParticipants)
          .set({ connected: false, updatedAt: now })
          .where(sql`${harnessParticipants.participantId} NOT IN ${activeIds}`);
      }
    });
  }

  async claimHostedHarness(input: { personId: string; participantId: string }) {
    const actor = await this.requirePerson(input.personId);
    const revision = await this.db.transaction(async (tx) => {
      const [harness] = await tx
        .select()
        .from(harnessParticipants)
        .where(eq(harnessParticipants.participantId, input.participantId));
      if (!harness?.hosted) {
        throw new Error("Este harness não é um hospedado disponível.");
      }
      if (harness.ownerPersonId && harness.ownerPersonId !== actor.id) {
        throw new Error("Este harness hospedado já pertence a outra pessoa.");
      }
      const [owned] = await tx
        .select()
        .from(harnessParticipants)
        .where(eq(harnessParticipants.ownerPersonId, actor.id));
      if (owned && owned.participantId !== harness.participantId) {
        throw new Error("Você já reivindicou outro harness.");
      }
      await tx
        .update(harnessParticipants)
        .set({ ownerPersonId: actor.id, updatedAt: new Date().toISOString() })
        .where(eq(harnessParticipants.participantId, harness.participantId));
      return this.appendEvent(
        tx,
        "harness.claimed",
        { participantId: harness.participantId },
        { personId: actor.id, name: actor.name }
      );
    });
    return { participantId: input.participantId, revision };
  }

  async assignHarness(input: {
    actorPersonId: string;
    squadId: string;
    participantId: string;
  }) {
    const { actor, roundId } = await this.requireSquadActorAndRound(
      input.actorPersonId,
      input.squadId
    );
    const [harness] = await this.db
      .select()
      .from(harnessParticipants)
      .where(eq(harnessParticipants.participantId, input.participantId));
    if (!harness?.ownerPersonId) {
      throw new Error("Reivindique o harness antes de designá-lo.");
    }
    const [ownerMembership] = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, harness.ownerPersonId),
          eq(memberships.squadId, input.squadId)
        )
      );
    if (!ownerMembership) {
      throw new Error("O dono do harness precisa fazer parte deste squad.");
    }
    const [openedSession] = await this.db
      .select()
      .from(harnessSessions)
      .where(
        and(
          eq(harnessSessions.squadId, input.squadId),
          eq(harnessSessions.roundId, roundId)
        )
      );
    if (openedSession && openedSession.participantId !== input.participantId) {
      throw new Error(
        "A sessão desta rodada já começou. Feche a rodada antes de trocar o harness."
      );
    }
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(roundHarnessAssignments)
        .values({
          squadId: input.squadId,
          roundId,
          participantId: input.participantId,
          assignedByPersonId: actor.id,
          assignedByName: actor.name,
        })
        .onConflictDoUpdate({
          target: [
            roundHarnessAssignments.squadId,
            roundHarnessAssignments.roundId,
          ],
          set: {
            participantId: input.participantId,
            assignedByPersonId: actor.id,
            assignedByName: actor.name,
            assignedAt: new Date().toISOString(),
          },
        });
      return this.appendEvent(
        tx,
        "harness.assigned",
        { squadId: input.squadId, roundId, participantId: input.participantId },
        { personId: actor.id, name: actor.name }
      );
    });
    return { squadId: input.squadId, roundId, revision };
  }

  async electSteerer(input: {
    actorPersonId: string;
    squadId: string;
    personId: string;
  }) {
    const { actor, roundId } = await this.requireSquadActorAndRound(
      input.actorPersonId,
      input.squadId
    );
    const target = await this.requireSquadMember(input.personId, input.squadId);
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(steerers)
        .values({
          squadId: input.squadId,
          roundId,
          personId: target.id,
          personName: target.name,
          electedByPersonId: actor.id,
        })
        .onConflictDoUpdate({
          target: [steerers.squadId, steerers.roundId],
          set: {
            personId: target.id,
            personName: target.name,
            electedByPersonId: actor.id,
            electedAt: new Date().toISOString(),
          },
        });
      return this.appendEvent(
        tx,
        "steerer.elected",
        {
          squadId: input.squadId,
          roundId,
          personId: target.id,
          personName: target.name,
        },
        { personId: actor.id, name: actor.name }
      );
    });
    return { squadId: input.squadId, roundId, revision };
  }

  async getSquadHarness(squadId: string): Promise<SquadHarnessView> {
    const config = await this.getConfig();
    const roundNumber = roundNumberForPhase(config.currentPhase);
    const roundId = roundNumber ? `round-${roundNumber}` : "round-1";
    const [assignment] = await this.db
      .select()
      .from(roundHarnessAssignments)
      .where(
        and(
          eq(roundHarnessAssignments.squadId, squadId),
          eq(roundHarnessAssignments.roundId, roundId)
        )
      );
    const harness = assignment
      ? ((await this.listHarnesses()).find(
          (item) => item.participantId === assignment.participantId
        ) ?? null)
      : null;
    const [steerer] = await this.db
      .select()
      .from(steerers)
      .where(and(eq(steerers.squadId, squadId), eq(steerers.roundId, roundId)));
    const [session] = await this.db
      .select()
      .from(harnessSessions)
      .where(
        and(
          eq(harnessSessions.squadId, squadId),
          eq(harnessSessions.roundId, roundId)
        )
      );
    return {
      squadId,
      roundId,
      assignment: harness,
      steerer: steerer
        ? { personId: steerer.personId, personName: steerer.personName }
        : null,
      session: session
        ? { sessionId: session.sessionId, status: session.status }
        : null,
    };
  }

  async requirePromptBinding(input: {
    actorPersonId: string;
    squadId: string;
  }) {
    const view = await this.getSquadHarness(input.squadId);
    if (!view.assignment) {
      throw new Error("Designe um harness para esta rodada primeiro.");
    }
    if (view.steerer?.personId !== input.actorPersonId) {
      throw new Error(
        view.steerer
          ? `Somente ${view.steerer.personName}, steerer desta rodada, pode escrever no harness.`
          : "Eleja o steerer desta rodada antes de enviar prompts."
      );
    }
    await this.requireSquadMember(input.actorPersonId, input.squadId);
    return { ...view, assignment: view.assignment };
  }

  async ensureHarnessSession(input: {
    squadId: string;
    roundId: string;
    participantId: string;
  }) {
    const [existing] = await this.db
      .select()
      .from(harnessSessions)
      .where(
        and(
          eq(harnessSessions.squadId, input.squadId),
          eq(harnessSessions.roundId, input.roundId)
        )
      );
    if (existing) {
      if (existing.participantId !== input.participantId) {
        throw new Error(
          "This round already opened a session with another harness. Change it before prompting."
        );
      }
      return existing;
    }
    const sessionId = crypto.randomUUID();
    await this.db.insert(harnessSessions).values({ ...input, sessionId });
    return { ...input, sessionId, status: "pending", openedAt: null };
  }

  async setHarnessSessionStatus(sessionId: string, status: string) {
    const now = new Date().toISOString();
    await this.db
      .update(harnessSessions)
      .set({
        status,
        ...(status === "open" ? { openedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(harnessSessions.sessionId, sessionId));
  }

  async recordHarnessPrompt(input: {
    actorPersonId: string;
    squadId: string;
    roundId: string;
    participantId: string;
    sessionId: string;
    prompt: string;
  }) {
    const actor = await this.requireSquadMember(
      input.actorPersonId,
      input.squadId
    );
    return this.db.transaction((tx) =>
      this.appendEvent(
        tx,
        "harness.prompted",
        {
          squadId: input.squadId,
          roundId: input.roundId,
          participantId: input.participantId,
          sessionId: input.sessionId,
          prompt: input.prompt,
        },
        { personId: actor.id, name: actor.name }
      )
    );
  }

  async getHarnessSessionById(sessionId: string) {
    const [session] = await this.db
      .select()
      .from(harnessSessions)
      .where(eq(harnessSessions.sessionId, sessionId));
    return session;
  }

  listHarnessSessions() {
    return this.db.select().from(harnessSessions);
  }

  async assertHostedScaleDownAllowed(nextCount: number) {
    const removedIds = await this.db
      .select({ participantId: harnessParticipants.participantId })
      .from(harnessParticipants)
      .where(
        and(
          eq(harnessParticipants.hosted, true),
          sql`${harnessParticipants.participantId} > ${`board-hosted-${String(nextCount).padStart(2, "0")}`}`
        )
      );
    if (removedIds.length === 0) {
      return;
    }
    const ids = removedIds.map((row) => row.participantId);
    const [claimed] = await this.db
      .select()
      .from(harnessParticipants)
      .where(
        and(
          inArray(harnessParticipants.participantId, ids),
          sql`${harnessParticipants.ownerPersonId} IS NOT NULL`
        )
      );
    const [assigned] = await this.db
      .select()
      .from(roundHarnessAssignments)
      .where(inArray(roundHarnessAssignments.participantId, ids));
    if (claimed || assigned) {
      throw new Error(
        "Libere ou redesigne os harnesses hospedados de maior número antes de reduzir a quantidade."
      );
    }
  }

  async configure(input: {
    theme: string;
    squadCount: number;
    hostedHarnessCount: number;
  }) {
    const current = await this.getConfig();
    if (current.currentPhase !== "lobby") {
      throw new Error(
        "A configuração fica bloqueada depois que a primeira rodada começa."
      );
    }

    if (input.squadCount < current.squadCount) {
      const removedIds = Array.from(
        { length: current.squadCount - input.squadCount },
        (_, index) => squadId(input.squadCount + index + 1)
      );
      const occupied = await this.db
        .select({ personId: memberships.personId })
        .from(memberships)
        .where(inArray(memberships.squadId, removedIds))
        .limit(1);
      if (occupied.length > 0) {
        throw new Error(
          "Mova as pessoas dos squads removidos antes de reduzir a quantidade."
        );
      }
    }

    const revision = await this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx
        .update(boardConfig)
        .set({
          theme: input.theme.trim(),
          squadCount: input.squadCount,
          hostedHarnessCount: input.hostedHarnessCount,
          updatedAt: now,
        })
        .where(eq(boardConfig.id, 1));

      for (let ordinal = 1; ordinal <= input.squadCount; ordinal += 1) {
        await tx
          .insert(squads)
          .values({
            id: squadId(ordinal),
            ordinal,
            name: SQUAD_NAMES[ordinal - 1] ?? `Squad ${ordinal}`,
            active: true,
          })
          .onConflictDoUpdate({
            target: squads.id,
            set: { active: true, updatedAt: now },
          });
      }
      await tx
        .update(squads)
        .set({ active: false, updatedAt: now })
        .where(gt(squads.ordinal, input.squadCount));

      return this.appendEvent(tx, "admin.configured", {
        theme: input.theme.trim(),
        squadCount: input.squadCount,
        hostedHarnessCount: input.hostedHarnessCount,
      });
    });
    return { ...(await this.getConfig()), revision };
  }

  async joinPerson(input: { personId: string; name: string }) {
    const normalizedName = input.name.trim();
    const revision = await this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx
        .insert(people)
        .values({ id: input.personId, name: normalizedName })
        .onConflictDoUpdate({
          target: people.id,
          set: { name: normalizedName, updatedAt: now },
        });
      return this.appendEvent(
        tx,
        "person.joined",
        { personId: input.personId, name: normalizedName },
        { personId: input.personId, name: normalizedName }
      );
    });
    return { personId: input.personId, name: normalizedName, revision };
  }

  async joinSquad(input: { personId: string; squadId: string }) {
    const [person] = await this.db
      .select()
      .from(people)
      .where(eq(people.id, input.personId));
    if (!person) {
      throw new Error("Defina seu nome antes de escolher um squad.");
    }
    const [squad] = await this.db
      .select()
      .from(squads)
      .where(and(eq(squads.id, input.squadId), eq(squads.active, true)));
    if (!squad) {
      throw new Error("Este squad não está disponível.");
    }

    const revision = await this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      await tx
        .insert(memberships)
        .values({
          personId: input.personId,
          squadId: input.squadId,
          joinedAt: now,
        })
        .onConflictDoUpdate({
          target: memberships.personId,
          set: { squadId: input.squadId, joinedAt: now },
        });
      return this.appendEvent(
        tx,
        "squad.joined",
        { personId: input.personId, squadId: input.squadId },
        { personId: input.personId, name: person.name }
      );
    });
    return { personId: input.personId, squadId: input.squadId, revision };
  }

  async advancePhase() {
    const config = await this.getConfig();
    const next = nextPhase(config.currentPhase);
    if (!next) {
      throw new Error("O evento já está na fase final.");
    }
    const revision = await this.setPhase(config.currentPhase, next, false);
    return { currentPhase: next, revision };
  }

  async skipPhase() {
    const config = await this.getConfig();
    const currentRound = roundNumberForPhase(config.currentPhase);
    if (currentRound === null) {
      throw new Error("Só uma rodada ativa pode ser pulada.");
    }
    const [round] = await this.db
      .select()
      .from(rounds)
      .where(eq(rounds.number, currentRound));
    if (!round?.skippable) {
      throw new Error(`A rodada ${currentRound} não pode ser pulada.`);
    }
    const next = nextPhase(config.currentPhase);
    if (!next) {
      throw new Error("Não há próxima fase.");
    }
    const revision = await this.setPhase(config.currentPhase, next, true);
    return { currentPhase: next, revision };
  }

  private async requirePerson(personId: string) {
    const [person] = await this.db
      .select()
      .from(people)
      .where(eq(people.id, personId));
    if (!person) {
      throw new Error("Registre seu nome antes desta ação.");
    }
    return person;
  }

  private async requireSquadMember(personId: string, squadId: string) {
    const person = await this.requirePerson(personId);
    const [membership] = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.squadId, squadId)
        )
      );
    if (!membership) {
      throw new Error("A pessoa precisa fazer parte deste squad.");
    }
    return person;
  }

  private async requireSquadActorAndRound(
    actorPersonId: string,
    squadId: string
  ) {
    const actor = await this.requireSquadMember(actorPersonId, squadId);
    const config = await this.getConfig();
    const roundNumber = roundNumberForPhase(config.currentPhase);
    if (!roundNumber) {
      throw new Error("Esta ação só fica disponível durante uma rodada.");
    }
    return { actor, roundId: `round-${roundNumber}` };
  }

  private async ensureSquads(count: number) {
    await this.db.transaction(async (tx) => {
      for (let ordinal = 1; ordinal <= count; ordinal += 1) {
        await tx
          .insert(squads)
          .values({
            id: squadId(ordinal),
            ordinal,
            name: SQUAD_NAMES[ordinal - 1] ?? `Squad ${ordinal}`,
            active: true,
          })
          .onConflictDoNothing();
      }
    });
  }

  private setPhase(from: BoardPhase, to: BoardPhase, skipped: boolean) {
    return this.db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const previousRound = roundNumberForPhase(from);
      const nextRound = roundNumberForPhase(to);
      if (previousRound !== null) {
        await tx
          .update(rounds)
          .set({ status: skipped ? "skipped" : "complete", updatedAt: now })
          .where(eq(rounds.number, previousRound));
      }
      if (nextRound !== null) {
        await tx
          .update(rounds)
          .set({ status: "active", updatedAt: now })
          .where(eq(rounds.number, nextRound));
      }
      await tx
        .update(boardConfig)
        .set({ currentPhase: to, updatedAt: now })
        .where(eq(boardConfig.id, 1));
      return this.appendEvent(
        tx,
        skipped ? "phase.skipped" : "phase.advanced",
        { from, to }
      );
    });
  }

  private async publishTileInTransaction(
    tx: Parameters<Parameters<BoardDatabase["transaction"]>[0]>[0],
    input: {
      tileId: string;
      squadId: string;
      personId?: string;
      personName: string;
      kind: "accepted" | "admin_override";
    }
  ) {
    const publishedAt = new Date().toISOString();
    await tx
      .insert(tilePublications)
      .values({
        squadId: input.squadId,
        tileId: input.tileId,
        publishedByPersonId: input.personId,
        publishedByName: input.personName,
        publicationKind: input.kind,
        publishedAt,
      })
      .onConflictDoUpdate({
        target: tilePublications.squadId,
        set: {
          tileId: input.tileId,
          publishedByPersonId: input.personId ?? null,
          publishedByName: input.personName,
          publicationKind: input.kind,
          publishedAt,
        },
      });
    return this.appendEvent(
      tx,
      "tile.published",
      {
        tileId: input.tileId,
        squadId: input.squadId,
        publicationKind: input.kind,
      },
      { personId: input.personId, name: input.personName }
    );
  }

  private async appendEvent(
    tx: Parameters<Parameters<BoardDatabase["transaction"]>[0]>[0],
    type: string,
    payload: Record<string, unknown>,
    actor: Actor = {}
  ) {
    const [event] = await tx
      .insert(events)
      .values({
        type,
        actorPersonId: actor.personId,
        actorName: actor.name,
        payload: JSON.stringify(payload),
      })
      .returning({ sequence: events.sequence });
    if (!event) {
      throw new Error("Audit event was not written");
    }
    return event.sequence;
  }
}
