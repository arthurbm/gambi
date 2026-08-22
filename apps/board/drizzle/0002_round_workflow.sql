CREATE TABLE challenges (
  id TEXT PRIMARY KEY NOT NULL,
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX challenges_squad_round_unique ON challenges(squad_id, round_id);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  author_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  origin TEXT NOT NULL,
  content TEXT NOT NULL,
  seeded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX drafts_challenge_idx ON drafts(challenge_id);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  build TEXT NOT NULL,
  cut TEXT NOT NULL,
  reason TEXT NOT NULL,
  steerer_person_id TEXT NOT NULL REFERENCES people(id),
  steerer_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX decisions_challenge_unique ON decisions(challenge_id);

CREATE TABLE decision_drafts (
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  PRIMARY KEY(decision_id, draft_id)
);

CREATE TABLE dispatches (
  id TEXT PRIMARY KEY NOT NULL,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES harness_participants(participant_id),
  session_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX dispatches_challenge_unique ON dispatches(challenge_id);
CREATE INDEX dispatches_session_idx ON dispatches(session_id);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY NOT NULL,
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  outcome TEXT NOT NULL,
  reason TEXT,
  reviewer_person_id TEXT NOT NULL REFERENCES people(id),
  reviewer_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX reviews_dispatch_idx ON reviews(dispatch_id);
CREATE UNIQUE INDEX reviews_dispatch_outcome_reason_unique ON reviews(dispatch_id, outcome, ifnull(reason, ''));

CREATE TABLE escalations (
  id TEXT PRIMARY KEY NOT NULL,
  dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
  squad_id TEXT NOT NULL REFERENCES squads(id),
  round_id TEXT NOT NULL REFERENCES rounds(id),
  question TEXT NOT NULL,
  reason TEXT NOT NULL,
  return_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,
  responder_person_id TEXT REFERENCES people(id),
  responder_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT
);
CREATE INDEX escalations_round_status_idx ON escalations(round_id, status);

CREATE TABLE orchestrator_steerers (
  round_id TEXT PRIMARY KEY NOT NULL REFERENCES rounds(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  person_name TEXT NOT NULL,
  selected_by_person_id TEXT NOT NULL REFERENCES people(id),
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
