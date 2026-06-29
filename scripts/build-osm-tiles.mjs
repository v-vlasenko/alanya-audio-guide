#!/usr/bin/env node
// Build offline OSM-style raster tiles from local OSM data (policy-compliant).
// Do NOT bulk-download from tile.openstreetmap.org — use this script instead.
//
// Pipeline: OSM XML/PBF → Planetiler (vector MBTiles) → tileserver-gl (raster PNG)
//           → tours/<id>/tiles/{z}/{x}/{y}.png
//
// Usage:
//   node scripts/build-osm-tiles.mjs
//   node scripts/build-osm-tiles.mjs alanya-castle
//   node scripts/build-osm-tiles.mjs --osm ~/Downloads/map_full_alanya.osm --replace-tours
//   node scripts/build-osm-tiles.mjs --refresh
//
// Requires Docker:
//   docker pull iboates/osmium:latest
//   docker pull ghcr.io/onthegomap/planetiler:latest
//   docker pull maptiler/tileserver-gl:latest

import { readFile, mkdir, writeFile, access, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const STYLES = join(CACHE, 'styles');
const ZOOM_MIN = 14;
const VECTOR_ZOOM_MAX = 16; // Planetiler OpenMapTiles profile cap
const RASTER_ZOOM_MAX = 18; // tileserver-gl can rasterize above vector max for sharper PNGs
const PAD = 0.0035;
const TS_PORT = 18180;
const RENDER_STYLE = 'osm-bright';

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const exists = (p) => access(p).then(() => true).catch(() => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cacheBase(osmPath) {
  const stem = basename(osmPath).replace(/\.osm\.pbf$/i, '').replace(/\.pbf$/i, '').replace(/\.osm$/i, '');
  return stem === 'map_full_alanya' ? 'alanya' : stem;
}

/** Harbor tiles use the full OSM extract bbox so offline panning is not cropped. */
const TOUR_TILE_BBOX_OSM = { 'alanya-harbor': true };

function parseArgv(argv) {
  const flags = { refresh: false, replaceTours: false, osm: null, tours: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--refresh') flags.refresh = true;
    else if (a === '--replace-tours') flags.replaceTours = true;
    else if (a === '--osm') flags.osm = resolve(argv[++i] || '');
    else if (!a.startsWith('-')) flags.tours.push(a);
  }
  return flags;
}

function dockerRun(image, cmd, { entrypoint, mounts = [] } = {}) {
  const args = ['docker', 'run', '--rm'];
  if (entrypoint) args.push('--entrypoint', entrypoint);
  for (const [host, container, mode] of mounts) {
    args.push('-v', `${host}:${container}${mode ? `:${mode}` : ''}`);
  }
  args.push(image, ...cmd);
  const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    throw new Error(`docker failed (exit ${r.status})${msg ? `: ${msg.slice(-500)}` : ''}`);
  }
  return (r.stdout || '').trim();
}

async function osmBounds(osmPath) {
  const low = osmPath.toLowerCase();
  if (low.endsWith('.pbf') || low.endsWith('.osm.pbf') || low.endsWith('.osm')) {
    const out = dockerRun(
      'iboates/osmium:latest',
      ['fileinfo', '-g', 'header.boxes', `/in/${basename(osmPath)}`],
      { entrypoint: 'osmium', mounts: [[dirname(osmPath), '/in', 'ro']] },
    );
    const m = out.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
    if (!m) return null;
    const [, w, s, e, n] = m.map(Number);
    return { w, s, e, n };
  }
  const xml = await readFile(osmPath, 'utf8');
  const m = xml.match(/<bounds[^>]+minlat="([^"]+)"[^>]+minlon="([^"]+)"[^>]+maxlat="([^"]+)"[^>]+maxlon="([^"]+)"/)
    || xml.match(/<bounds[^>]+minlon="([^"]+)"[^>]+minlat="([^"]+)"[^>]+maxlon="([^"]+)"[^>]+maxlat="([^"]+)"/);
  if (!m) return null;
  if (m[0].includes('minlat="') && m[0].indexOf('minlat') < m[0].indexOf('minlon')) {
    return { s: +m[1], w: +m[2], n: +m[3], e: +m[4] };
  }
  return { w: +m[1], s: +m[2], e: +m[3], n: +m[4] };
}

async function ensurePbf(osmPath, refresh) {
  const low = osmPath.toLowerCase();
  const name = cacheBase(osmPath);
  const pbf = join(CACHE, `${name}.osm.pbf`);
  if (low.endsWith('.pbf') || low.endsWith('.osm.pbf')) {
    if (!refresh && (await exists(pbf))) return pbf;
    await mkdir(CACHE, { recursive: true });
    await copyFile(osmPath, pbf);
    return pbf;
  }
  if (!refresh && (await exists(pbf))) return pbf;
  console.log(`Converting ${basename(osmPath)} → PBF…`);
  await mkdir(CACHE, { recursive: true });
  dockerRun(
    'iboates/osmium:latest',
    ['cat', `/in/${basename(osmPath)}`, '-o', `/out/${name}.osm.pbf`, '--overwrite'],
    { entrypoint: 'osmium', mounts: [[dirname(osmPath), '/in', 'ro'], [CACHE, '/out']] },
  );
  return pbf;
}

async function ensureMbtiles(osmPath, bounds, refresh) {
  const name = cacheBase(osmPath);
  const pbfName = `${name}.osm.pbf`;
  const mbtiles = join(CACHE, `${name}.mbtiles`);
  if (!refresh && (await exists(mbtiles))) return mbtiles;
  console.log(`Building vector MBTiles (${name}) with Planetiler…`);
  const b = `${bounds.w},${bounds.s},${bounds.e},${bounds.n}`;
  dockerRun(
    'ghcr.io/onthegomap/planetiler:latest',
    [
      `--osm-path=/data/${pbfName}`,
      `--output=/data/${name}.mbtiles`,
      '--download',
      '--force',
      `--bounds=${b}`,
      `--minzoom=${ZOOM_MIN}`,
      `--maxzoom=${VECTOR_ZOOM_MAX}`,
    ],
    { mounts: [[CACHE, '/data']] },
  );
  return mbtiles;
}

async function ensureTileserverConfig(osmPath, bounds) {
  const name = cacheBase(osmPath);
  await mkdir(join(STYLES, RENDER_STYLE), { recursive: true });
  const stylePath = join(STYLES, RENDER_STYLE, 'style.json');
  if (!(await exists(stylePath))) {
    console.log('Fetching OSM Bright map style…');
    const res = await fetch('https://raw.githubusercontent.com/openmaptiles/osm-bright-gl-style/master/style.json');
    if (!res.ok) throw new Error('failed to download osm-bright style');
    const style = await res.json();
    style.sources.openmaptiles = { type: 'vector', url: 'mbtiles://{openmaptiles}' };
    style.sprite = 'https://openmaptiles.github.io/osm-bright-gl-style/sprite';
    style.glyphs = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
    await writeFile(stylePath, JSON.stringify(style));
  }
  const config = {
    options: { paths: { root: '/data', styles: 'styles', mbtiles: '/data' } },
    data: { openmaptiles: { mbtiles: `${name}.mbtiles` } },
    styles: {
      [RENDER_STYLE]: {
        style: `${RENDER_STYLE}/style.json`,
        tilejson: { bounds: [bounds.w, bounds.s, bounds.e, bounds.n] },
      },
    },
  };
  await writeFile(join(CACHE, 'config.json'), JSON.stringify(config, null, 2));
}

async function tourBbox(id, osmFileBounds = null) {
  if (TOUR_TILE_BBOX_OSM[id] && osmFileBounds) return { ...osmFileBounds };
  const tour = JSON.parse(await readFile(join(ROOT, 'tours', id, 'tour.json'), 'utf8'));
  const lats = tour.checkpoints.map((c) => c.lat);
  const lngs = tour.checkpoints.map((c) => c.lng);
  return {
    n: Math.max(...lats) + PAD, s: Math.min(...lats) - PAD,
    e: Math.max(...lngs) + PAD, w: Math.min(...lngs) - PAD,
  };
}

async function fetchTile(url, out) {
  const res = await fetch(url);
  if (!res.ok) return false;
  await mkdir(dirname(out), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  return true;
}

async function renderTourTiles(id, replace, osmFileBounds) {
  const bbox = await tourBbox(id, osmFileBounds);
  const outRoot = join(ROOT, 'tours', id, 'tiles');
  if (replace) await rm(outRoot, { recursive: true, force: true });
  let got = 0, skip = 0, fail = 0;
  const base = `http://127.0.0.1:${TS_PORT}/styles/${RENDER_STYLE}`;
  for (let z = ZOOM_MIN; z <= RASTER_ZOOM_MAX; z++) {
    const x0 = lon2x(bbox.w, z), x1 = lon2x(bbox.e, z);
    const y0 = lat2y(bbox.n, z), y1 = lat2y(bbox.s, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const out = join(outRoot, String(z), String(x), `${y}.png`);
        if (!replace && (await exists(out))) { skip++; continue; }
        const ok = await fetchTile(`${base}/${z}/${x}/${y}.png`, out);
        if (ok) got++;
        else fail++;
      }
    }
  }
  await writeFile(
    join(outRoot, 'meta.json'),
    JSON.stringify({ bbox, zoomMin: ZOOM_MIN, zoomMax: RASTER_ZOOM_MAX, source: 'openmaptiles-osm-bright' }, null, 2),
  );
  console.log(`${id}: +${got} rendered, ${skip} kept, ${fail} failed`);
}

async function withTileserver(fn) {
  const name = 'alanya-tileserver';
  spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  const run = spawnSync(
    'docker',
    [
      'run', '-d', '--name', name,
      '-p', `${TS_PORT}:8080`,
      '-v', `${CACHE}:/data`,
      'maptiler/tileserver-gl:latest',
      '--config', '/data/config.json',
      '-p', '8080',
    ],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`tileserver-gl start failed: ${run.stderr}`);
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${TS_PORT}/styles.json`);
        if (r.ok) break;
      } catch { /* wait */ }
      await sleep(500);
    }
    await fn();
  } finally {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  }
}

async function main() {
  const flags = parseArgv(process.argv.slice(2));
  const defaultOsm = resolve(process.env.HOME || '', 'Downloads/map_full_alanya.osm');
  const osmPath = flags.osm || defaultOsm;
  if (!(await exists(osmPath))) {
    throw new Error(`OSM file not found: ${osmPath} (pass --osm <path>)`);
  }

  if (flags.refresh) {
    const name = cacheBase(osmPath);
    await rm(join(CACHE, `${name}.osm.pbf`), { force: true });
    await rm(join(CACHE, `${name}.mbtiles`), { force: true });
  }
  await mkdir(CACHE, { recursive: true });

  const bounds = await osmBounds(osmPath);
  if (!bounds) throw new Error('could not read bounds from OSM file');

  await ensurePbf(osmPath, flags.refresh);
  await ensureMbtiles(osmPath, bounds, flags.refresh);
  await ensureTileserverConfig(osmPath, bounds);

  const index = JSON.parse(await readFile(join(ROOT, 'tours', 'index.json'), 'utf8'));
  const ids = flags.tours.length ? flags.tours : index.tours.map((t) => t.id);

  console.log(`Rendering ${RENDER_STYLE} tiles for ${ids.join(', ')}…`);
  await withTileserver(async () => {
    for (const id of ids) await renderTourTiles(id, flags.replaceTours, bounds);
  });
  console.log('done.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
