# BHC Field v2.1.3

BHC Field is an offline-first biodiversity collection app for Bio-Heritage Collections. It captures
specimen identity, country-first locations, collection events, preparation
details and images in the browser's device archive. Records synchronize to
Cloudflare D1 and images to R2 when connectivity returns.

The app includes:

- installable PWA behavior and an offline app shell;
- IndexedDB records and queued media on the device;
- an adaptive 16-view anatomical research-photography protocol with documented omissions;
- server-authoritative sequential catalogue numbers, with local provisional numbers reconciled safely during synchronization;
- specimen provenance, citation, data rights and per-image reuse terms shared between manager and visitor views;
- explicit open, generalized or withheld public-locality controls with server-side redaction;
- optimistic synchronization using server revisions, explicit manager conflict resolution and deletion tombstones;
- authenticated write endpoints and anonymous read-only public records;
- publication review checks with an audited manager override;
- visitor-facing Home, About Us, Gallery and correction pages, rotating front-view photography, latest additions, signed images and research-photo requests;
- precision image inspection with cursor-anchored wheel zoom, a drawable Zoom Window, live drag zoom, pan controls and Zoom All;
- a Cloudflare Access-secured manager served from a masked archive address;
- Darwin Core-style CSV export and JSON backup/restore.

Run `node build/build.mjs` to create `dist/`. The deployable Worker is emitted
as `dist/server/index.js`, with the app shell in `dist/client/`.

## Sync-integrity deployment order

The `drizzle/0001_sync_integrity.sql` migration must be applied to D1 before
deploying the Worker changes that use record tombstones and server catalogue
number allocation. This preserves existing catalogue-number assignments before
new records can claim a sequence. Do not deploy this batch without applying and
verifying that migration first.

Conflicting device edits are never marked as synchronized automatically. The
Records view keeps the device copy and lets the manager explicitly choose the
Cloud version or the device version. Deletions made offline remain in the local
deletion queue until the Cloud tombstone is confirmed.

## Cloudflare release checklist

The database schema is migration-only; the Worker never runs DDL during a
request. Media deletion uses the `pending_media_deletions` D1 ledger, so an R2
failure remains visible and retryable instead of leaving an untracked object.
Uploads first enter `pending_media_uploads`; replacing an image uses a unique R2
key, atomically commits its D1 metadata, and later removes any abandoned object
recorded by the ledger.

Run releases from a clean checkout in this order:

1. `npm ci`
2. `npm test`
3. `npm run cf:types:check`
4. `npm run cf:migrate:local`
5. `npm run cf:dry-run`
6. `npm run cf:migrate:list`
7. Back up D1, then run `npm run cf:migrate:remote`
8. Verify the migration, then run `npx wrangler deploy --config wrangler.jsonc`

If a remote migration fails, stop before deployment. A Worker rollback does not
reverse D1 migrations or restore deleted R2 objects, so database backups and
migration verification are separate release gates.
