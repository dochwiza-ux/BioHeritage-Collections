import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));
const dist = join(root, "dist");
if (dirname(dist) !== root || !dist.endsWith("dist")) throw new Error("Unsafe build target");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "client"), { recursive: true });
await mkdir(join(dist, "server"), { recursive: true });
await cp(join(root, "src"), join(dist, "client"), { recursive: true });
await cp(join(root, "worker", "index.js"), join(dist, "server", "index.js"));

for (const size of [192, 512]) {
  await writeFile(join(dist, "client", `icon-${size}.png`), makeIcon(size));
}

const sourceFiles = ["index.html", "app.css", "app.js", "db.js", "sw.js", "manifest.webmanifest", "logo.png"];
const manifest = {};
for (const file of sourceFiles) manifest[file] = Buffer.byteLength(await readFile(join(dist, "client", file)));
await writeFile(join(dist, "client", "asset-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`BHC Field build ready: ${dist}`);

function makeIcon(size) {
  const rows = [];
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      let color = [23, 63, 53, 255];
      const dx = x - cx;
      const dy = y - cy;
      const ring = Math.sqrt(dx * dx + dy * dy);
      if (ring > size * .34 && ring < size * .37) color = [220, 232, 169, 255];
      const leftWing = ((x - size * .39) / (size * .18)) ** 2 + ((y - size * .43) / (size * .15)) ** 2 < 1;
      const rightWing = ((x - size * .61) / (size * .18)) ** 2 + ((y - size * .43) / (size * .15)) ** 2 < 1;
      if (leftWing || rightWing) color = [220, 232, 169, 255];
      const body = Math.abs(dx) < size * .055 && y > size * .32 && y < size * .72;
      const head = dx * dx + (y - size * .29) ** 2 < (size * .07) ** 2;
      if (body || head) color = [199, 101, 61, 255];
      const offset = 1 + x * 4;
      row.set(color, offset);
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
