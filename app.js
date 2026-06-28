/* Аудіогіди Аланії — offline-first multi-tour audio guide (vanilla, no build).
   v1: tour picker, per-tour offline download, manual list+map playback,
   GPS proximity prompt-to-play (nearest-first in clusters), live position dot. */
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

const MARK_ICON = {
  done: '<svg class="mark-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
};

const PLAY_ICON = '<svg class="p-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg class="p-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>';

const EARTH_R = 6371000;
function haversineM(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLng = r(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

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
  hideNearbyCard();
  promptedSet = new Set();
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

function tourCheckpointTotal(tr) {
  if (activeTour?.id === tr.id) return activeTour.checkpoints.length;
  return tr.checkpointCount || 0;
}

function isTourFullyCompleted(id, total) {
  if (!total) return false;
  return loadCompleted(id).size >= total;
}

function tourCard(tr) {
  const full = isTourFullyCompleted(tr.id, tourCheckpointTotal(tr));
  const card = el(`
    <article class="tour-card${full ? ' is-complete' : ''}">
      <div class="cover-wrap">
        <div class="cover"></div>
      </div>
      <div class="tour-body">
        <h2>${esc(tr.title)}</h2>
        <p class="muted">${esc(tr.subtitle || '')}</p>
        ${full ? `<p class="tour-done-badge">${esc(t('tourFullyCompleted'))}</p>` : ''}
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
  completedSet = loadCompleted(id);
  promptedSet = new Set();

  app.innerHTML = `
    <div class="tour-header">
      <div class="tour-back-bar">
        <button class="btn ghost sm tour-back" id="back">${esc(t('backToTours'))}</button>
      </div>
      <h2 class="tour-title">${esc(tour.title)}</h2>
      <details class="hints-fold">
        <summary>${esc(t('hintsSummary'))}</summary>
        <div class="hints-body">
          ${tour.tip ? `<p>💡 ${esc(tour.tip)}</p>` : ''}
          <p>${esc(t('gpsKeepOpenTip'))}</p>
        </div>
      </details>
      <div class="tour-toolbar">
        <button class="btn tour-start" id="start">${esc(t('startTour'))}</button>
      </div>
      <div class="tabs" role="tablist">
        <button id="tab-list" role="tab" aria-selected="false">${esc(t('tabList'))}</button>
        <button id="tab-map" role="tab" aria-selected="true">${esc(t('tabMap'))}</button>
      </div>
    </div>
    <section id="pane-list" hidden></section>
    <section id="pane-map"></section>
    <div class="nearby-card" id="nearby-card" hidden></div>
    <div class="player" id="player"></div>
  `;
  $('#back').onclick = () => { location.hash = '#/'; };
  const savedIdx = loadProgress(id);
  if (savedIdx >= 0 && savedIdx < tour.checkpoints.length) {
    const cp = ordered()[savedIdx];
    if (cp) $('#start').textContent = `▶ ${cp.shortTitle || cp.title}`;
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
    const card = el(`<div class="cp-card" data-i="${i}"></div>`);
    const row = el(`
      <button class="cp" data-i="${i}" data-id="${cp.id}">
        <span class="num">${cp.order}</span>
        <span class="t">
          <b>${esc(cp.shortTitle || cp.title)}</b>
          ${cp.optional ? `<span class="badge">${esc(t('optionalBadge'))}</span>` : ''}
          <span class="state"></span>
        </span>
      </button>`);
    const markBtn = el(`<button type="button" class="cp-mark" title="${esc(t('markCompleted'))}"></button>`);
    if (!cp.audio) markBtn.hidden = true;
    markBtn.onclick = (e) => { e.stopPropagation(); haptic(); toggleMarkCompleted(cp.id); };
    card.appendChild(row);
    card.appendChild(markBtn);
    syncCpListRow(cp.id, row, markBtn);
    row.onclick = () => { haptic(); playIndex(i); };
    list.appendChild(card);
  });
}

function syncCpListRow(cpId, row, markBtn) {
  if (!row) {
    const i = ordered().findIndex((c) => c.id === cpId);
    const card = document.querySelector(`.cp-card[data-i="${i}"]`);
    row = card?.querySelector('.cp');
    markBtn = card?.querySelector('.cp-mark');
  }
  if (!row) return;
  const card = row.closest('.cp-card');
  const cp = ordered().find((c) => c.id === cpId);
  if (!cp) return;
  const num = $('.num', row);
  const state = $('.state', row);
  const done = completedSet.has(cpId);
  if (done) {
    card?.classList.add('completed');
    num.textContent = cp.order;
    num.classList.add('done');
    state.textContent = '';
    state.classList.remove('done');
  } else {
    card?.classList.remove('completed');
    num.textContent = cp.order;
    num.classList.remove('done');
    state.textContent = '';
    state.classList.remove('done');
  }
  if (markBtn) {
    markBtn.classList.toggle('done', done);
    markBtn.innerHTML = done ? MARK_ICON.done : '';
    markBtn.setAttribute('aria-label', done ? t('markCompletedUndo') : t('markCompleted'));
    markBtn.title = done ? t('markCompletedUndo') : t('markCompleted');
  }
}

/* ================= MAP (Leaflet + bundled tiles + live dot) ================= */
let map = null, meLayer = null, watchId = null, didFit = false;
let wpMarkers = [], cpMarkers = new Map(), showWp = true;
let promptedSet = new Set();
let lastPos = null;

function cpRadius(cp) {
  return cp.radiusM ?? activeTour?.defaultRadiusM ?? 30;
}

function checkpointsInRange(lat, lng) {
  if (!activeTour) return [];
  return ordered()
    .map((cp) => ({ cp, dist: haversineM(lat, lng, cp.lat, cp.lng) }))
    .filter(({ cp, dist }) => dist <= cpRadius(cp))
    .sort((a, b) => a.dist - b.dist);
}

function hideNearbyCard() {
  const card = $('#nearby-card');
  if (card) { card.hidden = true; card.innerHTML = ''; }
}

function dismissNearby(ids) {
  ids.forEach((id) => promptedSet.add(id));
  hideNearbyCard();
  haptic(8);
}

function pickNearby(cpId) {
  promptedSet.add(cpId);
  hideNearbyCard();
  haptic();
  playById(cpId);
}

function showNearbyCard(inRange) {
  const pending = inRange.filter(({ cp }) => !promptedSet.has(cp.id));
  if (!pending.length) { hideNearbyCard(); return; }

  const card = $('#nearby-card');
  if (!card) return;

  if (pending.length === 1) {
    const { cp } = pending[0];
    card.innerHTML = `
      <button type="button" class="nearby-x" aria-label="${esc(t('close'))}">✕</button>
      <p class="nearby-msg">${esc(t('nearbyPrefix'))} <b>${esc(cp.shortTitle || cp.title)}</b></p>
      <button type="button" class="btn nearby-go">${esc(t('listen'))}</button>`;
    $('.nearby-x', card).onclick = () => dismissNearby([cp.id]);
    $('.nearby-go', card).onclick = () => pickNearby(cp.id);
  } else {
    const rows = pending.slice(0, 4).map(({ cp }) =>
      `<button type="button" class="btn secondary nearby-pick" data-id="${esc(cp.id)}">${cp.order}. ${esc(cp.shortTitle || cp.title)} — ${esc(t('listen'))}</button>`
    ).join('');
    card.innerHTML = `
      <button type="button" class="nearby-x" aria-label="${esc(t('close'))}">✕</button>
      <p class="nearby-msg"><b>${esc(t('nearbyMultiple'))}</b></p>
      <p class="nearby-hint muted">${esc(t('nearbyChoose'))}</p>
      <div class="nearby-picks">${rows}</div>`;
    $('.nearby-x', card).onclick = () => dismissNearby(pending.slice(0, 4).map(({ cp }) => cp.id));
    card.querySelectorAll('.nearby-pick').forEach((btn) => {
      btn.onclick = () => pickNearby(btn.dataset.id);
    });
  }
  card.hidden = false;
  const p = $('#player');
  if (p?.classList.contains('open')) {
    setNearbyPlayerOffset(p.classList.contains('mini') ? 'mini' : 'full');
  }
}

function checkProximity(lat, lng) {
  if (!activeTour) return;
  if (audio && !audio.paused) return;
  lastPos = { lat, lng };
  showNearbyCard(checkpointsInRange(lat, lng));
}

function cpPinHtml(cp) {
  const done = completedSet.has(cp.id);
  const cls = ['pin', cp.optional && 'optional', done && 'done'].filter(Boolean).join(' ');
  return `<div class="${cls}"><span>${cp.order}</span></div>`;
}

function cpPinIcon(cp) {
  return L.divIcon({ className: '', html: cpPinHtml(cp), iconSize: [30, 30], iconAnchor: [15, 30] });
}

function syncCpMapPin(cpId) {
  const mk = cpMarkers.get(cpId);
  if (!mk) return;
  const cp = ordered().find((c) => c.id === cpId);
  if (!cp) return;
  mk.setIcon(cpPinIcon(cp));
}

function refreshAllCpPins() {
  ordered().forEach((cp) => syncCpMapPin(cp.id));
}

function teardownMap() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (map) { map.remove(); map = null; }
  meLayer = null; didFit = false; wpMarkers = []; cpMarkers = new Map(); showWp = true;
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
    const mk = L.marker([cp.lat, cp.lng], { icon: cpPinIcon(cp) }).addTo(map);
    mk.on('click', () => { haptic(); playById(cp.id); });
    cpMarkers.set(cp.id, mk);
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
  if (!hasWp) $('#gps-btn').style.bottom = '140px';
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
      didFit = false;
      if (bbox) map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]]);
      else if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
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
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const ll = [lat, lng];
      if (!meLayer) {
        meLayer = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
        if (!didFit) { map.setView(ll, 17); didFit = true; }
      } else meLayer.setLatLng(ll);
      checkProximity(lat, lng);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

/* ================= PLAYER ================= */
let audio = null, curIdx = -1;
let playSpeed = 1.0;
let maxListenedSec = 0;
const COMPLETE_RATIO = 0.95;
const SKIP_SEC = 5;

function ensurePlayerBackdrop() {
  if ($('#player-backdrop')) return;
  const bd = el('<div class="player-backdrop" id="player-backdrop" aria-hidden="true"></div>');
  bd.onclick = () => {
    const p = $('#player');
    if (p?.classList.contains('open') && !p.classList.contains('mini') && !p.classList.contains('info-only')) {
      minimizePlayer();
    }
  };
  document.body.appendChild(bd);
}

function setPlayerBackdrop(on) {
  ensurePlayerBackdrop();
  $('#player-backdrop')?.classList.toggle('visible', !!on);
}

function setNearbyPlayerOffset(mode) {
  const card = $('#nearby-card');
  if (!card) return;
  card.classList.remove('above-player', 'above-player-mini');
  if (mode === 'full') card.classList.add('above-player');
  else if (mode === 'mini') card.classList.add('above-player-mini');
}

function syncPlayerChrome() {
  const dismiss = $('#p-dismiss');
  const p = $('#player');
  if (!dismiss || !p) return;
  dismiss.setAttribute('aria-label', p.classList.contains('mini') ? t('close') : 'Згорнути');
}

function minimizePlayer() {
  const p = $('#player');
  if (!p?.classList.contains('open') || p.classList.contains('mini') || p.classList.contains('info-only')) return;
  haptic(8);
  p.classList.add('mini');
  setPlayerBackdrop(false);
  syncPlayerChrome();
  if ($('#nearby-card') && !$('#nearby-card').hidden) setNearbyPlayerOffset('mini');
}

function expandPlayer() {
  const p = $('#player');
  if (!p?.classList.contains('open') || !p.classList.contains('mini')) return;
  haptic(8);
  p.classList.remove('mini');
  syncPlayerChrome();
  if (!p.classList.contains('info-only')) {
    setPlayerBackdrop(true);
    if ($('#nearby-card') && !$('#nearby-card').hidden) setNearbyPlayerOffset('full');
  }
}

function skipAudio(deltaSec) {
  if (!audio?.src) return;
  const max = audio.duration || 0;
  audio.currentTime = Math.max(0, Math.min(max, audio.currentTime + deltaSec));
}

let mediaSessionReady = false;

function iconUrl(path) {
  try { return new URL(path, location.href).href; } catch { return path; }
}

function updateMediaSession(cp) {
  if (!('mediaSession' in navigator) || !cp?.audio) return;
  const title = `${cp.order}. ${cp.shortTitle || cp.title}`;
  const artist = activeTour?.title || INDEX?.appName || '';
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: INDEX?.appName || '',
      artwork: [
        { src: iconUrl('icons/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
        { src: iconUrl('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      ],
    });
  } catch {}
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !audio?.src) return;
  const dur = audio.duration;
  if (!dur || !Number.isFinite(dur)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: dur,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, dur),
    });
  } catch {}
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  } catch {}
}

function setupMediaSessionHandlers() {
  if (mediaSessionReady || !('mediaSession' in navigator)) return;
  mediaSessionReady = true;
  const safe = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  };
  safe('play', () => { haptic(); audio?.play(); });
  safe('pause', () => { haptic(); audio?.pause(); });
  safe('previoustrack', () => { if (curIdx > 0) { haptic(); goTrack(curIdx - 1); } });
  safe('nexttrack', () => {
    if (activeTour && curIdx < activeTour.checkpoints.length - 1) { haptic(); goTrack(curIdx + 1); }
  });
  safe('seekbackward', (d) => { haptic(8); skipAudio(-(d?.seekOffset || SKIP_SEC)); });
  safe('seekforward', (d) => { haptic(8); skipAudio(d?.seekOffset || SKIP_SEC); });
}

function buildPlayer() {
  ensurePlayerBackdrop();
  setupMediaSessionHandlers();
  const p = $('#player');
  p.innerHTML = `
    <div class="pt" id="p-head">
      <span id="p-title"></span>
      <button class="close" id="p-dismiss" type="button" aria-label="Згорнути">✕</button>
    </div>
    <div class="seek">
      <span id="p-cur">0:00</span>
      <input type="range" id="p-seek" min="0" max="100" value="0" step="1">
      <div class="seek-end">
        <span id="p-dur">0:00</span>
        <button class="p-ctl" id="p-speed" type="button" title="Швидкість відтворення">1×</button>
        <button class="p-ctl" id="p-skip-back" type="button" title="−5 с">−5</button>
        <button class="p-ctl" id="p-skip-fwd" type="button" title="+5 с">+5</button>
      </div>
    </div>
    <div class="pcontrols">
      <button class="btn secondary p-nav" id="p-prev" type="button">${esc(t('previous'))}</button>
      <button class="btn p-play-btn" id="p-play" type="button" aria-label="${esc(t('playLabel'))}">${PLAY_ICON}</button>
      <button class="btn secondary p-nav" id="p-next" type="button">${esc(t('next'))}</button>
    </div>
    <div class="p-mark-row" id="p-mark-row"><button class="btn ghost sm" id="p-mark-done">${esc(t('markCompleted'))}</button></div>
    <div class="transcript" id="p-transcript"></div>
  `;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', () => {
    $('#p-dur').textContent = fmtTime(audio.duration);
    $('#p-seek').max = Math.floor(audio.duration) || 100;
    updateMediaSessionPosition();
  });
  audio.addEventListener('timeupdate', () => {
    const cur = $('#p-cur'); if (!cur) return;
    cur.textContent = fmtTime(audio.currentTime);
    if (!seeking) {
      $('#p-seek').value = Math.floor(audio.currentTime);
      if (audio.currentTime > maxListenedSec) maxListenedSec = audio.currentTime;
    }
    updateMediaSessionPosition();
  });
  const setPlayBtn = (playing) => {
    const b = $('#p-play');
    if (!b) return;
    b.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    b.setAttribute('aria-label', playing ? t('pauseLabel') : t('playLabel'));
  };
  audio.addEventListener('play', () => {
    setPlayBtn(true); markPlaying(true);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  audio.addEventListener('pause', () => {
    setPlayBtn(false); markPlaying(false);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    if (lastPos) checkProximity(lastPos.lat, lastPos.lng);
  });
  audio.addEventListener('ended', () => {
    maxListenedSec = Math.max(maxListenedSec, audio.duration || 0);
    if (tryMarkCompleted(curIdx)) {
      const total = audioCheckpointCount(activeTour);
      if (!isTourFullyCompleted(activeTour.id, total) && curIdx < activeTour.checkpoints.length - 1) {
        playIndex(curIdx + 1, { autoplay: true });
      }
    } else if (lastPos) {
      checkProximity(lastPos.lat, lastPos.lng);
    }
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
  $('#p-prev').onclick = () => { haptic(); if (curIdx > 0) goTrack(curIdx - 1); };
  $('#p-next').onclick = () => { haptic(); if (curIdx < activeTour.checkpoints.length - 1) goTrack(curIdx + 1); };
  $('#p-skip-back').onclick = () => { haptic(8); skipAudio(-SKIP_SEC); };
  $('#p-skip-fwd').onclick = () => { haptic(8); skipAudio(SKIP_SEC); };
  $('#p-dismiss').onclick = () => {
    haptic();
    if ($('#player')?.classList.contains('mini')) stopPlayer();
    else minimizePlayer();
  };
  $('#p-head').onclick = (e) => {
    if (e.target.closest('#p-dismiss')) return;
    if ($('#player')?.classList.contains('mini')) expandPlayer();
  };
  $('#p-mark-done').onclick = () => {
    const cp = curIdx >= 0 ? ordered()[curIdx] : null;
    if (cp) toggleMarkCompleted(cp.id);
  };
}

const ordered = () => activeTour.checkpoints.slice().sort((a, b) => a.order - b.order);

function resetPlayerUi() {
  const cur = $('#p-cur');
  const seek = $('#p-seek');
  const dur = $('#p-dur');
  const btn = $('#p-play');
  if (cur) cur.textContent = '0:00';
  if (seek) seek.value = 0;
  if (dur) dur.textContent = '0:00';
  if (btn) {
    btn.innerHTML = PLAY_ICON;
    btn.setAttribute('aria-label', t('playLabel'));
  }
  markPlaying(false);
}

function playIndex(i, { autoplay = false } = {}) {
  const cp = ordered()[i];
  if (!cp) return;
  curIdx = i;
  maxListenedSec = 0;
  resetPlayerUi();
  const hasAudio = !!cp.audio;
  if (hasAudio) {
    audio.src = activeTour.basePath + cp.audio;
    audio.playbackRate = playSpeed;
    audio.currentTime = 0;
    updateMediaSession(cp);
    if (autoplay) audio.play().catch(() => {});
    else audio.pause();
  } else {
    audio.pause();
    audio.removeAttribute('src');
    clearMediaSession();
  }
  $('#player').classList.toggle('info-only', !hasAudio);
  saveProgress(activeTour.id, i);
  $('#p-title').textContent = `${cp.order}. ${cp.shortTitle || cp.title}`;
  $('#p-transcript').textContent = cp.transcript || '';
  $('#p-transcript').scrollTop = 0;
  const player = $('#player');
  player.classList.remove('mini');
  player.classList.add('open');
  syncMarkDoneBtn();
  if (hasAudio) {
    setPlayerBackdrop(true);
    setNearbyPlayerOffset($('#nearby-card') && !$('#nearby-card').hidden ? 'full' : null);
  } else {
    setPlayerBackdrop(false);
    setNearbyPlayerOffset(null);
  }
  syncPlayerChrome();
}

function goTrack(idx) {
  const wasPlaying = !!(audio?.src && !audio.paused);
  playIndex(idx, { autoplay: wasPlaying });
}

function playById(id) { const i = ordered().findIndex((c) => c.id === id); if (i >= 0) playIndex(i); }

function markPlaying(on) {
  document.querySelectorAll('.cp-card').forEach((r) => r.classList.remove('playing'));
  if (on && curIdx >= 0) document.querySelector(`.cp-card[data-i="${curIdx}"]`)?.classList.add('playing');
}
function stopPlayer() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); }
  curIdx = -1;
  clearMediaSession();
  const p = $('#player');
  p?.classList.remove('open', 'mini', 'info-only');
  setPlayerBackdrop(false);
  setNearbyPlayerOffset(null);
  syncPlayerChrome();
  if (lastPos) checkProximity(lastPos.lat, lastPos.lng);
}

/* completed persistence (full listen or manual mark) */
function loadCompleted(id) { try { return new Set(JSON.parse(localStorage.getItem('completed-' + id) || '[]')); } catch { return new Set(); } }

function audioCheckpointCount(tour) {
  return tour?.checkpoints?.filter((c) => c.audio).length ?? 0;
}

function listenedEnough() {
  const dur = audio?.duration;
  if (!dur || !Number.isFinite(dur)) return false;
  const need = Math.max(dur * COMPLETE_RATIO, dur - 2);
  return maxListenedSec >= need;
}

function tryMarkCompleted(idx) {
  if (!activeTour || idx < 0) return false;
  const cp = ordered()[idx];
  if (!cp || !cp.audio) return false;
  if (!listenedEnough()) return false;
  markCompleted(cp.id);
  return true;
}

function markCompleted(cpId) {
  if (!activeTour || completedSet.has(cpId)) return false;
  completedSet.add(cpId);
  localStorage.setItem('completed-' + activeTour.id, JSON.stringify([...completedSet]));
  syncCpListRow(cpId);
  syncCpMapPin(cpId);
  syncMarkDoneBtn();
  const total = audioCheckpointCount(activeTour) || tourCheckpointTotal(INDEX.tours.find((x) => x.id === activeTour.id) || {});
  if (isTourFullyCompleted(activeTour.id, total)) showCompletion();
  return true;
}

function unmarkCompleted(cpId) {
  if (!activeTour || !completedSet.has(cpId)) return false;
  completedSet.delete(cpId);
  localStorage.setItem('completed-' + activeTour.id, JSON.stringify([...completedSet]));
  syncCpListRow(cpId);
  syncCpMapPin(cpId);
  syncMarkDoneBtn();
  return true;
}

function toggleMarkCompleted(cpId) {
  if (completedSet.has(cpId)) {
    if (unmarkCompleted(cpId)) haptic(8);
  } else {
    manualMarkCompleted(cpId);
  }
}

function manualMarkCompleted(cpId) {
  if (markCompleted(cpId)) haptic(8);
}

function syncMarkDoneBtn() {
  const btn = $('#p-mark-done');
  const row = $('#p-mark-row');
  if (!btn || !row) return;
  const cp = curIdx >= 0 ? ordered()[curIdx] : null;
  if (!cp?.audio) { row.hidden = true; return; }
  row.hidden = false;
  const done = completedSet.has(cp.id);
  btn.disabled = false;
  btn.textContent = done ? t('markCompletedUndo') : t('markCompleted');
  btn.classList.remove('good');
}

/* progress persistence (resume where user left off) */
function loadProgress(id) { return parseInt(localStorage.getItem('progress-' + id) ?? '-1', 10); }
function saveProgress(id, idx) { localStorage.setItem('progress-' + id, idx); }

/* tour completion screen */
function showCompletion() {
  if ($('#completion-overlay')) return;
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
          <button class="btn secondary" id="comp-home">На головну</button>
          <button class="btn ghost sm" id="comp-replay">Спочатку</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(overlay);
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
