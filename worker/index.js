const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

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

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'specimen',
      publication_status TEXT NOT NULL DEFAULT 'draft',
      data_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_owner_updated ON records(owner_id, updated_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_publication_updated ON records(publication_status, updated_at DESC)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS media (
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
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_media_record ON media(record_id, created_at)"),
  ]);
  const mediaColumns = await env.DB.prepare("PRAGMA table_info(media)").all();
  if (!mediaColumns.results.some((column) => column.name === "updated_at")) {
    await env.DB.prepare("ALTER TABLE media ADD COLUMN updated_at TEXT").run();
    await env.DB.prepare("UPDATE media SET updated_at = created_at WHERE updated_at IS NULL").run();
  }
}

function normalizeRecord(input) {
  const now = new Date().toISOString();
  return {
    ...input,
    id: String(input.id || ""),
    entityType: "specimen",
    publicationStatus: ["draft", "ready", "published", "withheld"].includes(input.publicationStatus) ? input.publicationStatus : "draft",
    version: Math.max(1, Number(input.version) || 1),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    publishedAt: input.publicationStatus === "published" ? (input.publishedAt || now) : (input.publishedAt || null),
  };
}

async function syncRecords(request, env) {
  const owner = await requireManager(request, env);
  const payload = await request.json();
  const records = Array.isArray(payload.records) ? payload.records.slice(0, 500).map(normalizeRecord).filter((record) => record.id) : [];
  if (!records.length) return json({ syncedIds: [] });
  const statements = records.map((record) => env.DB.prepare(`
    INSERT INTO records (id, owner_id, entity_type, publication_status, data_json, version, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      entity_type = excluded.entity_type,
      publication_status = excluded.publication_status,
      data_json = excluded.data_json,
      version = excluded.version,
      updated_at = excluded.updated_at,
      published_at = excluded.published_at
    WHERE records.owner_id = excluded.owner_id AND excluded.updated_at >= records.updated_at
  `).bind(record.id, owner, record.entityType, record.publicationStatus, JSON.stringify(record), record.version, record.createdAt, record.updatedAt, record.publishedAt));
  await env.DB.batch(statements);
  return json({ syncedIds: records.map((record) => record.id), syncedAt: new Date().toISOString() });
}

function mediaResult(row) {
  return {
    id: row.id,
    recordId: row.record_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    photoType: row.photo_type,
    photoLabel: row.photo_label,
    orientation: row.orientation,
    captureMetadata: parseCaptureMetadata(row.capture_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publicUrl: `/media/${encodeURIComponent(row.id)}`,
  };
}

async function ownerRecords(request, env) {
  const owner = await requireManager(request, env);
  const [recordsResult, mediaResultSet] = await Promise.all([
    env.DB.prepare("SELECT data_json FROM records WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 2000").bind(owner).all(),
    env.DB.prepare(`SELECT id, record_id, file_name, mime_type, size_bytes, photo_type, photo_label, orientation, capture_json, created_at, updated_at FROM media WHERE owner_id = ? ORDER BY created_at`).bind(owner).all(),
  ]);
  return json({
    records: recordsResult.results.map((row) => JSON.parse(row.data_json)),
    media: mediaResultSet.results.map(mediaResult),
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
    records: recordsResult.results.map((row) => JSON.parse(row.data_json)),
    media: mediaResultSet.results.map(mediaResult),
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
  if (!id || !recordId || !file || typeof file === "string") return json({ error: "Missing media upload fields." }, 400);
  if (file.size > 100 * 1024 * 1024) return json({ error: "Images must be 100 MB or smaller." }, 413);
  if (["image/svg+xml", "text/html", "application/xhtml+xml"].includes(file.type)) return json({ error: "This file type is not accepted for research images." }, 415);
  const owned = await env.DB.prepare("SELECT id FROM records WHERE id = ? AND owner_id = ?").bind(recordId, owner).first();
  if (!owned) return json({ error: "Record not found." }, 404);
  const key = `${owner}/${recordId}/${id}-${safeFileName(file.name)}`;
  const timestamp = new Date().toISOString();
  await env.MEDIA.put(key, file, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { recordId, ownerId: owner, mediaId: id, photoType, photoLabel, orientation, captureMode: String(captureMetadata.captureMode || "").slice(0, 40), lens: String(captureMetadata.lens || "").slice(0, 120) } });
  await env.DB.prepare(`
    INSERT INTO media (id, record_id, owner_id, r2_key, file_name, mime_type, size_bytes, photo_type, photo_label, orientation, capture_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET r2_key = excluded.r2_key, file_name = excluded.file_name, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes, photo_type = excluded.photo_type, photo_label = excluded.photo_label, orientation = excluded.orientation, capture_json = excluded.capture_json, updated_at = excluded.updated_at
    WHERE media.owner_id = excluded.owner_id
  `).bind(id, recordId, owner, key, file.name, file.type || "application/octet-stream", file.size, photoType, photoLabel, orientation, captureJson, timestamp, timestamp).run();
  return json({ id, photoType, photoLabel, orientation, captureMetadata, publicUrl: `/media/${encodeURIComponent(id)}` });
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
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("cache-control", row.publication_status === "published" ? "public, max-age=86400" : "private, no-store");
  if (!String(row.mime_type || "").startsWith("image/") || row.mime_type === "image/svg+xml") headers.set("content-disposition", `attachment; filename="${safeFileName(row.file_name)}"`);
  return new Response(object.body, { headers });
}

function secureAsset(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
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
        await ensureSchema(env);
      }
      if (url.pathname === "/api/sync" && request.method === "POST") return syncRecords(request, env);
      if (url.pathname === "/api/records" && request.method === "GET") return ownerRecords(request, env);
      if (url.pathname === "/api/public" && request.method === "GET") return publicRecords(env);
      if (url.pathname === "/api/media" && request.method === "POST") {
        if (!env.MEDIA) return json({ error: "Cloud image storage is not configured." }, 503);
        return uploadMedia(request, env);
      }
      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        if (!env.MEDIA) return json({ error: "Cloud image storage is not configured." }, 503);
        return serveMedia(request, env, decodeURIComponent(url.pathname.slice(7)));
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
      const managerPath = url.pathname.replace(/\/+$/, "");
      if (managerPath === "/manager" || managerPath.startsWith("/manager/")) await requireManager(request, env);

      const assetRequest = isCatalogue || managerPath === "/manager" || managerPath.startsWith("/manager/") ? new Request(new URL("/", url), request) : request;
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
