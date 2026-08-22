ALTER TABLE board_config ADD COLUMN room_code TEXT;

CREATE TABLE harness_participants (
  participant_id TEXT PRIMARY KEY NOT NULL,
  nickname TEXT NOT NULL,
  harness_id TEXT NOT NULL,
  model TEXT,
  hosted INTEGER NOT NULL DEFAULT 0,
  owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  connected INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX harness_participants_owner_unique
  ON harness_participants(owner_person_id);
CREATE INDEX harness_participants_hosted_idx
  ON harness_participants(hosted);

CREATE TABLE round_harness_assignments (
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES harness_participants(participant_id),
  assigned_by_person_id TEXT NOT NULL REFERENCES people(id),
  assigned_by_name TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX round_harness_assignments_squad_round_unique
  ON round_harness_assignments(squad_id, round_id);

CREATE TABLE steerers (
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT NOT NULL,
  elected_by_person_id TEXT NOT NULL REFERENCES people(id),
  elected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX steerers_squad_round_unique
  ON steerers(squad_id, round_id);

CREATE TABLE harness_sessions (
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES harness_participants(participant_id),
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  opened_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX harness_sessions_squad_round_unique
  ON harness_sessions(squad_id, round_id);
CREATE UNIQUE INDEX harness_sessions_participant_session_unique
  ON harness_sessions(participant_id, session_id);
