import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("offline app shell includes service worker and manifest", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const db = await read("src/db.js");
  const serviceWorker = await read("src/sw.js");
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /src="\/logo\.png"/);
  assert.match(html, /app\.css\?v=1\.8\.1/);
  assert.match(html, /app\.js\?v=1\.8\.1/);
  assert.match(app, /db\.js\?v=1\.8\.1/);
  assert.match(app, /serviceWorker\.register/);
  assert.match(db, /indexedDB/);
  assert.match(serviceWorker, /bhc-field-shell-v19/);
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
  assert.match(html, /class="catalogue-hero"/);
  assert.match(html, /src="\/og\.png"/);
  assert.match(html, /Explore the collection\./);
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
  assert.match(app, /data-inspect-image/);
  assert.match(app, /zoomImageViewer/);
  assert.match(app, /pointerdown/);
  assert.match(app, /scale\(\$\{imageViewer\.scale\}\)/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /cursor: grab/);
});

test("visitor catalogue offers research requests and signs public photographs", async () => {
  const html = await read("src/index.html");
  const app = await read("src/app.js");
  const css = await read("src/app.css");
  assert.match(html, /Research image requests/);
  assert.match(html, /mailto:dochwiza@gmail\.com/);
  assert.match(html, /class="photo-signature viewer-signature"/);
  assert.match(app, /BHC photograph request/);
  assert.match(app, /Request this specimen/);
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
