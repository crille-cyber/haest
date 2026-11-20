-- Topplistan för Turbogalopp. Kör en gång i D1-konsolen (se leaderboard/README.md).
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT    NOT NULL UNIQUE,  -- en inskickning per spelomgång
  name       TEXT    NOT NULL,         -- namnet som det visas
  name_key   TEXT    NOT NULL,         -- namnet i gemener
  score      INTEGER NOT NULL,
  play_time  REAL    NOT NULL,         -- sekunder
  created_at INTEGER NOT NULL,         -- millisekunder sedan 1970
  ip_hash    TEXT    NOT NULL          -- hashad IP, bara för att begränsa spam
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_ip   ON scores (ip_hash, created_at);
