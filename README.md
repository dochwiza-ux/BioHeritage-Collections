# BHC Field v2.0.0

BHC Field is an offline-first biodiversity collection app for Bio-Heritage Collections. It captures
specimen identity, country-first locations, collection events, preparation
details and images in the browser's device archive. Records synchronize to
Cloudflare D1 and images to R2 when connectivity returns.

The app includes:

- installable PWA behavior and an offline app shell;
- IndexedDB records and queued media on the device;
- an adaptive 16-view anatomical research-photography protocol with documented omissions;
- persistent sequential catalogue numbers and per-image capture metadata;
- specimen provenance, citation, data rights and per-image reuse terms shared between manager and visitor views;
- explicit open, generalized or withheld public-locality controls with server-side redaction;
- conflict-safe synchronization using client-generated IDs and timestamps;
- authenticated write endpoints and anonymous read-only public records;
- publication review checks with an audited manager override;
- visitor-facing Home, About Us, Gallery and correction pages, rotating front-view photography, latest additions, signed images and research-photo requests;
- precision image inspection with cursor-anchored wheel zoom, a drawable Zoom Window, live drag zoom, pan controls and Zoom All;
- a Cloudflare Access-secured manager served from a masked archive address;
- Darwin Core-style CSV export and JSON backup/restore.

Run `node build/build.mjs` to create `dist/`. The deployable Worker is emitted
as `dist/server/index.js`, with the app shell in `dist/client/`.
