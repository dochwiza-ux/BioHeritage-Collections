import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offline app shell includes service worker and manifest", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const db = await read("src/db.js");
  const serviceWorker = await read("src/sw.js");
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /src="\/logo\.png"/);
  assert.match(html, /app\.css\?v=2\.1\.3/);
  assert.match(html, /app\.js\?v=2\.1\.3/);
  assert.match(app, /db\.js\?v=2\.1\.3/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(db, /indexedDB/);
  assert.match(serviceWorker, /bhc-field-shell-v27/);
  assert.match(serviceWorker, /\/og\.png/);
  assert.match(serviceWorker, /cache: "reload"/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
});

test("minimum scientific fields and publication checks exist", async () => {
  const html = await read("src/index.html");
  assert.match(html, /Collection Date Start|Start date \*/);
  assert.match(html, /Country \*/);
  assert.match(html, /check-identification/);
  assert.match(html, /check-locality/);
});

test("research photographs use an adaptive anatomy-aware protocol", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  assert.match(html, /Adaptive research protocol/);
  assert.match(html, /Naturally wingless \/ apterous/);
  assert.match(app, /habitus-dorsal/);
  assert.match(app, /habitus-ventral/);
  assert.match(app, /wing-surface/);
  assert.match(app, /WING_PHOTO_TYPES/);
  assert.match(app, /not_applicable/);
});

test("publishing supports an audited manager override and a visitor-only catalogue", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const worker = await read("worker/index.js");
  const devServer = await read("build/dev-server.mjs");
  assert.match(html, /Exceptional publication override/);
  assert.match(html, /href="\/catalogue"/);
  assert.match(html, /class="catalogue-hero home-hero brand-slide"/);
  assert.match(html, /src="\/og\.png"/);
  assert.match(html, /Explore the Gallery\./);
  assert.match(html, /Bio-Heritage Collections/);
  assert.match(html, /Digitizing nature, connecting the world/);
  assert.match(app, /publicationOverride/);
  assert.match(app, /Add a reason for the data-manager override/);
  assert.match(app, /visitor-mode/);
  assert.match(app, /bioheritage-collections\.dochwiza\.workers\.dev/);
  assert.match(app, /fetch\("\/api\/health"/);
  assert.match(app, /contentType\.includes\("application\/json"\)/);
  assert.match(app, /Online · device-only mode/);
  assert.match(app, /showModal/);
  assert.match(app, /state\.records = await getRecords\(\)/);
  assert.match(app, /state\.media = await getMedia\(\)/);
  assert.match(app, /Local preview · cloud not connected/);
  assert.match(html, /catalogue-source-status/);
  assert.match(devServer, /media: \[\], local: true/);
  assert.match(worker, /managerPath === "\/manager"/);
  assert.match(worker, /await requireManager\(request, env\)/);
  assert.match(worker, /const assetRequest = isCatalogue/);
});

test("catalogue numbers sequence persistently and capture metadata belongs to each image", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const db = await read("src/db.js");
  const worker = await read("worker/index.js");
  assert.match(html, /id="catalog-number" required readonly/);
  assert.doesNotMatch(app, /Math\.random/);
  assert.match(db, /CATALOG_SEQUENCE_KEY/);
  assert.match(db, /BHC-\$\{String\(sequence\)\.padStart\(6, "0"\)\}/);
  assert.match(db, /\^BHCM\?/);
  assert.match(app, /data-capture-setting="captureMode"/);
  assert.match(app, /captureMetadata: \{ \.\.\.\(item\.captureMetadata/);
  assert.match(app, /for \(const \[photoType, captureMetadata\] of Object\.entries\(state\.viewCaptureSettings\)\)/);
  assert.match(app, /Settings were updated for/);
  assert.match(app, /research-capture-metadata/);
  assert.match(app, /\["Camera", metadata\.camera\]/);
  assert.doesNotMatch(html, /name="photoRig"/);
  assert.match(worker, /capture_json/);
});

test("visitor research photographs open in an accessible zoom and pan viewer", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const css = await read("src/app.css");
  assert.match(html, /id="image-viewer-dialog"/);
  assert.match(html, /Image zoom and pan controls/);
  assert.match(html, /id="image-pan-left"/);
  assert.match(html, /id="image-viewer-navigator"/);
  assert.match(html, /id="image-viewer-viewport"/);
  assert.match(html, /id="image-zoom-window"/);
  assert.match(html, /id="image-drag-zoom"/);
  assert.match(html, /Home · Zoom all/);
  assert.match(app, /data-inspect-image/);
  assert.match(app, /zoomImageViewer/);
  assert.match(app, /focusImageViewerArea/);
  assert.match(app, /updateImageViewerNavigator/);
  assert.match(app, /zoomImageViewerWindow/);
  assert.match(app, /setImageViewerScale\(imageViewer\.scale \* factor, event\.clientX, event\.clientY\)/);
  assert.match(app, /Home: resetImageViewer/);
  assert.match(app, /lastMiddleClickAt/);
  assert.match(app, /pointerdown/);
  assert.match(app, /scale\(\$\{imageViewer\.scale\}\)/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /cursor: grab/);
  assert.match(css, /image-viewer-navigator/);
});

test("saved photographs can be removed safely while editing", async () => {
  const app = await read("src/app.js");
  const worker = await read("worker/index.js");
  assert.match(app, /data-remove-stored-media/);
  assert.match(app, /queueStoredMediaRemoval/);
  assert.match(app, /syncStatus: "delete-queued"/);
  assert.match(app, /method: "DELETE"/);
  assert.match(worker, /async function deleteMedia/);
  assert.match(worker, /DELETE FROM media WHERE id = \? AND owner_id = \?/);
  assert.match(worker, /await env\.MEDIA\.delete/);
  assert.match(worker, /pending_media_deletions/);
  assert.doesNotMatch(worker, /async function ensureSchema/);
});

test("visitor navigation follows Home, About Us, Gallery and correction order", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  assert.match(html, /VIRTUAL COLLECTIONS/);
  assert.doesNotMatch(html, /PUBLIC COLLECTION/);
  assert.match(html, /data-public-panel-button="home"[\s\S]*data-public-panel-button="about"[\s\S]*data-public-panel-button="gallery"[\s\S]*data-public-panel-button="corrections"/);
  assert.match(html, /id="latest-additions"/);
  assert.match(html, /id="home-feature-image"/);
  assert.match(html, /id="correction-form"/);
  assert.match(html, /id="correction-files"/);
  assert.match(html, /mailto:dochwiza@gmail\.com/);
  assert.match(html, /data-public-panel-button="about"/);
  assert.match(app, /prepareCorrectionEmail/);
  assert.match(app, /BHC Virtual Collections correction suggestion/);
  assert.match(app, /document\.title = "BHC Virtual Collections"/);
  assert.match(app, /photoType === "head-frontal"/);
  assert.match(app, /\{ brand: true \}/);
  assert.match(app, /setInterval\(showNextHomeFrontView, 8000\)/);
  assert.match(app, /renderLatestAdditions/);
  assert.match(app, /data-open-specimen/);
});

test("visitor dark mode is persistent and recently added photographs are fitted", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const css = await read("src/app.css");
  assert.match(html, /id="visitor-theme-toggle"/);
  assert.match(app, /VISITOR_THEME_KEY/);
  assert.match(app, /prefers-color-scheme: dark/);
  assert.match(app, /localStorage\.setItem\(VISITOR_THEME_KEY/);
  assert.match(css, /visitor-mode\.theme-dark/);
  assert.match(css, /latest-card-image img \{ object-fit: contain/);
});

test("the beetle artwork is not covered by the specimen caption banner", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const css = await read("src/app.css");
  assert.match(html, /home-hero brand-slide/);
  assert.match(html, /class="home-hero-copy"/);
  assert.match(app, /classList\.toggle\("brand-slide", Boolean\(feature\.brand\)\)/);
  assert.match(css, /home-hero\.brand-slide \.home-hero-copy \{ display: none/);
  assert.match(css, /home-hero\.brand-slide::after \{ display: none/);
  assert.match(css, /home-hero\.brand-slide \{ aspect-ratio: 1731 \/ 909/);
});

test("correction buttons create linked public and secure manager references", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  assert.match(html, /id="correction-context"/);
  assert.match(html, /name="managerUrl"/);
  assert.match(app, /data-suggest-correction/);
  assert.match(app, /function publicRecordUrl\(record\)/);
  assert.match(app, /function managerRecordUrl\(record\)/);
  assert.match(app, /Cited public record:/);
  assert.match(app, /Secure manager record:/);
  assert.match(app, /openPublicRecordFromQuery/);
  assert.match(app, /openManagerRecordFromQuery/);
  assert.match(app, /await editRecord\(record\.id\)/);
});

test("the manager is served from a protected archive path", async () => {
  const worker = await read("worker/index.js");
  const serviceWorker = await read("src/sw.js");
  assert.match(worker, /const ARCHIVE_PATH = "\/AkWmn09hT55-_~!xQ7Bv3"/);
  assert.match(worker, /managerPath === "\/field-archive"/);
  assert.match(worker, /if \(isMaskedArchive\)/);
  assert.match(worker, /const signInUrl = new URL\("\/manager", url\)/);
  assert.match(worker, /Response\.redirect\(signInUrl, 302\)/);
  assert.match(worker, /Response\.redirect\(archiveUrl, 308\)/);
  assert.match(serviceWorker, /url\.pathname === "\/field-archive"/);
  assert.match(serviceWorker, /url\.pathname === ARCHIVE_PATH/);
});

test("visitor catalogue offers research requests and signs public photographs", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const css = await read("src/app.css");
  assert.match(html, /Research image requests/);
  assert.match(html, /mailto:dochwiza@gmail\.com/);
  assert.match(html, /class="photo-signature viewer-signature"/);
  assert.match(app, /BHC photograph request/);
  assert.match(app, /Request a photograph/);
  assert.match(app, /class="photo-signature"/);
  assert.match(css, /"Segoe Script"/);
  assert.match(css, /\.photo-signature/);
});

test("cloud writes require an authenticated user", async () => {
  const worker = await read("worker/index.js");
  const config = await read("wrangler.jsonc");
  assert.doesNotMatch(worker, /oai-authenticated-user-id/);
  assert.match(worker, /cf-access-jwt-assertion/);
  assert.match(worker, /CF_Authorization/);
  assert.match(worker, /crypto\.subtle\.verify/);
  assert.match(worker, /ACCESS_TEAM_DOMAIN/);
  assert.match(worker, /ACCESS_AUD/);
  assert.match(worker, /Manager sign-in is required/);
  assert.match(worker, /env\.MEDIA\.put/);
  assert.match(worker, /photo_type/);
  assert.match(worker, /photoLabel/);
  assert.match(worker, /captureMetadata/);
  assert.match(worker, /ON CONFLICT\(id\)/);
  assert.match(worker, /image\/svg\+xml/);
  assert.match(config, /"binding": "DB"/);
  assert.match(config, /"binding": "MEDIA"/);
  assert.match(config, /"bucket_name": "bhc-field-media"/);
  assert.match(config, /"run_worker_first": true/);
  assert.match(config, /"migrations_dir": "\.\/drizzle"/);
  assert.match(config, /"compatibility_date": "2026-09-17"/);
});

test("cloud synchronization supports archive restore and reports both storage services", async () => {
  const app = await read("src/app.js");
  const worker = await read("worker/index.js");
  assert.match(app, /fetch\("\/api\/records"/);
  assert.match(app, /cloud\.records/);
  assert.match(app, /cloud\.media/);
  assert.match(app, /Cloud database is ready, but image storage still needs activation/);
  assert.match(worker, /database: Boolean\(env\.DB\)/);
  assert.match(worker, /imageStorage: Boolean\(env\.MEDIA\)/);
  assert.match(worker, /media: mediaResultSet\.results\.map\(mediaResult\)/);
});

test("manager and visitor share rights, provenance, image-method and locality controls", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  assert.match(html, /name="scientificNameAuthorship"/);
  assert.match(html, /name="identifiedBy"/);
  assert.match(html, /name="dateIdentified"/);
  assert.match(html, /name="institutionCode" value="BHC"/);
  assert.match(html, /name="rightsHolder" value="Bio-Heritage Collections"/);
  assert.match(html, /name="recordLicense"/);
  assert.match(html, /name="localityPrivacy"/);
  assert.match(html, /name="publicLocality"/);
  assert.match(html, /id="supplemental-stacking-software"/);
  assert.match(html, /id="supplemental-iso"/);
  assert.match(app, /function citationFor\(record\)/);
  assert.match(app, /function publicLocationFor\(record\)/);
  assert.match(app, /publicCaptureMetadata\(item, record\)/);
  assert.match(app, /\["Stacking software", metadata\.stackingSoftware\]/);
  assert.match(app, /record-data licence/i);
});

test("the public API redacts protected locality and manager-only metadata", async () => {
  const { projectPublicRecord, projectPublicCaptureMetadata } = await import("../worker/index.js");
  const source = {
    id: "REC-1",
    publicationStatus: "published",
    catalogNumber: "BHC-000001",
    scientificName: "Cicindela example",
    country: "Zimbabwe",
    stateProvince: "Harare",
    county: "Private district",
    locality: "Sensitive valley",
    site: "Exact trap site",
    latitude: "-17.8252",
    longitude: "31.0335",
    coordinateUncertainty: "5",
    sensitiveLocalityReason: "Vulnerable site",
    notes: "Manager-only note",
  };
  const withheld = projectPublicRecord({ ...source, localityPrivacy: "withheld" });
  assert.equal(withheld.country, "Zimbabwe");
  assert.equal(withheld.stateProvince, "Harare");
  assert.equal(withheld.locality, undefined);
  assert.equal(withheld.site, undefined);
  assert.equal(withheld.latitude, undefined);
  assert.equal(withheld.sensitiveLocalityReason, undefined);
  assert.equal(withheld.notes, undefined);
  const generalized = projectPublicRecord({ ...source, localityPrivacy: "generalized", publicLocality: "Harare Province, Zimbabwe" });
  assert.equal(generalized.publicLocality, "Harare Province, Zimbabwe");
  assert.equal(generalized.longitude, undefined);
  const open = projectPublicRecord({ ...source, localityPrivacy: "open" });
  assert.equal(open.site, "Exact trap site");
  assert.equal(open.latitude, "-17.8252");
  const capture = projectPublicCaptureMetadata(JSON.stringify({ camera: "Nikon D3300", stackingSoftware: "Helicon Focus", privateNote: "do not publish" }));
  assert.equal(capture.camera, "Nikon D3300");
  assert.equal(capture.stackingSoftware, "Helicon Focus");
  assert.equal(capture.privateNote, undefined);
});

test("record validation rejects unsafe identifiers and strips client-only or unknown fields", async () => {
  const { validateRecordInput } = await import("../worker/index.js");
  const base = {
    id: "REC-VALID-1",
    catalogNumber: "BHC-000001",
    commonName: "Bumble bee",
    country: "United States",
    eventDateStart: "2026-08-05",
    version: 3,
    cloudVersion: 2,
  };
  const valid = validateRecordInput({ ...base, unexpected: "discard me", syncConflict: { current: "discard me" } });
  assert.equal(valid.ok, true);
  assert.equal(valid.record.unexpected, undefined);
  assert.equal(valid.record.syncConflict, undefined);
  assert.equal(valid.record.cloudVersion, 2);
  const unsafe = validateRecordInput({ ...base, id: 'REC-1" autofocus onfocus="alert(1)' });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.errors.join(" "), /Record ID is invalid/);
});

test("optimistic synchronization preserves conflicts instead of accepting stale changes", async () => {
  const { decideRecordSync } = await import("../worker/index.js");
  assert.deepEqual(decideRecordSync({ cloudVersion: 0 }, null, null), { accepted: true, nextVersion: 1 });
  assert.deepEqual(
    decideRecordSync({ cloudVersion: 4, updatedAt: "2026-09-17T10:00:00.000Z" }, { version: 5, updatedAt: "2026-09-17T09:00:00.000Z" }, null),
    { accepted: false, reason: "changed", currentVersion: 5 },
  );
  assert.deepEqual(
    decideRecordSync({ cloudVersion: 5 }, { version: 5 }, null),
    { accepted: true, nextVersion: 6 },
  );
  assert.deepEqual(
    decideRecordSync({ cloudVersion: 5 }, { version: 5 }, { deleted_at: "2026-09-17T12:00:00.000Z" }),
    { accepted: false, reason: "deleted", deletedAt: "2026-09-17T12:00:00.000Z" },
  );
});

test("server catalogue allocation formatting is stable and manager rendering escapes record identifiers", async () => {
  const { formatCatalogNumber } = await import("../worker/index.js");
  const app = await read("src/app.js");
  const migration = await read("drizzle/0001_sync_integrity.sql");
  assert.equal(formatCatalogNumber(1), "BHC-000001");
  assert.equal(formatCatalogNumber(1234567), "BHC-1234567");
  assert.match(app, /data-edit-record="\$\{escapeAttribute\(record\.id\)\}"/);
  assert.match(app, /syncStatus: "conflict"/);
  assert.match(app, /putRecordDeletion/);
  assert.match(migration, /record_tombstones/);
  assert.match(migration, /catalog_numbers/);
});

test("the sync-integrity migration preserves existing catalogue numbers and creates deletion tombstones", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(await read("drizzle/0000_bhcm_field.sql"));
    const insert = database.prepare(`INSERT INTO records
      (id, owner_id, entity_type, publication_status, data_json, version, created_at, updated_at, published_at)
      VALUES (?, ?, 'specimen', 'draft', ?, 1, ?, ?, NULL)`);
    insert.run("REC-ONE", "manager@example.com", JSON.stringify({ catalogNumber: "BHC-000001" }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    insert.run("REC-TWO", "manager@example.com", JSON.stringify({ catalogNumber: "BHCM-000002" }), "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
    database.exec(await read("drizzle/0001_sync_integrity.sql"));
    database.exec(await read("drizzle/0002_media_deletion_queue.sql"));
    assert.deepEqual(
      database.prepare("SELECT sequence, record_id FROM catalog_numbers ORDER BY sequence").all().map((row) => ({ ...row })),
      [{ sequence: 1, record_id: "REC-ONE" }, { sequence: 2, record_id: "REC-TWO" }],
    );
    database.prepare("INSERT INTO record_tombstones (id, owner_id, deleted_at) VALUES (?, ?, ?)")
      .run("REC-DELETED", "manager@example.com", "2026-09-17T12:00:00.000Z");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM record_tombstones").get().count, 1);
    database.prepare(`INSERT INTO pending_media_deletions
      (r2_key, media_id, record_id, owner_id, requested_at) VALUES (?, ?, ?, ?, ?)`)
      .run("manager/REC-ONE/IMG-ONE.jpg", "IMG-ONE", "REC-ONE", "manager@example.com", "2026-09-17T12:00:00.000Z");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM pending_media_deletions").get().count, 1);
    database.prepare(`INSERT INTO pending_media_uploads
      (r2_key, media_id, record_id, owner_id, requested_at) VALUES (?, ?, ?, ?, ?)`)
      .run("manager/REC-ONE/IMG-UPLOAD.jpg", "IMG-UPLOAD", "REC-ONE", "manager@example.com", "2026-09-17T12:00:00.000Z");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM pending_media_uploads").get().count, 1);
  } finally {
    database.close();
  }
});

test("failed R2 deletions stay queued and a later retry clears them", async () => {
  const { drainPendingMediaDeletions } = await import("../worker/index.js");
  const rows = [{ r2_key: "manager/REC-ONE/IMG-ONE.jpg", media_id: "IMG-ONE", record_id: "REC-ONE", attempts: 0, last_error: null }];
  const database = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              if (!sql.startsWith("SELECT r2_key")) throw new Error(`Unexpected all query: ${sql}`);
              return { results: rows.map((row) => ({ ...row })) };
            },
            async first() {
              if (!sql.startsWith("SELECT COUNT")) throw new Error(`Unexpected first query: ${sql}`);
              return { count: rows.length };
            },
            async run() {
              if (sql.startsWith("DELETE FROM pending_media_deletions")) {
                const index = rows.findIndex((row) => row.r2_key === bindings[0]);
                if (index >= 0) rows.splice(index, 1);
              } else if (sql.startsWith("UPDATE pending_media_deletions")) {
                const row = rows.find((item) => item.r2_key === bindings[1]);
                if (row) { row.attempts += 1; row.last_error = bindings[0]; }
              } else throw new Error(`Unexpected run query: ${sql}`);
              return { success: true };
            },
          };
        },
      };
    },
  };
  let fail = true;
  const media = { async delete() { if (fail) throw new Error("temporary R2 failure"); } };
  const first = await drainPendingMediaDeletions({ DB: database, MEDIA: media }, "manager@example.com", { mediaId: "IMG-ONE" });
  assert.deepEqual(first, { deleted: 0, pending: 1 });
  assert.equal(rows[0].attempts, 1);
  assert.match(rows[0].last_error, /temporary R2 failure/);
  fail = false;
  const second = await drainPendingMediaDeletions({ DB: database, MEDIA: media }, "manager@example.com", { mediaId: "IMG-ONE" });
  assert.deepEqual(second, { deleted: 1, pending: 0 });
  assert.equal(rows.length, 0);
});
