CREATE TABLE IF NOT EXISTS pending_media_deletions (
  r2_key TEXT PRIMARY KEY NOT NULL,
  media_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_media_deletions_owner_requested
ON pending_media_deletions(owner_id, requested_at);

CREATE INDEX IF NOT EXISTS idx_pending_media_deletions_record
ON pending_media_deletions(record_id, owner_id);

CREATE TABLE IF NOT EXISTS pending_media_uploads (
  r2_key TEXT PRIMARY KEY NOT NULL,
  media_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_media_uploads_owner_requested
ON pending_media_uploads(owner_id, requested_at);

PRAGMA optimize;
