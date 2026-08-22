import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  type BoardPhase,
  isBoardPhase,
  nextPhase,
  roundNumberForPhase,
} from "../domain/phase";
import { SEEDED_ROUNDS } from "../domain/rounds";
import type { BoardDatabase } from "./client";
import {
  boardConfig,
  events,
  memberships,
  people,
  rounds,
  squads,
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
  revision: number;
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
    };
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
    const [config, squadList, roundRows, eventRows, revision] =
      await Promise.all([
        this.getConfig(),
        this.listSquads(),
        this.db.select().from(rounds).orderBy(asc(rounds.number)),
        this.getEvents(),
        this.getRevision(),
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
      revision,
    };
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
