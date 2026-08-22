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
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

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
