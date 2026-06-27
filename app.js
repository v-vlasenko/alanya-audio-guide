/* Аудіогіди Аланії — offline-first multi-tour audio guide (vanilla, no build).
   v1: tour picker, per-tour offline download, manual list+map playback,
   live "you are here" dot (position only). Geofence auto-prompt = v2. */
'use strict';

const SHELL_VERSION = 'v1';
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const netEl = $('#net');

let STR = {};                 // ui strings
let INDEX = null;             // tour catalog
const tourCache = new Map();  // id -> loaded tour.json

/* ---------- tiny helpers ---------- */
const t = (k) => STR[k] ?? k;
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cacheName = (id, version) => `tour-${id}-${version}`;
const fmtTime = (s) => { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const haptic = (ms = 10) => navigator.vibrate?.(ms);

/* slippy-tile math (mirrors scripts/fetch-tiles.mjs) */
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/* ---------- boot ---------- */
async function boot() {
  try {
    [STR, INDEX] = await Promise.all([
      fetch('data/ui-strings-uk.json').then((r) => r.json()),
      fetch('tours/index.json').then((r) => r.json()),
    ]);
  } catch (e) {
    app.innerHTML = '<p>Не вдалося завантажити дані. Перевірте з\'єднання та оновіть сторінку.</p>';
    return;
  }
  document.title = INDEX.appName || document.title;
  initNet();
  detectWebview();
  registerSW();
  window.addEventListener('hashchange', route);
  route();
}

/* ---------- service worker + offline heal ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // re-cache shell on every launch (defensive heal vs iOS eviction)
    const heal = () => navigator.serviceWorker.controller?.postMessage({ type: 'heal' });
    if (navigator.serviceWorker.controller) heal();
    else navigator.serviceWorker.addEventListener('controllerchange', heal, { once: true });
  }).catch(() => {});
}

async function hardRefresh() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
  for (const key of Object.keys(localStorage)) {
    if (key !== 'gpsOff') localStorage.removeItem(key);
  }
  location.reload(true);
}

/* ---------- network indicator ---------- */
function initNet() {
  const setNetH = () => {
    const h = netEl.hidden ? 0 : netEl.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--net-h', h + 'px');
  };
  const upd = () => {
    if (navigator.onLine) {
      netEl.className = 'net on'; netEl.textContent = t('onlineIndicator'); netEl.hidden = true;
    } else {
      netEl.className = 'net off'; netEl.textContent = t('offlineIndicator'); netEl.hidden = false;
    }
    requestAnimationFrame(setNetH);
  };
  window.addEventListener('online', upd);
  window.addEventListener('offline', upd);
  upd();
}

/* detect in-app browser webviews (Telegram/Instagram/etc.) where A2HS is unavailable */
function detectWebview() {
  const ua = navigator.userAgent || '';
  const inApp = /(FBAN|FBAV|Instagram|Telegram|Line|WhatsApp|MicroMessenger)/i.test(ua);
  const isStandalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (inApp && !isStandalone) {
    const w = $('#webview-warn'); w.textContent = t('openInSafariWarning'); w.hidden = false;
  }
}

/* ---------- router ---------- */
function route() {
  stopPlayer();
  teardownMap();
  const m = location.hash.match(/^#\/tour\/([\w-]+)/);
  if (m) renderTour(m[1]); else renderHome();
}

/* ================= HOME / PICKER ================= */
function renderHome() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  app.innerHTML = `
    <header class="home-head">
      <h1>${esc(t('toursTitle'))}</h1>
      <p class="muted">${esc(t('toursSubtitle'))}</p>
    </header>
    <section class="tours" id="tours"></section>
    ${standalone ? '' : `<div class="install-hint"><button class="btn ghost" id="install-help">${esc(t('installTitle'))}</button></div>`}
    <div class="refresh-hint"><button id="hard-refresh">⟳ Скинути кеш</button></div>
  `;
  const wrap = $('#tours');
  INDEX.tours.forEach((tr) => wrap.appendChild(tourCard(tr)));
  if (!standalone) $('#install-help').onclick = showInstallSheet;
  $('#hard-refresh').onclick = hardRefresh;
}

function tourCard(tr) {
  const card = el(`
    <article class="tour-card">
      <div class="cover-wrap">
        <div class="cover"></div>
      </div>
      <div class="tour-body">
        <h2>${esc(tr.title)}</h2>
        <p class="muted">${esc(tr.subtitle || '')}</p>
        ${tr.bestTime ? `<p class="best-time">⏰ ${esc(tr.bestTime)}</p>` : ''}
        <div class="meta-row">
          <span>${esc(t('tourCheckpointsLabel'))}: <b>${tr.checkpointCount}</b></span>
        </div>
        <div class="card-actions">
          <button class="btn secondary dl">${esc(t('downloadTour'))}</button>
        </div>
        <div class="dl-state muted"></div>
      </div>
    </article>`);

  // cover image with graceful fallback to the gradient+title card
  const img = new Image();
  img.src = `${tr.cover}`;
  img.alt = tr.title;
  img.onload = () => { $('.cover', card).replaceWith(img); img.classList.add('cover-img'); };

  // tap anywhere on card (except action buttons) to open tour
  card.onclick = (e) => { if (!e.target.closest('.card-actions, .dl-state')) location.hash = `#/tour/${tr.id}`; };
  wireDownload(tr, card);
  return card;
}

/* ---- per-tour offline download ---- */
async function wireDownload(tr, card) {
  const btn = $('.dl', card);
  const state = $('.dl-state', card);
  const cn = cacheName(tr.id, tr.version);

  async function isDownloaded() {
    if (!('caches' in window)) return false;
    const c = await caches.open(cn);
    return !!(await c.match(tr.path));
  }
  function setDone() {
    btn.textContent = t('tourDownloaded'); btn.classList.add('good'); btn.classList.remove('secondary');
    btn.disabled = true;
    state.innerHTML = `<button class="btn ghost sm del">${esc(t('deleteTourDownload'))}</button>`;
    $('.del', state).onclick = async () => { await caches.delete(cn); refresh(); };
  }
  function setIdle() {
    btn.textContent = t('downloadTour'); btn.disabled = false;
    btn.classList.add('secondary'); btn.classList.remove('good');
    state.innerHTML = '';
  }
  async function refresh() { (await isDownloaded()) ? setDone() : setIdle(); }

  btn.onclick = async () => {
    if (!('caches' in window)) return;
    btn.disabled = true; btn.textContent = t('downloadingTour');
    state.innerHTML = `<div class="dl-bar"><i></i></div>`;
    const bar = $('.dl-bar > i', state);
    try {
      const urls = await tourAssetUrls(tr);
      const cache = await caches.open(cn);
      let done = 0;
      for (const u of urls) {
        try {
          const res = await fetch(u, { cache: 'reload' });
          if (res.ok) await cache.put(u, res.clone());
        } catch { /* cover may 404 (placeholder) — ignore */ }
        done++; bar.style.width = `${Math.round((done / urls.length) * 100)}%`;
      }
      setDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = t('downloadTour');
      state.innerHTML = `<span class="muted">⚠︎ ${esc(t('errorAudioBody'))}</span>`;
    }
  };
  refresh();
}

/* full asset list for a tour: tour.json + audio + cover + all map tiles */
async function tourAssetUrls(tr) {
  const tour = await loadTour(tr.id);
  const base = tour.basePath;
  const urls = [tr.path, tr.cover];
  tour.checkpoints.forEach((c) => urls.push(base + c.audio));
  // tiles
  try {
    const meta = await fetch(`${base}tiles/meta.json`).then((r) => r.json());
    const { bbox, zoomMin, zoomMax } = meta;
    for (let z = zoomMin; z <= zoomMax; z++) {
      const x0 = lon2x(bbox.w, z), x1 = lon2x(bbox.e, z);
      const y0 = lat2y(bbox.n, z), y1 = lat2y(bbox.s, z);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) urls.push(`${base}tiles/${z}/${x}/${y}.png`);
    }
    urls.push(`${base}tiles/meta.json`);
  } catch { /* no tiles yet */ }
  return [...new Set(urls)];
}

/* ================= TOUR VIEW ================= */
let activeTour = null;
let visitedSet = new Set();
let completedSet = new Set();

async function loadTour(id) {
  if (tourCache.has(id)) return tourCache.get(id);
  const tr = INDEX.tours.find((x) => x.id === id);
  const tour = await fetch(tr.path).then((r) => r.json());
  tourCache.set(id, tour);
  return tour;
}

async function renderTour(id) {
  const meta = INDEX.tours.find((x) => x.id === id);
  if (!meta) { location.hash = '#/'; return; }
  let tour;
  try { tour = await loadTour(id); }
  catch { app.innerHTML = `<p>${esc(t('notDownloadedHint'))}</p><button class="btn" onclick="location.hash='#/'">${esc(t('backToTours'))}</button>`; return; }
  activeTour = tour;
  visitedSet = loadVisited(id);
  completedSet = loadCompleted(id);

  app.innerHTML = `
    <div class="topbar">
      <button class="btn ghost sm" id="back">${esc(t('backToTours'))}</button>
      <h2>${esc(tour.title)}</h2>
    </div>
    ${tour.tip ? `<div class="tip">💡 ${esc(tour.tip)}</div>` : ''}
    <button class="btn" id="start">${esc(t('startTour'))}</button>
    <div class="tabs" role="tablist">
      <button id="tab-list" role="tab" aria-selected="false">${esc(t('tabList'))}</button>
      <button id="tab-map" role="tab" aria-selected="true">${esc(t('tabMap'))}</button>
    </div>
    <section id="pane-list" hidden></section>
    <section id="pane-map"></section>
    <div class="player" id="player"></div>
  `;
  $('#back').onclick = () => { location.hash = '#/'; };
  const savedIdx = loadProgress(id);
  if (savedIdx >= 0 && savedIdx < tour.checkpoints.length) {
    const cp = ordered()[savedIdx];
    if (cp) $('#start').textContent = `▶ Продовжити: ${cp.shortTitle || cp.title}`;
    $('#start').onclick = () => { haptic(); playIndex(savedIdx); };
  } else {
    $('#start').onclick = () => { haptic(); playIndex(0); };
  }
  $('#tab-list').onclick = () => switchTab('list');
  $('#tab-map').onclick = () => switchTab('map');
  buildPlayer();
  renderList();
  renderMap();
}

function switchTab(which) {
  const isMap = which === 'map';
  $('#tab-list').setAttribute('aria-selected', String(!isMap));
  $('#tab-map').setAttribute('aria-selected', String(isMap));
  $('#pane-list').hidden = isMap;
  $('#pane-map').hidden = !isMap;
  if (isMap) renderMap();
}

function renderList() {
  const pane = $('#pane-list');
  pane.innerHTML = '<div class="cp-list"></div>';
  const list = $('.cp-list', pane);
  activeTour.checkpoints.slice().sort((a, b) => a.order - b.order).forEach((cp, i) => {
    const row = el(`
      <button class="cp" data-i="${i}">
        <span class="num">${cp.order}</span>
        <span class="t">
          <b>${esc(cp.shortTitle || cp.title)}</b>
          ${cp.optional ? `<span class="badge">${esc(t('optionalBadge'))}</span>` : ''}
          <span class="state"></span>
        </span>
        <span class="num play">▶︎</span>
      </button>`);
    if (completedSet.has(cp.id)) { const s = $('.state', row); s.textContent = '✓'; s.classList.add('done'); }
    else if (visitedSet.has(cp.id)) $('.state', row).textContent = t('visited');
    row.onclick = () => { haptic(); playIndex(i); };
    list.appendChild(row);
  });
}

/* ================= MAP (Leaflet + bundled tiles + live dot) ================= */
let map = null, meLayer = null, watchId = null, didFit = false;
let wpMarkers = [], showWp = true;

function teardownMap() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (map) { map.remove(); map = null; }
  meLayer = null; didFit = false; wpMarkers = []; showWp = true;
}

async function renderMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
  const pane = $('#pane-map');
  pane.innerHTML = `
    <div class="map-wrap">
      <div id="map"></div>
      <button class="recenter" id="recenter" title="${esc(t('gpsToggleLabel'))}">◎</button>
      <button class="layer-btn" id="layer-btn" title="Супутниковий вигляд">🛰</button>
      <button class="wp-btn" id="wp-toggle" title="Показати/сховати точки інтересу">ℹ</button>
      <button class="gps-btn" id="gps-btn" title="GPS геопозиція">📍</button>
    </div>`;

  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  const base = activeTour.basePath;
  let bbox = null;
  try { bbox = (await fetch(`${base}tiles/meta.json`).then((r) => r.json())).bbox; } catch {}

  map = L.map('map', { zoomControl: true, attributionControl: true, doubleClickZoom: true });

  // Street layer: local offline tiles first, Esri street fallback for tiles outside bbox.
  // Satellite layer: pure online Esri — local tiles are street map, mixing them causes a
  // jarring split between street-map center and satellite surroundings.
  const ESRI_STREET_URL = (c) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${c.z}/${c.y}/${c.x}`;
  const ESRI_SAT_TMPL   = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  function makeHybrid(basePath, fallbackUrl) {
    return L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = `${basePath}tiles/${coords.z}/${coords.x}/${coords.y}.png`;
        img.onload = () => done(null, img);
        img.onerror = () => {
          img.onerror = () => done(new Error('tile'), img);
          img.src = fallbackUrl(coords);
        };
        return img;
      },
    });
  }

  const HybridStreet = makeHybrid(base, ESRI_STREET_URL);

  let isSat = false;
  let curLayer = new HybridStreet('', { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(map);

  $('#layer-btn').onclick = () => {
    isSat = !isSat;
    map.removeLayer(curLayer);
    if (isSat) {
      curLayer = L.tileLayer(ESRI_SAT_TMPL, { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri, Maxar' }).addTo(map);
      $('#layer-btn').textContent = '🗺';
      $('#layer-btn').title = 'Звичайний вигляд';
    } else {
      curLayer = new HybridStreet('', { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(map);
      $('#layer-btn').textContent = '🛰';
      $('#layer-btn').title = 'Супутниковий вигляд';
    }
  };

  // numbered markers
  const pts = [];
  activeTour.checkpoints.forEach((cp) => {
    const cls = cp.optional ? 'pin optional' : 'pin';
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"><span>${cp.order}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
    const mk = L.marker([cp.lat, cp.lng], { icon }).addTo(map);
    mk.on('click', () => { haptic(); playById(cp.id); });
    pts.push([cp.lat, cp.lng]);
  });

  // info-only waypoints (no audio, map popup only)
  (activeTour.waypoints || []).forEach((wp) => {
    const icon = L.divIcon({ className: '', html: '<div class="wp-pin"><span>ℹ</span></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
    const wpMk = L.marker([wp.lat, wp.lng], { icon }).addTo(map)
      .bindPopup(`<b>${wp.title}</b><br><span style="font-size:13px">${wp.description}</span>`, { maxWidth: 220 })
      .on('click', () => haptic());
    wpMarkers.push(wpMk);
    pts.push([wp.lat, wp.lng]);
  });

  const hasWp = (activeTour.waypoints || []).length > 0;
  $('#wp-toggle').hidden = !hasWp;
  if (hasWp) {
    $('#wp-toggle').onclick = () => {
      showWp = !showWp;
      wpMarkers.forEach((m) => (showWp ? m.addTo(map) : map.removeLayer(m)));
      $('#wp-toggle').classList.toggle('off', !showWp);
      haptic(8);
    };
  }

  if (bbox) map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]]);
  else if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
  setTimeout(() => map.invalidateSize(), 60);

  $('#recenter').onclick = () => { if (meLayer) map.panTo(meLayer.getLatLng()); };

  const gpsOff = localStorage.getItem('gpsOff') === '1';
  const gpsBtn = $('#gps-btn');
  gpsBtn.classList.toggle('off', gpsOff);
  gpsBtn.onclick = () => {
    const nowOff = localStorage.getItem('gpsOff') !== '1';
    localStorage.setItem('gpsOff', nowOff ? '1' : '0');
    gpsBtn.classList.toggle('off', nowOff);
    haptic(8);
    if (nowOff) {
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (meLayer) { map.removeLayer(meLayer); meLayer = null; }
    } else {
      startWatch();
    }
  };
  if (!gpsOff) startWatch();
}

function startWatch() {
  if (!('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!meLayer) {
        meLayer = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
        if (!didFit) { map.setView(ll, 17); didFit = true; }
      } else meLayer.setLatLng(ll);
    },
    () => {},                                   // denied/err: map still works, no dot
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

/* ================= PLAYER ================= */
let audio = null, curIdx = -1;
let playSpeed = 1.0;

function buildPlayer() {
  const p = $('#player');
  p.innerHTML = `
    <div class="pt"><span id="p-title"></span><button class="close" id="p-close">✕</button></div>
    <div class="seek">
      <span id="p-cur">0:00</span>
      <input type="range" id="p-seek" min="0" max="100" value="0" step="1">
      <span id="p-dur">0:00</span>
    </div>
    <div class="pcontrols">
      <button class="btn secondary" id="p-prev">${esc(t('previous'))}</button>
      <button class="btn" id="p-play">${esc(t('play'))}</button>
      <button class="btn secondary" id="p-next">${esc(t('next'))}</button>
    </div>
    <div class="p-speed-row"><button class="btn ghost sm" id="p-speed" title="Швидкість відтворення">1×</button></div>
    <div class="transcript" id="p-transcript"></div>
  `;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', () => { $('#p-dur').textContent = fmtTime(audio.duration); $('#p-seek').max = Math.floor(audio.duration) || 100; });
  audio.addEventListener('timeupdate', () => {
    const cur = $('#p-cur'); if (!cur) return;
    cur.textContent = fmtTime(audio.currentTime);
    if (!seeking) $('#p-seek').value = Math.floor(audio.currentTime);
    if (audio.duration > 0 && audio.currentTime / audio.duration >= 0.5) {
      const cp = ordered()[curIdx];
      if (cp) markVisited(cp.id);
    }
  });
  audio.addEventListener('play', () => { const b = $('#p-play'); if (b) b.textContent = t('pause'); markPlaying(true); });
  audio.addEventListener('pause', () => { const b = $('#p-play'); if (b) b.textContent = t('play'); markPlaying(false); });
  audio.addEventListener('ended', () => {
    markCompleted(curIdx);
    if (activeTour && curIdx < activeTour.checkpoints.length - 1) playIndex(curIdx + 1);
    else if (activeTour) showCompletion();
  });
  audio.addEventListener('error', () => { toast(t('errorAudioBody')); });

  let seeking = false;
  const seek = $('#p-seek');
  seek.addEventListener('input', () => { seeking = true; $('#p-cur').textContent = fmtTime(seek.value); });
  seek.addEventListener('change', () => { audio.currentTime = Number(seek.value); seeking = false; });
  const SPEEDS = [1.0, 1.25, 1.5, 0.75];
  let speedIdx = 0;
  $('#p-speed').onclick = () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    playSpeed = SPEEDS[speedIdx];
    audio.playbackRate = playSpeed;
    $('#p-speed').textContent = playSpeed + '×';
    haptic(8);
  };
  $('#p-play').onclick = () => { haptic(); audio.paused ? audio.play() : audio.pause(); };
  $('#p-prev').onclick = () => { haptic(); if (curIdx > 0) playIndex(curIdx - 1); };
  $('#p-next').onclick = () => { haptic(); if (curIdx < activeTour.checkpoints.length - 1) playIndex(curIdx + 1); };
  $('#p-close').onclick = stopPlayer;
}

const ordered = () => activeTour.checkpoints.slice().sort((a, b) => a.order - b.order);

function playIndex(i) {
  const cp = ordered()[i];
  if (!cp) return;
  curIdx = i;
  const hasAudio = !!cp.audio;
  if (hasAudio) {
    audio.src = activeTour.basePath + cp.audio;
    audio.playbackRate = playSpeed;
  } else {
    audio.pause();
    audio.removeAttribute('src');
  }
  $('#player').classList.toggle('info-only', !hasAudio);
  saveProgress(activeTour.id, i);
  $('#p-title').textContent = `${cp.order}. ${cp.shortTitle || cp.title}`;
  $('#p-transcript').textContent = cp.transcript || '';
  $('#p-transcript').scrollTop = 0;
  $('#player').classList.add('open');
}
function playById(id) { const i = ordered().findIndex((c) => c.id === id); if (i >= 0) playIndex(i); }

function markPlaying(on) {
  document.querySelectorAll('.cp').forEach((r) => r.classList.remove('playing'));
  if (on && curIdx >= 0) document.querySelector(`.cp[data-i="${curIdx}"]`)?.classList.add('playing');
}
function stopPlayer() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); }
  curIdx = -1;
  $('#player')?.classList.remove('open');
}

/* visited persistence */
function loadVisited(id) { try { return new Set(JSON.parse(localStorage.getItem('visited-' + id) || '[]')); } catch { return new Set(); } }
function markVisited(cpId) {
  if (!activeTour || visitedSet.has(cpId)) return;
  visitedSet.add(cpId);
  localStorage.setItem('visited-' + activeTour.id, JSON.stringify([...visitedSet]));
  const i = ordered().findIndex((c) => c.id === cpId);
  const row = document.querySelector(`.cp[data-i="${i}"] .state`);
  if (row && !completedSet.has(cpId)) row.textContent = t('visited');
}

/* completed persistence (✓ after audio ends) */
function loadCompleted(id) { try { return new Set(JSON.parse(localStorage.getItem('completed-' + id) || '[]')); } catch { return new Set(); } }
function markCompleted(idx) {
  if (!activeTour) return;
  const cp = ordered()[idx];
  if (!cp) return;
  completedSet.add(cp.id);
  localStorage.setItem('completed-' + activeTour.id, JSON.stringify([...completedSet]));
  const row = document.querySelector(`.cp[data-i="${idx}"] .state`);
  if (row) { row.textContent = '✓'; row.classList.add('done'); }
}

/* progress persistence (resume where user left off) */
function loadProgress(id) { return parseInt(localStorage.getItem('progress-' + id) ?? '-1', 10); }
function saveProgress(id, idx) { localStorage.setItem('progress-' + id, idx); }

/* tour completion screen */
function showCompletion() {
  localStorage.removeItem('progress-' + activeTour.id);
  haptic(40);
  const title = esc(activeTour?.title || '');
  const overlay = el(`
    <div class="completion-overlay" id="completion-overlay">
      <div class="completion-card">
        <div class="completion-emoji">🎉</div>
        <h2>Тур завершено!</h2>
        <p class="muted">${title}</p>
        <div class="completion-actions">
          <button class="btn" id="comp-share">Поділитися</button>
          <button class="btn secondary" id="comp-home">На головну</button>
          <button class="btn ghost sm" id="comp-replay">Спочатку</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  $('#comp-share', overlay).onclick = async () => {
    haptic();
    if (navigator.share) {
      try { await navigator.share({ title: activeTour?.title, url: location.href }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(location.href); toast('Посилання скопійовано'); } catch {}
    }
  };
  $('#comp-home', overlay).onclick = () => { haptic(); overlay.remove(); location.hash = '#/'; };
  $('#comp-replay', overlay).onclick = () => { haptic(); overlay.remove(); playIndex(0); };
}

/* ---------- install sheet ---------- */
function showInstallSheet() {
  const sheet = el(`
    <div class="sheet-backdrop" id="sheet-bd">
      <div class="sheet">
        <h2>${esc(t('installTitle'))}</h2>
        <ol>
          <li>${esc(t('installStep1'))}</li>
          <li>${esc(t('installStep2'))}</li>
          <li>${esc(t('installStep3'))}</li>
          <li>${esc(t('installStep4'))}</li>
        </ol>
        <button class="btn" id="sheet-close">${esc(t('close'))}</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  $('#sheet-close', sheet).onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
}

function toast(msg) {
  const tEl = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(tEl);
  setTimeout(() => tEl.remove(), 2600);
}

boot();
