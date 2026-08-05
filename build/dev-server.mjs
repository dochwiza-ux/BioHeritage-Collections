import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || "dist/client");
const port = Number(process.env.PORT || 4173);
const records = new Map();

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png" };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/health") return sendJson(response, { ok: true, local: true });
  if (url.pathname === "/api/sync" && request.method === "POST") {
    const body = await readBody(request);
    for (const record of body.records || []) records.set(record.id, record);
    return sendJson(response, { syncedIds: (body.records || []).map((record) => record.id), local: true });
  }
  if (url.pathname === "/api/public") return sendJson(response, { records: [...records.values()].filter((record) => record.publicationStatus === "published"), media: [], local: true });
  if (url.pathname === "/api/records") return sendJson(response, { records: [...records.values()] });
  if (url.pathname === "/api/media" && request.method === "POST") return sendJson(response, { id: `local-${Date.now()}`, publicUrl: "" });
  if (url.pathname.startsWith("/api/")) return sendJson(response, { error: "Not found" }, 404);
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  let path = resolve(join(root, requested));
  if (!path.startsWith(root + sep) && path !== root) return sendJson(response, { error: "Invalid path" }, 400);
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, "index.html");
    response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "cache-control": "no-cache" });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(200, { "content-type": types[".html"], "cache-control": "no-cache" });
    response.end(await readFile(join(root, "index.html")));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Local URL: http://127.0.0.1:${port}`));

function sendJson(response, body, status = 200) { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
function readBody(request) { return new Promise((resolveBody, reject) => { let data = ""; request.on("data", (chunk) => data += chunk); request.on("end", () => { try { resolveBody(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } }); request.on("error", reject); }); }
