# PRD — "Alanya Castle" Ukrainian Audio Guide (Offline PWA)

**Author:** Vladyslav
**Status:** Draft v1
**Target ship date:** Before the trip (a few days) — MVP only
**Primary users:** Mom & sister (Ukrainian speakers, iPhone, non-technical, abroad with unreliable data)

---

## 1. Problem & Goal

Mom and sister are visiting Alanya Castle (Alanya, Türkiye) and want a self-guided tour in **Ukrainian**, with audio that explains each landmark as they reach it. There are no good Ukrainian audio guides for this site, and roaming data on a 250 m hilltop is unreliable.

**Goal:** A dead-simple web app they open on iPhone, that plays Ukrainian narration for each castle checkpoint — ideally triggered automatically by location, always tappable manually — and works **fully offline**.

**Success = ** they complete the tour without needing data, without calling you for help, and actually enjoy the stories.

---

## 2. Key product decisions (made up front)

| Decision | Choice | Why |
|---|---|---|
| Platform | **Offline-first PWA**, "Add to Home Screen" on iOS Safari | No app store, works on any phone, deploy once. Hilltop = no reliable data, so everything must be bundled. |
| Navigation model | **Prompt-to-play**: GPS proximity shows an in-app card → user taps to play. Plus always-available manual map/list. | Works *with* iOS (the tap is the required gesture), not against it. No silent auto-play to fight the platform. Manual tap always works regardless of GPS. |
| Audio | **Pre-generated MP3** bundled in the app | Zero network on-site. No runtime TTS calls. |
| Voice tool | **ElevenLabs Multilingual** (free tier) | Best Ukrainian quality; ~10k chars/month free covers 8–10 checkpoints. |
| Map | **Leaflet + pre-cached OpenStreetMap tiles** (or a single static image map) | Free, offline-cacheable, no API key. |
| Backend | **None** — 100% static | Cheapest, simplest, deploy anywhere (GitHub Pages / Netlify / Vercel). |
| Hosting | Any static HTTPS host | HTTPS is **required** for geolocation + service worker. |

> **Time-boxed fallback:** If the build slips, create the same tour in **izi.TRAVEL** (free, supports custom audio, GPS auto-play, offline download). Lower control, zero code. Keep this as plan B.

---

## 3. Scope

### MVP (must ship)
- 6–10 checkpoints covering the main castle route
- Ukrainian audio per checkpoint (pre-generated MP3)
- Manual list + map view; tap a checkpoint → play its audio
- GPS auto-trigger when near a checkpoint (best-effort)
- Full offline operation after first load
- Installable PWA on iPhone
- Big, simple, touch-friendly UI in Ukrainian

### Nice-to-have (only if time allows)
- Distance/direction hint to next checkpoint ("≈120 m, ↑ uphill")
- Short text transcript under each audio (accessibility + noisy areas)
- 1–2 photos per checkpoint
- "Mark as visited" progress state
- Background-audio lock-screen controls

### Explicitly out of scope (v1)
- Turn-by-turn routing / live directions
- Multi-language switching
- Accounts, analytics, payments
- Live TTS at runtime

---

## 4. Functional requirements

**FR-1 Checkpoint playback.** Each checkpoint has: id, Ukrainian title, lat/lng, trigger radius (m), audio file, optional transcript + photo. Tapping plays audio with standard controls (play/pause/seek).

**FR-2 GPS proximity prompt (primary interaction).** Using `navigator.geolocation.watchPosition`, compute haversine distance to each checkpoint. When the user enters a checkpoint's radius (default **30 m**) and it hasn't been shown this session, display a dismissible in-app card at the bottom: **"📍 Ви поруч: Внутрішня фортеця — ▶︎ Слухати"**. Tapping plays it (the tap doubles as the iOS gesture). Never interrupt audio already playing.
- **Clustered stops:** the mosque, bedesten, and tomb sit close together. If 2+ checkpoints are in range, show **only the nearest**, or a compact "Поряд 3 точки" list — never stack multiple prompts.
- This is an **in-app banner, not a system push notification** (see note below for why).

**FR-3 Manual access (always, primary fallback).** A list and a map always let the user tap any checkpoint and play it, regardless of GPS state or permission. Treat this as the dependable core; the proximity prompt is an enhancement on top of it.

> **Why in-app prompt, not a real push notification:** iOS web push only helps when the app is *backgrounded* — but iOS PWAs have no reliable background geolocation, so the geofence JS isn't running when backgrounded and couldn't fire a notification at the right moment without a server + push setup (overkill for two users). When the app is foreground (the only state where GPS works here), an in-app card is instant, needs no notification permission, and works fully offline.

**FR-4 Offline.** After first successful load on Wi-Fi, the app + all audio + map assets are cached via a service worker and function with the device in airplane/no-data mode.

**FR-5 Install.** Valid web app manifest + icons so "Add to Home Screen" gives a full-screen, app-like launch.

**FR-6 Resilient audio start (iOS).** The tour begins with a **"▶︎ Почати тур" / "Start tour"** button. The first playback must come from a user tap because iOS blocks autoplay until a gesture. Because every clip thereafter also starts from a tap (the proximity card or the list), this constraint is satisfied for free — no silent-autoplay failure mode exists.

**FR-7 Map.** Show user's position (blue dot) and all checkpoints. Tapping a pin opens that checkpoint. If offline map tiles are too heavy, fall back to a single static map image with numbered pins.

---

## 5. Installation & offline access (how Mom & Sister actually get it)

This is the part real users depend on, so it's a first-class requirement, not an afterthought.

### How they install it
There's no App Store — they save the web app to the home screen:
1. You send a link (use a short, memorable URL).
2. **It must be opened in Safari directly.** ⚠️ Biggest real-world trap: if they tap the link inside Telegram / WhatsApp / Instagram, it opens in that app's *in-app browser*, where "Add to Home Screen" often **doesn't appear**. Instruction for them: if it opens inside a messenger, tap the "•••"/compass/share icon → **Open in Safari** first.
3. In Safari: **Share** (square-with-arrow) → **Add to Home Screen** → Add.
4. An icon appears; tapping it launches full-screen with no browser bars.

### How it works offline
A PWA must be **loaded online once** to install itself. On first open, the service worker downloads the entire app (HTML, audio MP3s, map assets) into on-device cache. After that, launching the icon loads everything from the phone — **no data or roaming needed**.

The one instruction that matters most: **install and fully open the app on Wi-Fi (hotel) before going up to the castle.**

### Pre-trip checklist for them
- [ ] Open the link **in Safari** (not inside a messenger).
- [ ] Add to Home Screen.
- [ ] Open the installed icon once on Wi-Fi; wait for **"Завантажено для офлайн ✓"**.
- [ ] **Turn on airplane mode and confirm a clip still plays.** ← the real proof.
- [ ] Do this a day or two before, and re-open it once that morning.

### Engineering implications (requirements)
- **FR-OFF-1** Service worker precaches the full asset list on install; show a one-time download-progress + "ready offline" confirmation.
- **FR-OFF-2** **Re-cache critical assets on every launch** (defensive heal): if iOS evicted anything, an online open silently restores it.
- **FR-OFF-3** Keep total payload **under ~30–40 MB** — iOS caps PWA cache near **50 MB** and evicts when storage is low or the app sits unused for weeks. Mono ~64–96 kbps MP3.
- **FR-OFF-4** Graceful offline UI: an "Працює офлайн ✓" indicator; never show a broken/blank state with no network.
- **FR-OFF-5** Cache-version string; bump it to push updates on the next online launch.

---

## 6. iOS / PWA constraints (read before building — these will bite)

- **Autoplay blocked until a user gesture.** Audio starts only after a tap — which the prompt-to-play model gives you naturally (no autoplay to fight).
- **"Add to Home Screen" is Safari-only** and unavailable from in-app browsers (see install steps above).
- **Background geolocation is limited in iOS PWAs.** Reliable proximity detection needs the app **in the foreground, screen on**. Design for "phone in hand"; manual tap is the dependable path.
- **No reliable background tasks / web push for this use case.** Don't build the experience around system notifications.
- **Service worker + geolocation require HTTPS.** All recommended hosts provide it; `localhost` works for dev.
- **Cache eviction is real** (~50 MB cap; cleared when low on storage or unused for weeks). Hence small payload + re-cache-on-launch + install close to the trip.
- **No background audio guarantees.** Media Session lock-screen controls are best-effort; don't depend on them.
- **Test on the actual iPhone they'll carry, in Safari** — not just desktop Chrome. PWA + audio + GPS behave differently.

---

## 7. Content plan — Alanya Castle route

The castle has three zones: **seaside** (Red Tower + Shipyard), **top** (Inner Castle / İçkale), and the **lower castle village** (Ehmedek). Most visitors take the **cable car (Teleferik)** up from Cleopatra Beach, explore the top, then optionally descend. Recommended checkpoint order (top-down, matching a cable-car arrival):

| # | Checkpoint (UA title suggestion) | What to cover |
|---|---|---|
| 1 | **Вступ / Канатна дорога** (Cable car top station) | Welcome, orientation, the peninsula 250 m above the sea, how to use the guide. |
| 2 | **Внутрішня фортеця (İçkale)** | Highest point; ruins of Sultan Alaeddin Keykubad's Seljuk palace, cisterns, Byzantine church; the panorama. |
| 3 | **Емедек (Ehmedek)** | 1227 three-towered fort, former Turkish quarter, garrison, treasury, dungeons. |
| 4 | **Мечеть Сулейманіє** | Oldest mosque in Alanya (16th c., over a 13th c. Seljuk one); modest dress, off prayer times. |
| 5 | **Бедестен** | Ottoman covered market/bazaar opposite the mosque; later a hotel. |
| 6 | **Гробниця Акшебе (Akşebe Türbesi)** | ~1230 mausoleum for a Seljuk commander. |
| 7 | **Стіни та бастіони / Оглядовий майданчик** | 6.5 km of walls, ~140 bastions; views over Cleopatra & East beaches. |
| 8 | **Червона вежа (Kızıl Kule)** *(seaside)* | 1226, octagonal, ~33 m, 5 floors, Ethnographic Museum. |
| 9 | **Корабельня (Tersane)** *(seaside)* | 1227, only surviving Seljuk shipyard in Turkey, five arched bays. |

> Checkpoints 8–9 are at sea level — include them only if mom & sister plan to go down to the harbour. Mark them clearly as "optional / seaside."

### Coordinates (required content task)
Each checkpoint needs real lat/lng. **Capture them properly** — don't guess:
- Open Google Maps, find each structure, right-click → click the coordinates to copy, OR
- Have someone drop pins on-site.
Store as a `checkpoints.json`. Start radius at **30 m**; widen to 40–50 m for large/open spots, tighten for clustered ones (mosque/bedesten/tomb are close together).

### Script guidelines
- **120–180 words per checkpoint** (~45–75 s of audio). Conversational, warm, "local storyteller" tone — not a Wikipedia dump.
- One vivid hook + 2–3 facts + a "look for this" prompt ("подивіться ліворуч на…").
- Plain Ukrainian, short sentences (TTS reads them better).
- End each with a nudge to the next stop.
- Keep total characters under ElevenLabs' free monthly limit (≈10k). ~9 checkpoints × ~1,000 chars ≈ on budget; trim if needed.

### Audio generation workflow
1. Write all scripts in Ukrainian (one file per checkpoint).
2. Generate in **ElevenLabs** → pick one consistent voice → export **MP3**.
3. Normalize loudness, trim silence (optional, e.g. Audacity).
4. Name files by id (`01-intro.mp3` …) and drop into `/audio`.
5. Reference them in `checkpoints.json`.

---

## 8. Technical architecture

```
Static PWA (no backend)
├─ index.html
├─ app.js            // routing, geolocation watch, haversine, audio control
├─ sw.js             // service worker: precache shell + audio + tiles
├─ manifest.json     // PWA install metadata + icons
├─ data/checkpoints.json
├─ audio/*.mp3        // pre-generated Ukrainian narration
├─ img/*.jpg          // optional photos
└─ map/               // Leaflet + cached OSM tiles  OR  static map image
```

- **Framework:** vanilla JS is plenty; if you prefer DX, Vite + a light framework. Keep the bundle tiny.
- **Geolocation:** `watchPosition({ enableHighAccuracy: true })`; haversine distance to each checkpoint each update; debounce triggers.
- **Audio:** single `<audio>` element; Media Session API for lock-screen controls (best-effort).
- **Offline:** service worker precaches the full asset list on install; cache-first strategy. Bump a cache version string to update.
- **Map:** Leaflet + a small set of pre-downloaded tiles for just the castle bounding box. If tile caching is fiddly under deadline, ship a **static numbered map image** — fully reliable offline.

---

## 9. UX flow

1. Open link **in Safari** on Wi-Fi (hotel) → install instructions ("Поділитися → На початковий екран").
2. First launch caches everything (one-time "Завантаження для офлайн…" progress → "Готово ✓").
3. Home screen: big **"▶︎ Почати тур"** button, short how-to, list of checkpoints, "Map" toggle, offline indicator.
4. Walking: GPS dot moves; entering a checkpoint's zone → an in-app card slides up: **"📍 Ви поруч: Внутрішня фортеця — ▶︎ Слухати"**. Tap to play; dismissible. If several stops are in range, show the nearest only.
5. Any time: tap a checkpoint in the list/map to play (works with GPS off).
6. Persistent "Працює офлайн ✓" reassurance when there's no data.

**UX principles:** huge tap targets, minimal text, Ukrainian-only UI, nothing requiring data, forgiving of GPS drift. Assume bright sunlight (high contrast) and headphones-or-speaker.

---

## 10. Non-functional requirements

- **Offline:** full tour works in airplane mode after first load. *(Top test.)*
- **Performance:** first load < ~30 MB total; instant on subsequent opens.
- **Battery:** high-accuracy GPS drains battery — warn users to start charged; offer a "GPS off / manual only" toggle.
- **Accessibility:** transcripts under audio; large fonts; works one-handed.
- **Compatibility:** target iOS Safari (latest). Verify on the *actual* device they'll carry.

---

## 11. Build plan (few-day sprint)

- **Day 1 — Content:** finalize checkpoint list, capture coordinates, write all Ukrainian scripts.
- **Day 2 — Audio + skeleton:** generate MP3s in ElevenLabs; build static app shell, list view, audio playback, `checkpoints.json`.
- **Day 3 — Map + GPS + offline:** add map, geolocation proximity prompt, service worker offline caching + re-cache-on-launch, PWA manifest/icons.
- **Day 4 — Harden + test on real iPhone:** run the QA checklist below, deploy to HTTPS host, send the link, walk them through opening-in-Safari, "Add to Home Screen," and the airplane-mode test **before** they fly.

---

## 11. QA / test checklist (your home turf)

**Install & offline (most important)**
- [ ] Link opened **in Safari** installs to home screen; launches full-screen.
- [ ] Opening the link from inside Telegram/WhatsApp surfaces clear "Open in Safari" guidance.
- [ ] First launch shows caching progress → "ready offline" confirmation.
- [ ] After install, **enable airplane mode** → every checkpoint plays, map still shows. *(Critical.)*
- [ ] Re-cache-on-launch heals after manually clearing cache, then reopening online.
- [ ] Cache-version bump pushes an update on next online open.

**Playback & interaction**
- [ ] First audio plays from the Start tap; no silent-fail autoplay anywhere.
- [ ] Each MP3 maps to the correct checkpoint; titles/transcripts match.
- [ ] Walking into a zone shows the proximity card **once** (no repeat spam); tapping plays the right clip.
- [ ] With 2+ stops in range (mosque/bedesten/tomb cluster), only the nearest card shows — no stacking.
- [ ] A new card never interrupts audio that's already playing.
- [ ] Manual list/map tap always works with GPS **denied or disabled**.
- [ ] Audio pause/resume/seek works; lock-screen controls behave or fail silently.

**Environment**
- [ ] Usable under zero connectivity and in bright sunlight (contrast, tap-target size).
- [ ] Battery drain acceptable over a ~2 h tour; "manual only / GPS off" toggle reduces it.

---

## 12. Open questions to confirm (won't block MVP)

1. **Seaside stops (Red Tower + Shipyard)** — are they going down to the harbour, or top-of-castle only? Decides whether checkpoints 8–9 ship.
2. **Map** — interactive Leaflet, or a reliable static numbered image? (Static is faster to ship and safest offline.)
3. **Voice** — male or female, and which ElevenLabs voice? Pick one and keep it consistent.
4. **Photos** — include per-checkpoint images, or audio + text only for v1?

---

## Appendix A — Ukrainian TTS options

| Tool | Quality | Free tier | Notes |
|---|---|---|---|
| **ElevenLabs** | Best | ~10k chars/mo free | Most natural Ukrainian; recommended. Export MP3. |
| Microsoft Azure Neural | Very good | Free trial credits | Solid, reliable; good if you already have Azure. |
| Google Cloud TTS | Very good | Free tier | Natural; needs GCP setup. |
| Narakeet / SpeechGen / Fliki | Good | Limited free | Convenient browser tools; quality varies. |

## Appendix B — Why custom PWA over off-the-shelf

- **VoiceMap** — excellent quality but a curated marketplace; you can't quickly self-publish a private Ukrainian tour for two people.
- **izi.TRAVEL** — genuinely viable plan B: free, custom tours with your own audio, GPS auto-play, offline download. Less control over UX/branding, but zero code. Use if the build runs out of runway.
- **Custom PWA** — full control, exactly the route + voice + Ukrainian UI you want, no per-user cost, deploy once. Chosen for v1.
