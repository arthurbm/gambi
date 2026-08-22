CREATE TABLE tiles (
  id TEXT PRIMARY KEY NOT NULL,
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT REFERENCES rounds(id),
  dispatch_id TEXT,
  board_version INTEGER NOT NULL,
  source_participant_id TEXT NOT NULL REFERENCES harness_participants(participant_id),
  source_session_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL,
  source_harness_id TEXT NOT NULL,
  source_model TEXT,
  source_reason TEXT NOT NULL,
  manifest_json TEXT,
  index_html TEXT,
  readme TEXT,
  valid INTEGER NOT NULL DEFAULT 0,
  validation_error TEXT,
  author_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  author_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX tiles_squad_board_version_unique
  ON tiles(squad_id, board_version);
CREATE UNIQUE INDEX tiles_source_artifact_unique
  ON tiles(source_participant_id, source_session_id, source_version, source_fingerprint);
CREATE INDEX tiles_source_session_idx ON tiles(source_session_id);

CREATE TABLE tile_publications (
  squad_id TEXT PRIMARY KEY NOT NULL REFERENCES squads(id),
  tile_id TEXT NOT NULL UNIQUE REFERENCES tiles(id),
  published_by_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  published_by_name TEXT NOT NULL,
  publication_kind TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tile_acceptances (
  squad_id TEXT NOT NULL REFERENCES squads(id),
  source_session_id TEXT NOT NULL,
  accepted_by_person_id TEXT NOT NULL REFERENCES people(id),
  accepted_by_name TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_tile_id TEXT REFERENCES tiles(id)
);

CREATE UNIQUE INDEX tile_acceptances_squad_session_unique
  ON tile_acceptances(squad_id, source_session_id);

CREATE TRIGGER tiles_reject_update
BEFORE UPDATE ON tiles
BEGIN
  SELECT RAISE(ABORT, 'tiles are immutable');
END;

CREATE TRIGGER tiles_reject_delete
BEFORE DELETE ON tiles
BEGIN
  SELECT RAISE(ABORT, 'tiles are immutable');
END;
