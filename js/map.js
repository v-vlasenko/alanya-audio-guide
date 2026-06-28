'use strict';

import { $, esc, haptic, resetPageScroll } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { checkProximity } from './nearby.js';
import { playById } from './player.js';
import { isGpsOff, setGpsOff } from './storage.js';

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
  let bbox = null;
  try { bbox = (await fetch(`${base}tiles/meta.json`).then((r) => r.json())).bbox; } catch {}

  state.map = L.map('map', { zoomControl: true, attributionControl: true, doubleClickZoom: true });

  const ESRI_STREET_URL = (c) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${c.z}/${c.y}/${c.x}`;
  const ESRI_SAT_TMPL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

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
  let curLayer = new HybridStreet('', { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(state.map);

  $('#layer-btn').onclick = () => {
    isSat = !isSat;
    state.map.removeLayer(curLayer);
    if (isSat) {
      curLayer = L.tileLayer(ESRI_SAT_TMPL, { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri, Maxar' }).addTo(state.map);
      $('#layer-btn').textContent = '🗺';
      $('#layer-btn').title = t('mapStreetTitle');
    } else {
      curLayer = new HybridStreet('', { minZoom: 14, maxZoom: 18, attribution: 'Tiles © Esri' }).addTo(state.map);
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

  if (bbox) state.map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]]);
  else if (pts.length) state.map.fitBounds(pts, { padding: [30, 30] });
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
      if (bbox) state.map.fitBounds([[bbox.s, bbox.w], [bbox.n, bbox.e]]);
      else if (pts.length) state.map.fitBounds(pts, { padding: [30, 30] });
    } else {
      startWatch(bbox, pts);
    }
  };
  if (!gpsOff) startWatch(bbox, pts);
}
