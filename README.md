# Аудіогіди Аланії — offline audio-guide PWA

A tiny, offline-first Progressive Web App hosting multiple Ukrainian self-guided
audio tours. Built for iPhone (install to home screen via Safari). Vanilla JS,
no build step, 100% static.

**v1 scope:** tour picker · per-tour offline download · manual list + map
playback · live "you are here" dot on the map (position only).
**Deferred to v2:** GPS geofence auto-prompt-to-play (see `docs/BUILD-BRIEF.md` →
*DEFERRED* section). The checkpoint coordinates are kept intact so it drops in
later with no migration.

---

## Run locally
Service workers + geolocation need a real origin (not `file://`):

```bash
python3 -m http.server 8000        # then open http://localhost:8000
```

On a phone for testing GPS/install you need **HTTPS** — use the deployed URL.

## Deploy (GitHub Pages)
1. Create a repo, commit everything in this folder, push.
2. Repo **Settings → Pages → Source: deploy from branch → `main` / root**.
3. Live at `https://<you>.github.io/<repo>/`. HTTPS is automatic (required for
   the service worker + geolocation).
4. Open it in **Safari** on the iPhone → Share → **Add to Home Screen**.
5. Launch from the icon **on wifi**, tap **Завантажити** on each tour you want,
   wait for **Завантажено ✓**. Now it works in airplane mode.

(Netlify alternative: drag this folder onto app.netlify.com → instant HTTPS URL.)

## Add the audio (ElevenLabs)
Generate MP3s from `docs/scripts-uk.md` / `docs/scripts-oldtown-uk.md` and drop them in,
matching the `audio` filenames in each `tours/<id>/tour.json`:

```
tours/alanya-castle/audio/01-intro.mp3 … 09-tersane.mp3   ✅ already present
tours/alanya-harbor/audio/01-harbor.mp3 … 05-promenade.mp3   ⬅ add
tours/alanya-damlatas/audio/01-cleopatra.mp3 … 03-museum.mp3 ⬅ add
```
No code changes — the player resolves `basePath + audio`. After adding files,
bump that tour's `version` in **both** `tours/<id>/tour.json` and
`tours/index.json` so downloaded copies refresh.

## Replace map coordinates (before relying on them)
Coords marked `"coordsVerified": false` are rough placeholders. To fix one:
Google Maps → right-click the spot → click the lat,lng to copy → paste into the
checkpoint's `lat`/`lng` in `tours/<id>/tour.json`, set `coordsVerified: true`.
Then re-run the tile fetch (below) so the map covers the new positions. No code
change needed.

## Map tiles (offline map)
Tiles are pre-downloaded per tour into `tours/<id>/tiles/` (already done). The
map bbox is auto-computed from the checkpoints. Re-run after moving coords or
adding a tour (needs internet, run on wifi):

```bash
node scripts/fetch-tiles.mjs                 # all tours
node scripts/fetch-tiles.mjs alanya-harbor   # one tour
```

## Covers & icons
- **Covers:** optional. If `tours/<id>/cover.jpg` is missing the card shows a
  gradient + title automatically. Drop a real `cover.jpg` anytime — no config.
- **Icons:** placeholders in `icons/` (terracotta + play glyph). Regenerate with
  `python3 scripts/make-icons.py`, or replace the PNGs with real art (keep the
  filenames + sizes).

## Add a NEW tour (no code changes)
1. `mkdir -p tours/<new-id>/audio` and write `tours/<new-id>/tour.json`
   (copy an existing one's schema: `id, basePath, anchor, checkpoints[…]`).
2. Add the MP3s; run `node scripts/fetch-tiles.mjs <new-id>` for its map tiles.
3. Add one entry to `tours/index.json` (`id, title, subtitle, region, path,
   cover, checkpointCount, durationMin, approxSizeMb, version`).
4. Commit + push. The picker shows it; its Download button caches it. Done.

## File layout
```
index.html · app.js · app.css · sw.js · manifest.json
icons/                         placeholder PWA icons
lib/leaflet.{js,css}           vendored, no CDN
data/ui-strings-uk.json        all UI text (single source of truth: index.appName for the app name)
scripts/fetch-tiles.mjs        offline tile downloader
scripts/make-icons.py          placeholder icon generator
tours/index.json               catalog → drives the home screen
tours/<id>/tour.json           checkpoints + transcripts + coords
tours/<id>/audio/*.mp3         narration
tours/<id>/tiles/{z}/{x}/{y}.png  offline map tiles (+ meta.json bbox)
```

The source/reference docs (`BUILD-BRIEF.md`, `Alanya-Castle-Audio-Guide-PRD.md`,
`scripts-*.md`) live in `docs/`; they are not served assets.
