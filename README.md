# Аудіогіди Аланії

Offline-first PWA with Ukrainian self-guided audio tours of Alanya, Turkey.
Built for iPhone (Safari → Add to Home Screen). Vanilla JS, no build step, 100% static.

**Live:** https://v-vlasenko.github.io/alanya-audio-guide/

## Tours

| Tour | Stops | Audio |
|---|---|---|
| Аланійська фортеця | 9 | ✅ |
| Дамлаташ і Клеопатра | 3 | ✅ |
| Гавань і старе місто | 5 | ✅ |

## First use (iPhone)

1. Open the link in **Safari** → Share → **Add to Home Screen**
2. Launch from the icon **on wi-fi**
3. Tap **Завантажити** on each tour → wait for **Завантажено ✓**
4. Works in airplane mode after that

## Run locally

```bash
python3 -m http.server 8000   # open http://localhost:8000
```

GPS and service worker require HTTPS — use the deployed URL for real device testing.

## Add a new tour

1. Create `tours/<id>/tour.json` (copy schema from an existing one)
2. Add MP3s to `tours/<id>/audio/`
3. Run `node scripts/build-osm-tiles.mjs <id>` to render offline OSM map tiles (requires Docker)
4. Add an entry to `tours/index.json`
5. Commit + push

## Fix map coordinates

Checkpoints with `"coordsVerified": false` have rough placeholder coords.
To fix: Google Maps → right-click the spot → copy lat,lng → paste into `tours/<id>/tour.json`, set `"coordsVerified": true`.

## File layout

```
index.html · js/main.js · app.css · sw.js · manifest.json
data/ui-strings-uk.json        UI strings
lib/leaflet.{js,css}           vendored (no CDN)
scripts/build-osm-tiles.mjs   offline OSM tile builder (Docker)
scripts/fetch-tiles.mjs        legacy Esri tile downloader (deprecated)
tours/index.json               tour catalog (home screen)
tours/<id>/tour.json           checkpoints, transcripts, coords, waypoints
tours/<id>/audio/*.mp3         narration
tours/<id>/tiles/              offline map tiles
```
