#!/usr/bin/env node
// Pre-download OSM map tiles for each tour so the map works fully OFFLINE.
// Run ONCE on wifi:  node scripts/fetch-tiles.mjs            (all tours)
//                    node scripts/fetch-tiles.mjs alanya-castle   (one tour)
//
// Computes a bounding box from each tour's checkpoint coords + padding,
// then fetches tiles for ZOOM_MIN..ZOOM_MAX into tours/<id>/tiles/{z}/{x}/{y}.png.
// Tiles are tiny areas (a few MB/tour). Re-run after you move/verify coords.

import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZOOM_MIN = 14;
const ZOOM_MAX = 18;
const PAD = 0.0035;            // ~350m padding around the stops
// Esri World Street Map: no API key, attribution-only, tolerates offline bundling
// for a tiny personal area. NOTE: URL order is z/y/x; we still SAVE as {z}/{x}/{y}.png
// so the Leaflet template stays {z}/{x}/{y}. (tile.openstreetmap.org blocks bulk
// downloads — it serves an "Access blocked" notice image, so don't use it here.)
const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
const UA = 'alanya-audio-guide/1.0 (personal offline PWA)';
const SLEEP_MS = 60;           // be polite to the tile server

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true).catch(() => false);

async function tilesForTour(id) {
  const tour = JSON.parse(await readFile(join(ROOT, 'tours', id, 'tour.json'), 'utf8'));
  const lats = tour.checkpoints.map((c) => c.lat);
  const lngs = tour.checkpoints.map((c) => c.lng);
  const bbox = {
    n: Math.max(...lats) + PAD, s: Math.min(...lats) - PAD,
    e: Math.max(...lngs) + PAD, w: Math.min(...lngs) - PAD,
  };
  let got = 0, skip = 0, fail = 0;
  for (let z = ZOOM_MIN; z <= ZOOM_MAX; z++) {
    const x0 = lon2x(bbox.w, z), x1 = lon2x(bbox.e, z);
    const y0 = lat2y(bbox.n, z), y1 = lat2y(bbox.s, z); // n has smaller y
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const out = join(ROOT, 'tours', id, 'tiles', String(z), String(x), `${y}.png`);
        if (await exists(out)) { skip++; continue; }
        try {
          const res = await fetch(TILE_URL(z, x, y), { headers: { 'User-Agent': UA } });
          if (!res.ok) { fail++; continue; }
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, Buffer.from(await res.arrayBuffer()));
          got++;
          await sleep(SLEEP_MS);
        } catch { fail++; }
      }
    }
  }
  // persist bbox so the app can fit the map without recomputing
  await writeFile(
    join(ROOT, 'tours', id, 'tiles', 'meta.json'),
    JSON.stringify({ bbox, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX }, null, 2)
  );
  console.log(`${id}: +${got} fetched, ${skip} cached, ${fail} failed  bbox=${JSON.stringify(bbox)}`);
}

const args = process.argv.slice(2);
const index = JSON.parse(await readFile(join(ROOT, 'tours', 'index.json'), 'utf8'));
const ids = args.length ? args : index.tours.map((t) => t.id);
for (const id of ids) await tilesForTour(id);
console.log('done.');
