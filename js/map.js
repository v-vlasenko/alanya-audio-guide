'use strict';

import { $, esc, haptic, resetPageScroll } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { checkProximity } from './nearby.js';
import { playById } from './player.js';
import { isGpsOff, setGpsOff } from './storage.js';
import { matchGlobalCached } from './cache.js';
import { esriSatTileUrl, osmTileUrl } from './geo.js';

function cpPinHtml(cp) {
  const done = state.completedSet.has(cp.id);
  const cls = ['pin', cp.optional && 'optional', done && 'done'].filter(Boolean).join(' ');
  return `<div class="${cls}"><span>${cp.order}</span></div>`;
}

function cpPinIcon(cp) {
  return L.divIcon({ className: '', html: cpPinHtml(cp), iconSize: [30, 30], iconAnchor: [15, 30] });
}

export function syncCpMapPin(cpId) {
  const mk = state.cpMarkers.get(cpId);
  if (!mk) return;
  const cp = state.activeTour.checkpoints.find((c) => c.id === cpId);
  if (!cp) return;
  mk.setIcon(cpPinIcon(cp));
}

export function teardownMap() {
  if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
  if (state.map) { state.map.remove(); state.map = null; }
  state.meLayer = null;
  state.didFit = false;
  state.wpMarkers = [];
  state.cpMarkers = new Map();
  state.showWp = true;
}

function startWatch(bbox, pts) {
  if (!('geolocation' in navigator)) return;
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const ll = [lat, lng];
      if (!state.meLayer) {
        state.meLayer = L.marker(ll, {
          icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        }).addTo(state.map);
        if (!state.didFit) { state.map.setView(ll, 17); state.didFit = true; }
      } else state.meLayer.setLatLng(ll);
      checkProximity(lat, lng);
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

export async function renderMap() {
  if (state.map) { setTimeout(() => state.map.invalidateSize(), 50); return; }
  const pane = $('#pane-map');
  pane.innerHTML = `
    <div class="map-wrap">
      <div id="map"></div>
      <button class="recenter" id="recenter" title="${esc(t('gpsToggleLabel'))}">◎</button>
      <button class="layer-btn" id="layer-btn" title="${esc(t('mapSatelliteTitle'))}">🛰</button>
      <button class="wp-btn" id="wp-toggle" title="${esc(t('mapWaypointsTitle'))}">ℹ</button>
      <button class="gps-btn" id="gps-btn" title="${esc(t('mapGpsTitle'))}">📍</button>
    </div>`;

  const base = state.activeTour.basePath;
  let tileMeta = { zoomMin: 14, zoomMax: 18, bbox: null };
  try {
    tileMeta = await fetch(`${base}tiles/meta.json`).then((r) => r.json());
  } catch { /* no bundled tiles */ }
  const bbox = tileMeta.bbox;

  const nativeMin = tileMeta.zoomMin ?? 14;
  const nativeMax = tileMeta.zoomMax ?? 18;

  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    doubleClickZoom: true,
    minZoom: 10,
    maxZoom: nativeMax,
  });

  const TILE_OPTS = { minZoom: 10, maxZoom: nativeMax, updateWhenIdle: true, keepBuffer: 3 };
  const STREET_OPTS = {
    ...TILE_OPTS,
    minNativeZoom: nativeMin,
    maxNativeZoom: nativeMax,
  };

  function makeCachedLayer(tileUrl) {
    return L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement('img');
        img.alt = '';
        const url = tileUrl(coords);
        let blobUrl = null;
        const finish = (err) => {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          if (err) done(err, img);
          else done(null, img);
        };
        img.onload = () => finish(null);
        img.onerror = () => finish(new Error('tile'));
        (async () => {
          const hit = await matchGlobalCached(url);
          if (hit) {
            blobUrl = URL.createObjectURL(await hit.blob());
            img.src = blobUrl;
            return;
          }
          if (!navigator.onLine) { finish(new Error('tile')); return; }
          img.src = url;
        })();
        return img;
      },
    });
  }

  function makeStreetLayer(tourBase) {
    return L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement('img');
        img.alt = '';
        img.onload = () => done(null, img);
        img.onerror = () => done(new Error('tile'), img);
        const { z, x, y } = coords;
        if (navigator.onLine) {
          img.src = osmTileUrl(z, x, y);
        } else {
          img.src = `${tourBase}tiles/${z}/${x}/${y}.png`;
        }
        return img;
      },
    });
  }

  const SatelliteLayer = makeCachedLayer((c) => esriSatTileUrl(c.z, c.x, c.y));
  const StreetLayer = makeStreetLayer(base);
  const streetAttribution =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  let isSat = false;
  let curLayer = new StreetLayer('', { ...STREET_OPTS, attribution: streetAttribution }).addTo(state.map);
  $('#layer-btn').textContent = '🛰';
  $('#layer-btn').title = t('mapSatelliteTitle');

  $('#layer-btn').onclick = () => {
    isSat = !isSat;
    state.map.removeLayer(curLayer);
    if (isSat) {
      curLayer = new SatelliteLayer('', { ...TILE_OPTS, attribution: 'Tiles © Esri, Maxar' }).addTo(state.map);
      $('#layer-btn').textContent = '🗺';
      $('#layer-btn').title = t('mapStreetTitle');
    } else {
      curLayer = new StreetLayer('', { ...STREET_OPTS, attribution: streetAttribution }).addTo(state.map);
      $('#layer-btn').textContent = '🛰';
      $('#layer-btn').title = t('mapSatelliteTitle');
    }
  };

  const pts = [];
  state.activeTour.checkpoints.forEach((cp) => {
    const mk = L.marker([cp.lat, cp.lng], { icon: cpPinIcon(cp) }).addTo(state.map);
    mk.on('click', () => { haptic(); playById(cp.id); });
    state.cpMarkers.set(cp.id, mk);
    pts.push([cp.lat, cp.lng]);
  });

  (state.activeTour.waypoints || []).forEach((wp) => {
    const icon = L.divIcon({ className: '', html: '<div class="wp-pin"><span>ℹ</span></div>', iconSize: [28, 28], iconAnchor: [14, 28] });
    const wpMk = L.marker([wp.lat, wp.lng], { icon }).addTo(state.map)
      .bindPopup(`<b>${wp.title}</b><br><span style="font-size:13px">${wp.description}</span>`, { maxWidth: 220 })
      .on('click', () => haptic());
    state.wpMarkers.push(wpMk);
    pts.push([wp.lat, wp.lng]);
  });

  const hasWp = (state.activeTour.waypoints || []).length > 0;
  $('#wp-toggle').hidden = !hasWp;
  if (!hasWp) $('#gps-btn').style.bottom = '140px';
  if (hasWp) {
    $('#wp-toggle').onclick = () => {
      state.showWp = !state.showWp;
      state.wpMarkers.forEach((m) => (state.showWp ? m.addTo(state.map) : state.map.removeLayer(m)));
      $('#wp-toggle').classList.toggle('off', !state.showWp);
      haptic(8);
    };
  }

  const fitTourBounds = () => {
    const pad = { padding: [30, 30] };
    if (bbox) state.map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]], pad);
    else if (pts.length) state.map.fitBounds(pts, pad);
    // Bundled tiles only cover the tour bbox; zooming out further shows empty margins offline.
    if (!navigator.onLine && state.map.getZoom() < nativeMin) state.map.setZoom(nativeMin);
  };

  fitTourBounds();
  setTimeout(() => { state.map.invalidateSize(); resetPageScroll(); }, 60);

  $('#recenter').onclick = () => { if (state.meLayer) state.map.panTo(state.meLayer.getLatLng()); };

  const gpsOff = isGpsOff();
  const gpsBtn = $('#gps-btn');
  gpsBtn.classList.toggle('off', gpsOff);
  gpsBtn.onclick = () => {
    const nowOff = !isGpsOff();
    setGpsOff(nowOff);
    gpsBtn.classList.toggle('off', nowOff);
    haptic(8);
    if (nowOff) {
      if (state.watchId != null) { navigator.geolocation.clearWatch(state.watchId); state.watchId = null; }
      if (state.meLayer) { state.map.removeLayer(state.meLayer); state.meLayer = null; }
      state.didFit = false;
      if (bbox) state.map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]], { padding: [30, 30] });
      else if (pts.length) state.map.fitBounds(pts, { padding: [30, 30] });
      if (!navigator.onLine && state.map.getZoom() < nativeMin) state.map.setZoom(nativeMin);
    } else {
      startWatch(bbox, pts);
    }
  };
  if (!gpsOff) startWatch(bbox, pts);
}
