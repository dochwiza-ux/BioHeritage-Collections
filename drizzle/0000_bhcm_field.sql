CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'specimen',
  publication_status TEXT NOT NULL DEFAULT 'draft',
  data_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_owner_updated
ON records(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_records_publication_updated
ON records(publication_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY NOT NULL,
  record_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  photo_type TEXT NOT NULL DEFAULT 'general',
  photo_label TEXT,
  orientation TEXT,
  capture_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_record
ON media(record_id, created_at);

PRAGMA optimize;
