import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const boardConfig = sqliteTable("board_config", {
  id: integer("id").primaryKey(),
  theme: text("theme").notNull(),
  squadCount: integer("squad_count").notNull(),
  hostedHarnessCount: integer("hosted_harness_count").notNull(),
  currentPhase: text("current_phase").notNull(),
  roomCode: text("room_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const harnessParticipants = sqliteTable(
  "harness_participants",
  {
    participantId: text("participant_id").primaryKey(),
    nickname: text("nickname").notNull(),
    harnessId: text("harness_id").notNull(),
    model: text("model"),
    hosted: integer("hosted", { mode: "boolean" }).notNull().default(false),
    ownerPersonId: text("owner_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    connected: integer("connected", { mode: "boolean" })
      .notNull()
      .default(false),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("harness_participants_owner_unique").on(table.ownerPersonId),
    index("harness_participants_hosted_idx").on(table.hosted),
  ]
);

export const roundHarnessAssignments = sqliteTable(
  "round_harness_assignments",
  {
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => harnessParticipants.participantId),
    assignedByPersonId: text("assigned_by_person_id")
      .notNull()
      .references(() => people.id),
    assignedByName: text("assigned_by_name").notNull(),
    assignedAt: text("assigned_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("round_harness_assignments_squad_round_unique").on(
      table.squadId,
      table.roundId
    ),
  ]
);

export const steerers = sqliteTable(
  "steerers",
  {
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    personName: text("person_name").notNull(),
    electedByPersonId: text("elected_by_person_id")
      .notNull()
      .references(() => people.id),
    electedAt: text("elected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("steerers_squad_round_unique").on(table.squadId, table.roundId),
  ]
);

export const harnessSessions = sqliteTable(
  "harness_sessions",
  {
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    participantId: text("participant_id")
      .notNull()
      .references(() => harnessParticipants.participantId),
    sessionId: text("session_id").notNull(),
    status: text("status").notNull().default("pending"),
    openedAt: text("opened_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("harness_sessions_squad_round_unique").on(
      table.squadId,
      table.roundId
    ),
    uniqueIndex("harness_sessions_participant_session_unique").on(
      table.participantId,
      table.sessionId
    ),
  ]
);

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const squads = sqliteTable(
  "squads",
  {
    id: text("id").primaryKey(),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("squads_ordinal_unique").on(table.ordinal)]
);

export const memberships = sqliteTable(
  "memberships",
  {
    personId: text("person_id")
      .primaryKey()
      .references(() => people.id, { onDelete: "cascade" }),
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("memberships_squad_id_idx").on(table.squadId)]
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    number: integer("number").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    skippable: integer("skippable", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("rounds_number_unique").on(table.number),
    uniqueIndex("rounds_slug_unique").on(table.slug),
  ]
);

export const events = sqliteTable(
  "events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    actorPersonId: text("actor_person_id"),
    actorName: text("actor_name"),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("events_type_idx").on(table.type)]
);
