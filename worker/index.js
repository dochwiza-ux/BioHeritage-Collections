const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-permitted-cross-domain-policies": "none",
};

const JSON_HEADERS = {
  ...SECURITY_HEADERS,
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const ARCHIVE_PATH = "/AkWmn09hT55-_~!xQ7Bv3";
const MAX_SYNC_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_SYNC_RECORDS = 100;
const RECORD_ID_PATTERN = /^REC-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MEDIA_ID_PATTERN = /^IMG-[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CATALOG_NUMBER_PATTERN = /^BHCM?-\d{6,9}$/;
const RECORD_TEXT_LIMITS = {
  catalogNumber: 32,
  identificationStatus: 80,
  scientificName: 240,
  scientificNameAuthorship: 240,
  commonName: 240,
  order: 160,
  family: 160,
  identifiedBy: 200,
  dateIdentified: 40,
  identificationRemarks: 4000,
  country: 160,
  stateProvince: 160,
  county: 160,
  locality: 500,
  site: 500,
  publicLocality: 500,
  sensitiveLocalityReason: 1000,
  locationId: 80,
  latitude: 40,
  longitude: 40,
  coordinateUncertainty: 40,
  datePrecision: 80,
  eventDateStart: 40,
  eventDateEnd: 40,
  collector: 300,
  samplingMethod: 300,
  habitat: 1000,
  workflowStatus: 80,
  preservation: 160,
  sex: 80,
  lifeStage: 80,
  wingCondition: 80,
  condition: 160,
  notes: 5000,
  rightsHolder: 200,
  recordLicense: 120,
  imageCredit: 200,
  imageLicense: 120,
  institutionName: 200,
  institutionCode: 80,
  collectionCode: 120,
  preferredCitation: 2000,
};

function applySecurityHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function accessToken(request) {
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (assertion) return assertion;
  const match = (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function cloudflareAccessIdentity(request, env) {
  const token = accessToken(request);
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const expectedAudience = String(env.ACCESS_AUD || "");
  if (!token || !teamDomain || !expectedAudience) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const expectedIssuer = `https://${teamDomain}`;
  if (header.alg !== "RS256" || !header.kid || payload.iss !== expectedIssuer || !audience.includes(expectedAudience) || !payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now)) return null;

  const certificates = await fetch(`${expectedIssuer}/cdn-cgi/access/certs`, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!certificates.ok) return null;
  const key = (await certificates.json()).keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) return null;
  try {
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const cryptoKey = await crypto.subtle.importKey("jwk", key, algorithm, false, ["verify"]);
    const verified = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!verified) return null;
  } catch {
    return null;
  }
  const email = String(payload.email || "").trim().toLowerCase();
  return email ? { id: email, email, source: "cloudflare-access" } : null;
}

async function managerIdentity(request, env) {
  return cloudflareAccessIdentity(request, env);
}

async function requireManager(request, env) {
  const identity = await managerIdentity(request, env);
  const allowedEmail = String(env.MANAGER_EMAIL || "").trim().toLowerCase();
  const allowed = identity && allowedEmail && identity.email === allowedEmail;
  if (!allowed) throw json({ error: "Manager sign-in is required." }, 401, { "www-authenticate": "Cloudflare Access" });
  return identity.id;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validRecordId(value) {
  return RECORD_ID_PATTERN.test(String(value || ""));
}

function textValue(value, maximum) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function sanitizePhotoOmissions(value) {
  if (!isPlainObject(value)) return {};
  const allowedReasons = new Set(["not_visible", "not_applicable", "restricted"]);
  return Object.fromEntries(Object.entries(value)
    .slice(0, 32)
    .filter(([key, reason]) => /^[a-z0-9-]{1,80}$/.test(key) && allowedReasons.has(reason)));
}

function sanitizePublicationOverride(value) {
  if (!isPlainObject(value)) return null;
  const outstandingViews = Array.isArray(value.outstandingViews)
    ? value.outstandingViews.slice(0, 32).filter(isPlainObject).map((item) => ({
      id: textValue(item.id, 80),
      label: textValue(item.label, 160),
    })).filter((item) => item.id)
    : [];
  return {
    scope: textValue(value.scope, 80),
    reason: textValue(value.reason, 2000),
    decidedBy: textValue(value.decidedBy, 160),
    decidedAt: validTimestamp(value.decidedAt) ? value.decidedAt : null,
    outstandingViews,
  };
}

function normalizeRecord(input, { now = new Date().toISOString() } = {}) {
  const source = isPlainObject(input) ? input : {};
  const record = {};
  for (const [field, maximum] of Object.entries(RECORD_TEXT_LIMITS)) record[field] = textValue(source[field], maximum);
  record.id = String(source.id || "");
  record.entityType = "specimen";
  record.publicationStatus = ["draft", "ready", "published", "withheld"].includes(source.publicationStatus) ? source.publicationStatus : "draft";
  record.localityPrivacy = ["open", "generalized", "withheld"].includes(source.localityPrivacy) ? source.localityPrivacy : "withheld";
  record.photoProtocolVersion = Math.max(1, Math.min(100, Number(source.photoProtocolVersion) || 1));
  record.photoOmissions = sanitizePhotoOmissions(source.photoOmissions);
  record.publicationOverride = sanitizePublicationOverride(source.publicationOverride);
  record.rightsHolder ||= "Bio-Heritage Collections";
  record.recordLicense ||= "All rights reserved";
  record.imageCredit ||= "Tate / Bio-Heritage Collections";
  record.imageLicense ||= "All rights reserved";
  record.institutionName ||= "Bio-Heritage Collections";
  record.institutionCode ||= "BHC";
  record.collectionCode ||= "BHC Entomology";
  record.version = Math.max(1, Math.min(1_000_000_000, Number(source.version) || 1));
  const cloudVersion = Number(source.cloudVersion);
  if (Number.isSafeInteger(cloudVersion) && cloudVersion >= 0) record.cloudVersion = cloudVersion;
  record.createdAt = validTimestamp(source.createdAt) ? source.createdAt : now;
  record.updatedAt = validTimestamp(source.updatedAt) ? source.updatedAt : now;
  record.publishedAt = validTimestamp(source.publishedAt) ? source.publishedAt : (record.publicationStatus === "published" ? now : null);
  return record;
}

function validateRecordInput(input) {
  if (!isPlainObject(input)) return { ok: false, errors: ["Record must be an object."] };
  let serialized;
  try { serialized = JSON.stringify(input); } catch { return { ok: false, errors: ["Record is not serializable."] }; }
  if (serialized.length > MAX_RECORD_BYTES) return { ok: false, errors: ["Record exceeds the 64 KB limit."] };
  const record = normalizeRecord(input);
  const errors = [];
  if (!validRecordId(record.id)) errors.push("Record ID is invalid.");
  if (record.catalogNumber && !CATALOG_NUMBER_PATTERN.test(record.catalogNumber)) errors.push("Catalogue number is invalid.");
  if (!record.scientificName && !record.commonName) errors.push("Scientific name or common name is required.");
  if (!record.country) errors.push("Country is required.");
  if (!record.eventDateStart) errors.push("Collection start date is required.");
  if (record.latitude && (!Number.isFinite(Number(record.latitude)) || Number(record.latitude) < -90 || Number(record.latitude) > 90)) errors.push("Latitude is invalid.");
  if (record.longitude && (!Number.isFinite(Number(record.longitude)) || Number(record.longitude) < -180 || Number(record.longitude) > 180)) errors.push("Longitude is invalid.");
  return errors.length ? { ok: false, errors } : { ok: true, record };
}

async function readJsonBody(request, maximum = MAX_SYNC_BODY_BYTES) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) throw json({ error: "Request body is too large." }, 413);
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw json({ error: "Request body is too large." }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw json({ error: "Request body must be valid JSON." }, 400); }
}

const PUBLIC_RECORD_FIELDS = [
  "id", "entityType", "catalogNumber", "identificationStatus", "scientificName", "scientificNameAuthorship",
  "commonName", "order", "family", "identifiedBy", "dateIdentified", "identificationRemarks", "datePrecision",
  "eventDateStart", "eventDateEnd", "collector", "samplingMethod", "habitat", "preservation", "sex", "lifeStage",
  "wingCondition", "condition", "institutionName", "institutionCode", "collectionCode", "rightsHolder", "recordLicense",
  "imageCredit", "imageLicense", "preferredCitation", "publicationStatus", "publishedAt", "updatedAt", "version",
];

function projectPublicRecord(input) {
  const record = normalizeRecord(input || {});
  const projected = Object.fromEntries(PUBLIC_RECORD_FIELDS.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
  projected.localityPrivacy = record.localityPrivacy;
  projected.country = String(record.country || "").slice(0, 160);
  projected.stateProvince = String(record.stateProvince || "").slice(0, 160);
  if (record.localityPrivacy === "open") {
    for (const key of ["county", "locality", "site", "latitude", "longitude", "coordinateUncertainty"]) {
      if (record[key] !== undefined) projected[key] = record[key];
    }
  } else if (record.localityPrivacy === "generalized") {
    projected.publicLocality = String(record.publicLocality || "").slice(0, 240);
  }
  return projected;
}

function parseStoredRecord(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return isPlainObject(parsed) ? parsed : null;
  } catch { return null; }
}

function formatCatalogNumber(sequence) {
  return `BHC-${String(sequence).padStart(6, "0")}`;
}

function requestedCatalogSequence(value) {
  if (!CATALOG_NUMBER_PATTERN.test(String(value || ""))) return null;
  const sequence = Number(String(value).slice(String(value).indexOf("-") + 1));
  return Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 999_999_999 ? sequence : null;
}

async function allocateCatalogNumber(env, owner, record) {
  let allocation = await env.DB.prepare("SELECT sequence FROM catalog_numbers WHERE record_id = ? AND owner_id = ?").bind(record.id, owner).first();
  if (allocation) return formatCatalogNumber(allocation.sequence);
  const requested = requestedCatalogSequence(record.catalogNumber);
  const createdAt = record.createdAt || new Date().toISOString();
  if (requested) {
    await env.DB.prepare("INSERT OR IGNORE INTO catalog_numbers (sequence, record_id, owner_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(requested, record.id, owner, createdAt).run();
    allocation = await env.DB.prepare("SELECT sequence FROM catalog_numbers WHERE record_id = ? AND owner_id = ?").bind(record.id, owner).first();
  }
  if (!allocation) {
    await env.DB.prepare("INSERT OR IGNORE INTO catalog_numbers (record_id, owner_id, created_at) VALUES (?, ?, ?)")
      .bind(record.id, owner, createdAt).run();
    allocation = await env.DB.prepare("SELECT sequence FROM catalog_numbers WHERE record_id = ? AND owner_id = ?").bind(record.id, owner).first();
  }
  if (!allocation) throw new Error("A catalogue number could not be allocated.");
  return formatCatalogNumber(allocation.sequence);
}

function decideRecordSync(incoming, current, tombstone) {
  if (tombstone) return { accepted: false, reason: "deleted", deletedAt: tombstone.deleted_at || tombstone.deletedAt };
  if (!current) {
    if (Number(incoming.cloudVersion) > 0) return { accepted: false, reason: "missing" };
    return { accepted: true, nextVersion: 1 };
  }
  const currentVersion = Math.max(1, Number(current.version) || 1);
  if (Number.isSafeInteger(Number(incoming.cloudVersion))) {
    if (Number(incoming.cloudVersion) !== currentVersion) return { accepted: false, reason: "changed", currentVersion };
  } else if (String(incoming.updatedAt || "") < String(current.updatedAt || "")) {
    return { accepted: false, reason: "changed", currentVersion };
  }
  return { accepted: true, nextVersion: currentVersion + 1 };
}

function syncConflict(id, reason, current = null, extra = {}) {
  return { id, reason, current, ...extra };
}

async function syncRecords(request, env) {
  const owner = await requireManager(request, env);
  const payload = await readJsonBody(request);
  if (!Array.isArray(payload.records)) return json({ error: "Records must be supplied as an array." }, 400);
  if (payload.records.length > MAX_SYNC_RECORDS) return json({ error: `A maximum of ${MAX_SYNC_RECORDS} records may be synchronized at once.` }, 400);
  const validated = payload.records.map((input, index) => ({ index, validation: validateRecordInput(input) }));
  const invalid = validated.filter((item) => !item.validation.ok).map((item) => ({ index: item.index, id: String(payload.records[item.index]?.id || ""), errors: item.validation.errors }));
  if (invalid.length) return json({ error: "One or more records are invalid.", invalid }, 400);
  const records = validated.map((item) => item.validation.record);
  if (!records.length) return json({ accepted: [], conflicts: [], syncedIds: [] });

  const accepted = [];
  const conflicts = [];
  for (const incoming of records) {
    const [row, tombstone] = await Promise.all([
      env.DB.prepare("SELECT data_json, version, updated_at FROM records WHERE id = ? AND owner_id = ?").bind(incoming.id, owner).first(),
      env.DB.prepare("SELECT deleted_at FROM record_tombstones WHERE id = ? AND owner_id = ?").bind(incoming.id, owner).first(),
    ]);
    const stored = row ? parseStoredRecord(row.data_json) : null;
    const current = row ? normalizeRecord(stored || { id: incoming.id }, { now: row.updated_at || new Date().toISOString() }) : null;
    if (current && row) {
      current.version = Math.max(1, Number(row.version) || Number(current.version) || 1);
      current.updatedAt = row.updated_at || current.updatedAt;
      current.cloudVersion = current.version;
    }
    const decision = decideRecordSync(incoming, current, tombstone);
    if (!decision.accepted) {
      conflicts.push(syncConflict(incoming.id, decision.reason, current, { deletedAt: decision.deletedAt || null }));
      continue;
    }

    const catalogNumber = await allocateCatalogNumber(env, owner, incoming);
    const record = {
      ...incoming,
      catalogNumber,
      version: decision.nextVersion,
      cloudVersion: decision.nextVersion,
      createdAt: current?.createdAt || incoming.createdAt,
    };
    const serialized = JSON.stringify(record);
    let result;
    if (row) {
      result = await env.DB.prepare(`UPDATE records SET entity_type = ?, publication_status = ?, data_json = ?, version = ?, updated_at = ?, published_at = ?
        WHERE id = ? AND owner_id = ? AND version = ?`)
        .bind(record.entityType, record.publicationStatus, serialized, record.version, record.updatedAt, record.publishedAt, record.id, owner, current.version).run();
    } else {
      result = await env.DB.prepare(`INSERT INTO records (id, owner_id, entity_type, publication_status, data_json, version, created_at, updated_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .bind(record.id, owner, record.entityType, record.publicationStatus, serialized, record.version, record.createdAt, record.updatedAt, record.publishedAt).run();
    }
    if (Number(result.meta?.changes) !== 1) {
      const latest = await env.DB.prepare("SELECT data_json, version, updated_at FROM records WHERE id = ? AND owner_id = ?").bind(record.id, owner).first();
      const latestRecord = latest ? (parseStoredRecord(latest.data_json) || { id: record.id }) : null;
      if (latestRecord && latest) {
        latestRecord.version = Math.max(1, Number(latest.version) || Number(latestRecord.version) || 1);
        latestRecord.cloudVersion = latestRecord.version;
        latestRecord.updatedAt = latest.updated_at || latestRecord.updatedAt;
      }
      conflicts.push(syncConflict(record.id, "changed", latestRecord));
      continue;
    }
    accepted.push(record);
  }
  return json({ accepted, conflicts, syncedIds: accepted.map((record) => record.id), syncedAt: new Date().toISOString() });
}

const PUBLIC_CAPTURE_FIELDS = ["captureMode", "camera", "lens", "magnification", "stackFrames", "stepMicrons", "stackingSoftware", "iso", "aperture", "shutterSpeed", "lighting", "photographer", "captureDate", "license", "notes"];

function projectPublicCaptureMetadata(value) {
  const metadata = parseCaptureMetadata(value);
  return Object.fromEntries(PUBLIC_CAPTURE_FIELDS.filter((key) => metadata[key] !== undefined).map((key) => [key, String(metadata[key]).slice(0, 500)]));
}

function mediaResult(row, { publicOnly = false } = {}) {
  return {
    id: row.id,
    recordId: row.record_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    photoType: row.photo_type,
    photoLabel: row.photo_label,
    orientation: row.orientation,
    captureMetadata: publicOnly ? projectPublicCaptureMetadata(row.capture_json) : parseCaptureMetadata(row.capture_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publicUrl: `/media/${encodeURIComponent(row.id)}`,
  };
}

async function ownerRecords(request, env) {
  const owner = await requireManager(request, env);
  if (env.MEDIA) {
    await drainPendingMediaUploads(env, owner, { limit: 25 });
    await drainPendingMediaDeletions(env, owner, { limit: 25 });
  }
  const [recordsResult, mediaResultSet, tombstonesResult] = await Promise.all([
    env.DB.prepare("SELECT data_json, version, created_at, updated_at FROM records WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 2000").bind(owner).all(),
    env.DB.prepare(`SELECT id, record_id, file_name, mime_type, size_bytes, photo_type, photo_label, orientation, capture_json, created_at, updated_at FROM media WHERE owner_id = ? ORDER BY created_at`).bind(owner).all(),
    env.DB.prepare("SELECT id, deleted_at FROM record_tombstones WHERE owner_id = ? ORDER BY deleted_at DESC LIMIT 2000").bind(owner).all(),
  ]);
  return json({
    records: recordsResult.results.map((row) => {
      const record = normalizeRecord(parseStoredRecord(row.data_json) || {}, { now: row.updated_at || new Date().toISOString() });
      record.version = Math.max(1, Number(row.version) || record.version);
      record.cloudVersion = record.version;
      record.createdAt = validTimestamp(record.createdAt) ? record.createdAt : row.created_at;
      record.updatedAt = row.updated_at || record.updatedAt;
      return validRecordId(record.id) ? record : null;
    }).filter(Boolean),
    media: mediaResultSet.results.map(mediaResult),
    deletedRecords: tombstonesResult.results.map((row) => ({ id: row.id, deletedAt: row.deleted_at })),
  });
}

async function publicRecords(env) {
  const recordsResult = await env.DB.prepare("SELECT data_json FROM records WHERE publication_status = 'published' ORDER BY published_at DESC, updated_at DESC LIMIT 1000").all();
  const mediaResultSet = await env.DB.prepare(`
    SELECT media.id, media.record_id, media.file_name, media.mime_type, media.size_bytes, media.photo_type, media.photo_label, media.orientation, media.capture_json, media.created_at, media.updated_at
    FROM media JOIN records ON records.id = media.record_id
    WHERE records.publication_status = 'published'
    ORDER BY media.created_at
  `).all();
  return json({
    records: recordsResult.results.map((row) => parseStoredRecord(row.data_json)).filter(Boolean).map(projectPublicRecord),
    media: mediaResultSet.results.map((row) => mediaResult(row, { publicOnly: true })),
  }, 200, { "cache-control": "public, max-age=60" });
}

function safeFileName(value) {
  return String(value || "image").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function parseCaptureMetadata(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

async function uploadMedia(request, env) {
  const owner = await requireManager(request, env);
  const form = await request.formData();
  const id = String(form.get("id") || "");
  const recordId = String(form.get("recordId") || "");
  const photoType = String(form.get("photoType") || "general").slice(0, 80);
  const photoLabel = String(form.get("photoLabel") || "Additional image").slice(0, 160);
  const orientation = String(form.get("orientation") || "").slice(0, 40);
  const captureMetadata = parseCaptureMetadata(String(form.get("captureMetadata") || "{}").slice(0, 8000));
  const captureJson = JSON.stringify(captureMetadata);
  const file = form.get("file");
  if (!MEDIA_ID_PATTERN.test(id) || !validRecordId(recordId) || !file || typeof file === "string") return json({ error: "Missing or invalid media upload fields." }, 400);
  if (file.size > 100 * 1024 * 1024) return json({ error: "Images must be 100 MB or smaller." }, 413);
  if (["image/svg+xml", "text/html", "application/xhtml+xml"].includes(file.type)) return json({ error: "This file type is not accepted for research images." }, 415);
  const owned = await env.DB.prepare("SELECT id FROM records WHERE id = ? AND owner_id = ?").bind(recordId, owner).first();
  if (!owned) return json({ error: "Record not found." }, 404);
  const current = await env.DB.prepare("SELECT owner_id, r2_key FROM media WHERE id = ?").bind(id).first();
  if (current && current.owner_id !== owner) return json({ error: "Media ID is already in use." }, 409);
  const key = `${owner}/${recordId}/${id}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const timestamp = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO pending_media_uploads (r2_key, media_id, record_id, owner_id, requested_at)
    VALUES (?, ?, ?, ?, ?)`).bind(key, id, recordId, owner, timestamp).run();
  try {
    await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { recordId, ownerId: owner, mediaId: id, photoType, photoLabel, orientation, captureMode: String(captureMetadata.captureMode || "").slice(0, 40), lens: String(captureMetadata.lens || "").slice(0, 120) } });
    const metadataStatement = current
      ? env.DB.prepare(`UPDATE media SET record_id = ?, r2_key = ?, file_name = ?, mime_type = ?, size_bytes = ?, photo_type = ?, photo_label = ?, orientation = ?, capture_json = ?, updated_at = ?
        WHERE id = ? AND owner_id = ?`).bind(recordId, key, file.name, file.type || "application/octet-stream", file.size, photoType, photoLabel, orientation, captureJson, timestamp, id, owner)
      : env.DB.prepare(`INSERT INTO media (id, record_id, owner_id, r2_key, file_name, mime_type, size_bytes, photo_type, photo_label, orientation, capture_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, recordId, owner, key, file.name, file.type || "application/octet-stream", file.size, photoType, photoLabel, orientation, captureJson, timestamp, timestamp);
    const statements = [metadataStatement,
    env.DB.prepare("DELETE FROM pending_media_uploads WHERE r2_key = ? AND owner_id = ?").bind(key, owner)];
    if (current?.r2_key && current.r2_key !== key) {
      statements.push(env.DB.prepare(`
        INSERT INTO pending_media_deletions (r2_key, media_id, record_id, owner_id, requested_at, attempts, last_error)
        VALUES (?, ?, ?, ?, ?, 0, NULL)
        ON CONFLICT(r2_key) DO UPDATE SET requested_at = excluded.requested_at
        WHERE pending_media_deletions.owner_id = excluded.owner_id
      `).bind(current.r2_key, id, recordId, owner, timestamp));
    }
    const [result] = await env.DB.batch(statements);
    if (Number(result.meta?.changes) !== 1) throw new Error("Media metadata was not stored.");
  } catch (error) {
    try {
      await env.MEDIA.delete(key);
      await env.DB.prepare("DELETE FROM pending_media_uploads WHERE r2_key = ? AND owner_id = ?").bind(key, owner).run();
    } catch (cleanupError) {
      console.error(JSON.stringify({ message: "media upload compensation deferred", mediaId: id, error: String(cleanupError?.message || cleanupError) }));
    }
    throw error;
  }
  if (current?.r2_key && current.r2_key !== key) {
    await drainPendingMediaDeletions(env, owner, { mediaId: id });
  }
  return json({ id, photoType, photoLabel, orientation, captureMetadata, publicUrl: `/media/${encodeURIComponent(id)}` });
}

async function drainPendingMediaUploads(env, owner, { limit = 25, gracePeriodMs = 15 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - Math.max(60_000, Number(gracePeriodMs) || 15 * 60 * 1000)).toISOString();
  const queued = await env.DB.prepare(`SELECT r2_key, media_id FROM pending_media_uploads
    WHERE owner_id = ? AND requested_at <= ? ORDER BY requested_at LIMIT ?`)
    .bind(owner, cutoff, Math.max(1, Math.min(100, Number(limit) || 25))).all();
  let deleted = 0;
  for (const row of queued.results) {
    try {
      await env.MEDIA.delete(row.r2_key);
      await env.DB.prepare("DELETE FROM pending_media_uploads WHERE r2_key = ? AND owner_id = ?").bind(row.r2_key, owner).run();
      deleted += 1;
    } catch (error) {
      await env.DB.prepare("UPDATE pending_media_uploads SET attempts = attempts + 1, last_error = ? WHERE r2_key = ? AND owner_id = ?")
        .bind(String(error?.message || error || "R2 cleanup failed").slice(0, 500), row.r2_key, owner).run();
    }
  }
  return { deleted, pending: queued.results.length - deleted };
}

async function drainPendingMediaDeletions(env, owner, { mediaId = null, recordId = null, limit = 100 } = {}) {
  let query = "SELECT r2_key, media_id, record_id FROM pending_media_deletions WHERE owner_id = ?";
  const bindings = [owner];
  if (mediaId) { query += " AND media_id = ?"; bindings.push(mediaId); }
  if (recordId) { query += " AND record_id = ?"; bindings.push(recordId); }
  query += " ORDER BY requested_at LIMIT ?";
  bindings.push(Math.max(1, Math.min(100, Number(limit) || 100)));
  const queued = await env.DB.prepare(query).bind(...bindings).all();
  let deleted = 0;
  for (const row of queued.results) {
    try {
      await env.MEDIA.delete(row.r2_key);
      await env.DB.prepare("DELETE FROM pending_media_deletions WHERE r2_key = ? AND owner_id = ?").bind(row.r2_key, owner).run();
      deleted += 1;
    } catch (error) {
      await env.DB.prepare("UPDATE pending_media_deletions SET attempts = attempts + 1, last_error = ? WHERE r2_key = ? AND owner_id = ?")
        .bind(String(error?.message || error || "R2 deletion failed").slice(0, 500), row.r2_key, owner).run();
    }
  }
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM pending_media_deletions WHERE owner_id = ?${mediaId ? " AND media_id = ?" : ""}${recordId ? " AND record_id = ?" : ""}`)
    .bind(owner, ...(mediaId ? [mediaId] : []), ...(recordId ? [recordId] : [])).first();
  return { deleted, pending: Number(pending?.count) || 0 };
}

async function deleteMedia(request, env, id) {
  const owner = await requireManager(request, env);
  if (!MEDIA_ID_PATTERN.test(id)) return json({ error: "Media ID is invalid." }, 400);
  const row = await env.DB.prepare("SELECT id, record_id, r2_key FROM media WHERE id = ? AND owner_id = ?").bind(id, owner).first();
  if (row) {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO pending_media_deletions (r2_key, media_id, record_id, owner_id, requested_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(r2_key) DO UPDATE SET requested_at = excluded.requested_at WHERE pending_media_deletions.owner_id = excluded.owner_id`)
        .bind(row.r2_key, row.id, row.record_id, owner, new Date().toISOString()),
      env.DB.prepare("DELETE FROM media WHERE id = ? AND owner_id = ?").bind(id, owner),
    ]);
  }
  const result = await drainPendingMediaDeletions(env, owner, { mediaId: id });
  if (!row && !result.deleted && !result.pending) return json({ deleted: false, id }, 404);
  if (result.pending) return json({ error: "Image deletion is queued for retry.", deleted: false, id, pending: result.pending }, 503);
  return json({ deleted: true, id });
}

async function deleteRecord(request, env, id) {
  const owner = await requireManager(request, env);
  if (!validRecordId(id)) return json({ error: "Record ID is invalid." }, 400);
  const deletedAt = new Date().toISOString();
  const mediaRows = await env.DB.prepare("SELECT id, record_id, r2_key FROM media WHERE record_id = ? AND owner_id = ?").bind(id, owner).all();
  const statements = [
    env.DB.prepare(`INSERT INTO record_tombstones (id, owner_id, deleted_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at WHERE record_tombstones.owner_id = excluded.owner_id`)
      .bind(id, owner, deletedAt),
    ...mediaRows.results.map((row) => env.DB.prepare(`INSERT INTO pending_media_deletions (r2_key, media_id, record_id, owner_id, requested_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(r2_key) DO UPDATE SET requested_at = excluded.requested_at
      WHERE pending_media_deletions.owner_id = excluded.owner_id`).bind(row.r2_key, row.id, row.record_id, owner, deletedAt)),
    env.DB.prepare("DELETE FROM media WHERE record_id = ? AND owner_id = ?").bind(id, owner),
    env.DB.prepare("DELETE FROM records WHERE id = ? AND owner_id = ?").bind(id, owner),
  ];
  await env.DB.batch(statements);
  const result = await drainPendingMediaDeletions(env, owner, { recordId: id });
  if (result.pending) return json({ error: "Record metadata was deleted, but image cleanup is queued for retry.", deleted: false, id, deletedAt, pending: result.pending }, 503);
  return json({ deleted: true, id, deletedAt });
}

async function serveMedia(request, env, id) {
  const identity = await managerIdentity(request, env);
  const row = await env.DB.prepare(`
    SELECT media.r2_key, media.mime_type, media.file_name, records.publication_status, media.owner_id
    FROM media JOIN records ON records.id = media.record_id
    WHERE media.id = ?
  `).bind(id).first();
  if (!row || (row.publication_status !== "published" && identity?.id !== row.owner_id)) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  applySecurityHeaders(headers);
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("cache-control", row.publication_status === "published" ? "public, max-age=86400" : "private, no-store");
  if (!String(row.mime_type || "").startsWith("image/") || row.mime_type === "image/svg+xml") headers.set("content-disposition", `attachment; filename="${safeFileName(row.file_name)}"`);
  return new Response(object.body, { headers });
}

function secureAsset(response) {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("content-security-policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  }
  return headers;
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const isCatalogue = url.pathname.replace(/\/+$/, "") === "/catalogue";
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: Boolean(env.DB && env.MEDIA), online: true, database: Boolean(env.DB), imageStorage: Boolean(env.MEDIA) });
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
        if (!env.DB) return json({ error: "The Cloud database is not configured." }, 503);
      }
      if (url.pathname === "/api/sync" && request.method === "POST") return syncRecords(request, env);
      if (url.pathname === "/api/records" && request.method === "GET") return ownerRecords(request, env);
      if (url.pathname.startsWith("/api/records/") && request.method === "DELETE") return deleteRecord(request, env, decodeURIComponent(url.pathname.slice(13)));
      if (url.pathname === "/api/public" && request.method === "GET") return publicRecords(env);
      if (url.pathname === "/api/media" && request.method === "POST") {
        if (!env.MEDIA) return json({ error: "Cloud image storage is not configured." }, 503);
        return uploadMedia(request, env);
      }
      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        if (!env.MEDIA) return json({ error: "Cloud image storage is not configured." }, 503);
        return serveMedia(request, env, decodeURIComponent(url.pathname.slice(7)));
      }
      if (url.pathname.startsWith("/media/") && request.method === "DELETE") {
        if (!env.MEDIA) return json({ error: "Cloud image storage is not configured." }, 503);
        return deleteMedia(request, env, decodeURIComponent(url.pathname.slice(7)));
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
      const managerPath = url.pathname.replace(/\/+$/, "");
      const isLegacyManager = managerPath === "/manager" || managerPath.startsWith("/manager/");
      const isLegacyFieldArchive = managerPath === "/field-archive" || managerPath.startsWith("/field-archive/");
      const isMaskedArchive = managerPath === ARCHIVE_PATH || managerPath.startsWith(`${ARCHIVE_PATH}/`);
      if (isLegacyManager) {
        await requireManager(request, env);
        const archiveUrl = new URL(ARCHIVE_PATH, url);
        archiveUrl.search = url.search;
        return Response.redirect(archiveUrl, 308);
      }
      if (isLegacyFieldArchive) {
        const archiveUrl = new URL(ARCHIVE_PATH, url);
        archiveUrl.search = url.search;
        return Response.redirect(archiveUrl, 308);
      }
      if (isMaskedArchive) {
        try {
          await requireManager(request, env);
        } catch (error) {
          if (!(error instanceof Response) || error.status !== 401) throw error;
          const signInUrl = new URL("/manager", url);
          signInUrl.search = url.search;
          return Response.redirect(signInUrl, 302);
        }
      }

      const assetRequest = isCatalogue || isMaskedArchive ? new Request(new URL("/", url), request) : request;
      const asset = await env.ASSETS.fetch(assetRequest);
      const contentType = asset.headers.get("content-type") || "";
      if (contentType.includes("text/html")) {
        return new Response((await asset.text()).replaceAll("__BHC_ORIGIN__", url.origin), { status: asset.status, headers: secureAsset(asset) });
      }
      return new Response(asset.body, { status: asset.status, headers: secureAsset(asset) });
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(error);
      return json({ error: "The collection service could not complete this request." }, 500);
    }
  },
};

export default worker;
export { decideRecordSync, drainPendingMediaDeletions, drainPendingMediaUploads, formatCatalogNumber, normalizeRecord, projectPublicRecord, projectPublicCaptureMetadata, validateRecordInput, validRecordId };
