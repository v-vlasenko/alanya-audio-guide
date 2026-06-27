# BUILD BRIEF — Ukrainian Audio Guides (scalable, multi-tour, offline PWA)

Paste this into a fresh coding session. It is self-contained — no prior conversation needed. Accompanying data files:
- `tours/index.json` — the tour catalog (drives the home screen).
- `tours/alanya-castle/tour.json` — the first tour's checkpoints + transcripts.
- `ui-strings-uk.json` — all UI text (Ukrainian).
- `scripts-uk.md` — narration source for generating the MP3s (same text already in the tour file).

---

## What to build
A tiny **offline-first PWA** that hosts **multiple self-guided audio tours** in **Ukrainian**. Built first for Alanya Castle (Türkiye), but the user will add more tours later (e.g. Alanya's historic old town). It must be **scalable**: adding a tour means dropping a folder + one catalog entry — **no code changes**. Target users are two non-technical iPhone travelers with unreliable data, so it must work fully offline after downloading and install to the home screen via Safari.

## Hard constraints / decisions (already made — don't relitigate)
- **No backend.** 100% static site on a static HTTPS host (GitHub Pages / Netlify / Vercel). HTTPS is required for geolocation + service worker.
- **Vanilla JS is fine** (or Vite + a light setup). Keep the bundle tiny. Data-driven: the app renders from JSON, never hardcodes tour content.
- **Audio is pre-generated MP3** (user creates them in ElevenLabs from `scripts-uk.md`), bundled per tour. No runtime TTS, no on-site API calls.
- **Map:** **interactive Leaflet with pre-bundled tiles per tour** (DECIDED — overrides the earlier "static image" lean). Real pinch/zoom/pan, a live "you are here" dot from GPS *position only*, numbered tappable markers. Offline because each tour ships a small pre-downloaded tile pack (tiny areas → a few MB each). Map bbox is **auto-computed** from checkpoint coords + padding — no hand-maintained bounds field.
- **All UI text comes from `ui-strings-uk.json`.** UI is Ukrainian-only.

## Architecture: tour shell + per-tour data
```
App shell (always cached): home/tour-picker, tour view, player, SW, manifest
  └─ reads tours/index.json  → list of tours
        └─ each tour: tours/<id>/tour.json  → checkpoints, transcripts, coords
              └─ tours/<id>/audio/*.mp3,  tours/<id>/cover.jpg,  tours/<id>/map.*
```
- **Home screen** = tour picker: render a card per entry in `tours/index.json` (title, subtitle, region, cover, duration, checkpoint count, size) with an **Open** action and a **per-tour Download-for-offline** button.
- **Tour view** = the existing experience for the selected tour (list + map + prompt-to-play player). A **back to tours** control returns to the picker.

## Per-tour offline model (important for scalability)
- The **app shell** is precached on first load (so the picker always works offline).
- **Each tour is downloaded on demand** via its Download button, which caches that tour's `tour.json` + all its audio + cover/map. Show `downloadingTour` → `tourDownloaded`; allow `deleteTourDownload`.
- Rationale: iOS caps PWA cache ~50 MB and evicts aggressively. Downloading only chosen tours keeps usage low as the catalog grows. For the immediate trip, the user just taps Download on the tour(s) they want, on Wi-Fi, before leaving.
- **Re-cache shell on every launch** (defensive heal) so an online open restores anything iOS evicted.
- Use a **cache-version string** per shell, and version tours via their `version` field so a bumped tour re-downloads.
- After download, the tour must fully work in **airplane mode**. Persistent `offlineIndicator` when no network; never a blank/broken state.

## Core interaction inside a tour (v1)
1. Tour view opens with **"▶︎ Почати тур"** (`startTour`). First audio must start from a user tap (iOS blocks autoplay until a gesture — the tap satisfies this).
2. **Manual access is the dependable core:** list + map always let the user tap any checkpoint and play, regardless of GPS permission/state.
3. **Live position on the map:** request geolocation only to paint a "you are here" dot via `watchPosition`. **No** distance triggering, **no** auto-prompt. Map (and the rest of the app) works fully if permission is denied — just no dot. Provide a "GPS off" toggle (`gpsOff`) to save battery.

## DEFERRED to v2: geofence PROMPT-TO-PLAY
> Not built in v1. The checkpoint `lat`/`lng`/`radiusM` data is kept intact so this drops in later with **no migration** once coords are measured on-site (`coordsVerified: true`).
> - Watch GPS, haversine distance to each checkpoint; on entering `radiusM` (fallback `defaultRadiusM`) show a dismissible in-app card (`nearbyPrefix` + title + `listen`), once per checkpoint per session.
> - Never interrupt playing audio. Clustered stops → show only the nearest, never stack cards. In-app banner only (no web push — no reliable background geolocation without a server).
> - Reason for deferral: it's the most fragile subsystem and current coords are unverified placeholders, so auto-prompts would misfire. Manual + live dot give the target users a reliable experience now.

## Data contracts

### `tours/index.json`
```
appName, appVersion, language
tours[]: { id, title, subtitle, region, path (from root), cover,
           checkpointCount, durationMin, approxSizeMb, version }
```
- **`index.appName` is the single source of truth** for the home title + the PWA manifest name. (The legacy `appName`/`appTagline` in `ui-strings-uk.json` are dead — they described the old single-tour app; ignore/remove.)
- `approxSizeMb` should reflect **audio + tile pack**; recompute after building each tour rather than guessing.

### `tours/<id>/tour.json`
```
id, title, subtitle, region, language, version,
basePath ("tours/<id>/"), defaultRadiusM, anchor:{lat,lng},
checkpoints[]: { id, order, title, shortTitle,
                 zone ("top"|"lower"|"seaside"), optional (bool),
                 audio (relative to basePath), lat, lng, radiusM,
                 coordsVerified (bool), transcript (full UA text) }
```
- Resolve audio as **basePath + audio**.
- Optional tour-level fields `tip` and `bestTime` exist in some tours — render them when present (short context line under the tour header).
- Render checkpoints by `order`. Mark `optional: true` with `optionalBadge` (Alanya's seaside Red Tower + Shipyard — user may skip the harbour).
- **Coordinates are rough, UNVERIFIED placeholders** (`coordsVerified: false`). Don't trust them for production geofencing; user replaces them with measured values. Swapping coordinates must need no code change. Manual playback must work even while coords are wrong.
- Show `transcript` beneath the player (accessibility + sun/noise).

## Adding a new tour later (document this in the README)
1. Create `tours/<new-id>/tour.json` (same schema), write Ukrainian scripts, generate MP3s into `tours/<new-id>/audio/`, add a `cover.jpg` and optional `map`.
2. Add one entry to `tours/index.json`.
3. Done — the picker shows it; the Download button caches it. No code edits.

## UI screens (dead simple, huge tap targets, high contrast for sunlight)
- **Home / picker:** `toursTitle` + `toursSubtitle`, a card per tour (cover, title, subtitle, region, `tourDurationLabel`/`tourCheckpointsLabel`/`tourSizeLabel`), Open + Download buttons, install helper, offline indicator.
- **Tour view → List:** checkpoints by `order`, title + play + visited state (`visited`); `backToTours`.
- **Tour view → Map:** static numbered image (or Leaflet); tapping a pin opens that checkpoint.
- **Player:** title, play/pause/seek, transcript, prev/next.
- **Proximity card:** the prompt-to-play banner above.
- **Install helper:** `installTitle` + `installStep1..4`; detect in-app browsers (Telegram/WhatsApp webviews where Add-to-Home-Screen is unavailable) and show `openInSafariWarning`.
- Valid **web app manifest** + icons (placeholders fine; standalone display; portrait).

## Acceptance criteria
- [ ] Installs from Safari to home screen; launches full-screen; picker lists tours from `index.json`.
- [ ] Per-tour Download caches that tour; afterwards **airplane mode → that tour fully plays and its map shows**.
- [ ] App shell + picker work offline even before any tour is downloaded.
- [ ] Re-cache-on-launch restores the shell after a cache clear + online reopen.
- [ ] First audio plays from the Start tap; no silent autoplay-fail anywhere.
- [ ] Map shows a live "you are here" dot (position only); pans/zooms; works offline from bundled tiles; recenter control.
- [ ] Manual list/map playback works with GPS denied or off (map still renders, just no dot).
- [ ] (v2, not required now) Proximity auto-prompt — deferred; see DEFERRED section.
- [ ] Adding a tour requires only a new folder + an `index.json` entry (verify by adding a dummy second tour).
- [ ] All visible text sourced from `ui-strings-uk.json`.

## Deliverables
A deployable static PWA (vanilla JS, no build step):
```
index.html · app.js · app.css · sw.js · manifest.json · icons/
lib/leaflet.js · lib/leaflet.css            (vendored locally, no CDN)
data/ui-strings-uk.json
scripts/fetch-tiles.mjs                      (run once on wifi per tour)
tours/index.json
tours/alanya-castle/tour.json
tours/alanya-castle/audio/01-intro.mp3 … 09-tersane.mp3   (castle MP3s present)
tours/alanya-castle/tiles/{z}/{x}/{y}.png    (pre-fetched, offline map)
tours/alanya-castle/cover.jpg                (placeholder; user replaces)
tours/alanya-harbor/…   tours/alanya-damlatas/…   (audio = user adds later)
```
Include a short README: how to deploy (e.g. GitHub Pages), where to drop MP3s, how to replace coordinates, and the 3-step "add a new tour" recipe above.
