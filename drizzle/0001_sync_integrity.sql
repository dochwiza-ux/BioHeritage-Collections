CREATE TABLE IF NOT EXISTS record_tombstones (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_tombstones_owner_deleted
ON record_tombstones(owner_id, deleted_at DESC);

CREATE TABLE IF NOT EXISTS catalog_numbers (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_numbers_owner
ON catalog_numbers(owner_id, sequence);

INSERT OR IGNORE INTO catalog_numbers (sequence, record_id, owner_id, created_at)
SELECT
  CAST(substr(json_extract(data_json, '$.catalogNumber'), instr(json_extract(data_json, '$.catalogNumber'), '-') + 1) AS INTEGER),
  id,
  owner_id,
  created_at
FROM records
WHERE (
    (length(json_extract(data_json, '$.catalogNumber')) = 10 AND substr(json_extract(data_json, '$.catalogNumber'), 1, 4) = 'BHC-')
    OR (length(json_extract(data_json, '$.catalogNumber')) = 11 AND substr(json_extract(data_json, '$.catalogNumber'), 1, 5) = 'BHCM-')
  )
  AND substr(json_extract(data_json, '$.catalogNumber'), instr(json_extract(data_json, '$.catalogNumber'), '-') + 1) NOT GLOB '*[^0-9]*'
ORDER BY created_at, id;

PRAGMA optimize;
