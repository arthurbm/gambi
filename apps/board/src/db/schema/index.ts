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

export const challenges = sqliteTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("challenges_squad_round_unique").on(
      table.squadId,
      table.roundId
    ),
  ]
);

export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id),
    authorPersonId: text("author_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    origin: text("origin").notNull(),
    content: text("content").notNull(),
    seeded: integer("seeded", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("drafts_challenge_idx").on(table.challengeId)]
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id),
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    build: text("build").notNull(),
    cut: text("cut").notNull(),
    reason: text("reason").notNull(),
    steererPersonId: text("steerer_person_id")
      .notNull()
      .references(() => people.id),
    steererName: text("steerer_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("decisions_challenge_unique").on(table.challengeId)]
);

export const decisionDrafts = sqliteTable(
  "decision_drafts",
  {
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id),
  },
  (table) => [
    uniqueIndex("decision_drafts_unique").on(table.decisionId, table.draftId),
  ]
);

export const dispatches = sqliteTable(
  "dispatches",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => challenges.id),
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
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("dispatches_challenge_unique").on(table.challengeId),
    index("dispatches_session_idx").on(table.sessionId),
  ]
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatches.id),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    reviewerPersonId: text("reviewer_person_id")
      .notNull()
      .references(() => people.id),
    reviewerName: text("reviewer_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("reviews_dispatch_idx").on(table.dispatchId)]
);

export const escalations = sqliteTable(
  "escalations",
  {
    id: text("id").primaryKey(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatches.id),
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id),
    question: text("question").notNull(),
    reason: text("reason").notNull(),
    returnCount: integer("return_count").notNull(),
    status: text("status").notNull().default("pending"),
    response: text("response"),
    responderPersonId: text("responder_person_id").references(() => people.id),
    responderName: text("responder_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    answeredAt: text("answered_at"),
  },
  (table) => [
    index("escalations_round_status_idx").on(table.roundId, table.status),
  ]
);

export const orchestratorSteerers = sqliteTable("orchestrator_steerers", {
  roundId: text("round_id")
    .primaryKey()
    .references(() => rounds.id),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  personName: text("person_name").notNull(),
  selectedByPersonId: text("selected_by_person_id")
    .notNull()
    .references(() => people.id),
  selectedAt: text("selected_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tiles = sqliteTable(
  "tiles",
  {
    id: text("id").primaryKey(),
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    roundId: text("round_id").references(() => rounds.id),
    dispatchId: text("dispatch_id"),
    boardVersion: integer("board_version").notNull(),
    sourceParticipantId: text("source_participant_id")
      .notNull()
      .references(() => harnessParticipants.participantId),
    sourceSessionId: text("source_session_id").notNull(),
    sourceVersion: integer("source_version").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceHarnessId: text("source_harness_id").notNull(),
    sourceModel: text("source_model"),
    sourceReason: text("source_reason").notNull(),
    manifestJson: text("manifest_json"),
    indexHtml: text("index_html"),
    readme: text("readme"),
    valid: integer("valid", { mode: "boolean" }).notNull().default(false),
    validationError: text("validation_error"),
    authorPersonId: text("author_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("tiles_squad_board_version_unique").on(
      table.squadId,
      table.boardVersion
    ),
    uniqueIndex("tiles_source_artifact_unique").on(
      table.sourceParticipantId,
      table.sourceSessionId,
      table.sourceVersion,
      table.sourceFingerprint
    ),
    index("tiles_source_session_idx").on(table.sourceSessionId),
  ]
);

export const tilePublications = sqliteTable("tile_publications", {
  squadId: text("squad_id")
    .primaryKey()
    .references(() => squads.id),
  tileId: text("tile_id")
    .notNull()
    .unique()
    .references(() => tiles.id),
  publishedByPersonId: text("published_by_person_id").references(
    () => people.id,
    { onDelete: "set null" }
  ),
  publishedByName: text("published_by_name").notNull(),
  publicationKind: text("publication_kind").notNull(),
  publishedAt: text("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tileAcceptances = sqliteTable(
  "tile_acceptances",
  {
    squadId: text("squad_id")
      .notNull()
      .references(() => squads.id),
    sourceSessionId: text("source_session_id").notNull(),
    acceptedByPersonId: text("accepted_by_person_id")
      .notNull()
      .references(() => people.id),
    acceptedByName: text("accepted_by_name").notNull(),
    acceptedAt: text("accepted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    publishedTileId: text("published_tile_id").references(() => tiles.id),
  },
  (table) => [
    uniqueIndex("tile_acceptances_squad_session_unique").on(
      table.squadId,
      table.sourceSessionId
    ),
  ]
);
