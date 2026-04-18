# User Stories — Cross-Team Work Items

Companion to the [Roadmap in the README](../README.md#roadmap). This document translates the TODOs for the **Edge/Telemetry**, **AGY Pipeline**, and **UX/Frontend** tracks into user stories with acceptance criteria, so each team can pick up an item and know what "done" looks like.

**Scope:** This file covers work owned by teams *other than* Data Reasoning. For Data Reasoning stories, the work is tracked directly in `docs/data-reasoning.md` on the `data-reasoning` branch. *Future Work* items in the README are intentionally out of scope here — they are exploratory and will get stories once they become committed work.

**Platform assumption:** The coaching app is a **Progressive Web App** running in the browser on a Pixel 10 (Vite + React, becoming a full PWA per UX-3). There is no native Android app today. Stories that touch Bluetooth, USB, or background execution use browser-level APIs (Web Bluetooth, WebUSB, Service Worker, Wake Lock) or a tethered companion process — **not** Android `Service` primitives.

> **Web Bluetooth gotcha:** Web Bluetooth supports BLE only, not Bluetooth Classic. The RaceBox Mini (BLE 5.2) works; the OBDLink MX+ (BT Classic 3.0) does **not** connect via Web Bluetooth. Any story involving the OBDLink must either go through a tethered process that talks BT Classic, or switch to the OBDLink's USB interface via WebUSB. Flag this when you pick an architecture.

**Scope:** Team 1 Beginner Pod only. Stories tied to other teams or other cars are out of scope in this document.

**Primary user:** Beginner driver in a 2024 Subaru GR86, first time on a real road course (Sonoma Raceway, May 23). Every story assumes this persona unless stated otherwise.

**Convention:** Each story uses the format `As a [role], I want [capability], so that [benefit]`. Acceptance criteria are written so that a developer can self-verify without ambiguity.

---

## Table of Contents

- [Edge / Telemetry](#edge--telemetry)
- [AGY Pipeline](#agy-pipeline)
- [UX / Frontend](#ux--frontend)

---

## Edge / Telemetry

### ET-1 — Mocked merged telemetry stream API

**As a** Data Reasoning engineer developing coaching logic off-track,
**I want** a mocked HTTP/SSE endpoint that emits a merged RaceBox + OBD frame at realistic rates,
**so that** I can iterate on the hot path and driver model without hardware and without physically being at Sonoma.

**Acceptance criteria:**
- Endpoint emits JSON frames containing at minimum: `time`, `lat`, `lon`, `speed`, `gLat`, `gLong`, `throttle`, `brake`, `rpm`, `gear`.
- GPS/IMU fields update at ~25Hz; OBD fields update at 5–8Hz (frames carry the last-known OBD value between updates).
- Throttling is driven by timestamps in the source dataset, not `sleep()`, so replays are reproducible.
- Defaults to replaying `SampleStream2024.csv` (Sonoma); swappable via query param or env var.
- CORS allows `localhost:5173` (koru-application dev server).
- Documented in `streaming-telemetry-server/README.md` with a curl example.

**Dependencies:** None. Unblocks Data Reasoning integration tests and UX demos.

---

### ET-2 — Pre-rendered MP3s for safety-critical coaching

**As a** beginner driver at 100 mph,
**I want** safety-critical actions (BRAKE, OVERSTEER_RECOVERY, COMMIT) to play from pre-rendered audio clips,
**so that** I get the warning in under 100 ms instead of waiting for TTS synthesis.

**Acceptance criteria:**
- One MP3 per persona (Tony, Rachel, AJ, Garmin, Super AJ) per safety action, for the agreed set of P0 actions.
- Audio files bundled with the app (served statically, offline-capable).
- `audioService.ts` plays the pre-rendered clip when available and falls back to TTS for non-safety actions.
- Playback latency measured: time from `audioService.play()` call to first audible sample is < 100 ms on Pixel 10.
- File naming convention documented so new personas/actions can be added without code changes.

**Dependencies:** Persona voice samples from UX team; final list of P0 actions from Data Reasoning.

---

### ET-3 — Dual Bluetooth validation

**As a** field engineer setting up the car before a session,
**I want** to confirm that our PWA ingestion path can simultaneously pull data from RaceBox Mini (BLE 5.2) and OBDLink MX+ (BT Classic 3.0),
**so that** I know we will not drop one device mid-session at Sonoma.

**Acceptance criteria:**
- Architecture decided first (documented in `docs/edge-architecture.md`): how does each BT device reach the PWA? Options include Web Bluetooth for the RaceBox (BLE) plus a tethered companion process for the OBDLink (BT Classic is not reachable from the browser), or a single tethered process that owns both.
- Written test procedure: start the chosen ingestion path, open the PWA, drive a 20-minute session at Sonoma or equivalent.
- Measured: frame drop rate per device over the session (target: < 1% dropped frames on either stream).
- Pass criterion: no BT disconnection events in 3 consecutive test sessions.
- If dual-BT fails, document fallback (e.g., OBDLink MX+ over its USB interface instead of BT Classic).
- Results logged to `docs/hardware-validation.md` (create the doc).

**Dependencies:** Physical access to both devices and the GR86. Blocks field test confidence.

---

### ET-4 — Steering angle channel

**As a** data analyst reviewing a session post-facto,
**I want** steering angle included in the telemetry stream,
**so that** I can distinguish driver input from vehicle response.

**Acceptance criteria:**
- Steering angle available as a field on the telemetry frame (`steeringAngle`, degrees, signed).
- Source identified: OBD PID if available on the GR86; otherwise IMU-derived estimate with documented accuracy.
- Field is `null` when unavailable, not zero (zero is a valid steering angle).
- Schema update propagated to `TelemetryFrame` type in `koru-application`.
- Replay CSV format includes the column.

**Dependencies:** ET-1 schema agreement. Does not block May 23 field test but unlocks post-session analysis.

---

### ET-5 — Time sync and OBD upsampling

**As a** Data Reasoning engineer consuming a merged RaceBox + OBD frame,
**I want** every frame to carry a single monotonic timestamp with GPS and OBD aligned to the same clock,
**so that** I can correlate a throttle input with the G-force it produces without false offsets corrupting the driver model or decision matrix.

**Acceptance criteria:**
- Clock alignment: a cross-correlation calibration routine detects a synchronization event (e.g., hard throttle blip producing an RPM spike and a longitudinal G spike) and computes the offset between the RaceBox GPS epoch and the browser's monotonic clock (`performance.now()` or `Date.now()` — the one used to timestamp OBD frames as they arrive at the PWA).
- Measured offset falls in the expected 20–80 ms range; calibration runs at session start and re-checks every N minutes (value documented).
- OBD channels (5–8 Hz) are upsampled to the RaceBox rate (25 Hz) on the merged stream.
- Continuous channels (throttle %, RPM) use linear interpolation; discrete channels (gear, brake boolean) use zero-order hold. Behavior documented per channel in `docs/session-schema.md`.
- Interpolation does not introduce ghost spikes — verified by replaying a known session and comparing interpolated vs. raw channel curves.
- Every emitted `TelemetryFrame` carries a `time` field in a single clock domain; raw per-source timestamps optionally preserved as `raceboxTime` / `obdTime` for debugging.

**Dependencies:** ET-1 (merged stream exists); ET-3 (dual-BT stable enough to run calibration). Critical for coaching quality — without it the driver model sees causally-inverted events.

---

### ET-6 — Resilient BT bridge that survives backgrounding

**As a** driver with my Pixel 10 mounted in the car,
**I want** the telemetry streams to keep running if the screen locks or I switch tabs briefly,
**so that** I do not lose a lap of coaching because the browser throttled or suspended a background connection.

**Context:** The app is a PWA. Two viable implementation paths — pick one and document in `docs/edge-architecture.md` before implementing:
- **Path 1 (PWA + Web Bluetooth)**: RaceBox connects from the browser via Web Bluetooth. Keep-alive uses `navigator.wakeLock.request('screen')`, a service worker for the app shell, and installed-PWA mode. Does **not** work for the OBDLink MX+ (BT Classic not supported) — OBD must go through Path 2 or via the OBDLink's USB interface.
- **Path 2 (PWA + tethered companion process)**: a companion process (Python/Node) running on a laptop tethered to the Pixel over local Wi-Fi or hotspot talks BT/USB and proxies frames to the PWA over SSE — extends the current `streaming-telemetry-server` pattern. Sidesteps browser-platform limitations entirely.

**Acceptance criteria:**
- Decision recorded: which path, with rationale and how each BT/USB device is reached.
- Screen-lock stress test: 30 minutes of driving with screen locked (or screen on but PWA backgrounded), no user interaction — coaching continues, frame drops within the ET-3 baseline.
- Tab/app switch test: briefly switching to another app, then back — no reconnect required.
- For the RaceBox Mini BLE 5.2 connection under Web Bluetooth: document whether the Chrome Web Bluetooth API exposes a connection-priority equivalent and the measured steady-state BLE latency (target band: 7.5–15 ms, or the measured baseline if the API cannot request high priority).
- Reconnect logic: on unexpected disconnect, automatic reconnection within 5 seconds without user interaction.
- Persistent in-UI indicator shows connection status: connected / reconnecting / disconnected.

**Dependencies:** ET-3 (dual-BT stability baseline), UX-3 (PWA installation required for reliable Wake Lock on screen lock). Required for the May 23 field test.

---

## AGY Pipeline

### AGY-1 — Post-session data schema

**As an** AGY Pipeline engineer storing session data,
**I want** a documented schema for coaching events and lap metrics,
**so that** every session produces a consistent record that Data Reasoning and analytics can consume.

**Acceptance criteria:**
- Schema documented in `docs/session-schema.md` with JSON examples.
- Covers: per-frame telemetry, coaching events (`CoachingDecision` payloads with timestamps), per-lap metrics (lap time, sector times, per-corner min speed / max brake / exit speed).
- Schema references existing TypeScript types in `koru-application/src/types.ts` where applicable.
- Decision recorded: storage target (BigQuery / local JSON / IndexedDB) with rationale (offline-first at the track is a hard constraint).
- Versioning strategy: a `schemaVersion` field so future changes can migrate old sessions.

**Dependencies:** None. Unblocks AGY-2 and AGY-3.

---

### AGY-2 — Coaching event ingestion

**As a** Data Reasoning engineer,
**I want** to export the coaching events stream at session end,
**so that** AGY can run post-session analysis (mistake zones, improvement trends) without polluting the hot path.

**Acceptance criteria:**
- An exporter in `koru-application` writes the session to the AGY-1 schema at session end (Stop button → file or endpoint).
- Export runs off the hot path — no measurable increase in coaching latency during the session.
- File format: JSON (offline) or POST to ingestion endpoint (online); both supported.
- A session record includes: driver ID, track, car, start/end timestamps, telemetry frames, coaching events, computed lap metrics.
- Can be re-imported into the Analysis page without data loss.

**Dependencies:** AGY-1.

---

### AGY-3 — DriverProfileStore persistence backend

**As a** driver doing my second session of the day,
**I want** the coach to remember that I kept late-apexing T11 in my first session,
**so that** it can prioritize T11 feedback early in the next session without me telling it again.

**Acceptance criteria:**
- Implementation of the `DriverProfileStore` interface defined in `koru-application/src/types.ts` (methods: `load()`, `save()`, `addSession()`).
- Backing store: IndexedDB for primary (offline-first); optional cloud sync layer documented but not required for May 23.
- Profile persists across browser restarts and page reloads.
- Schema matches the `DriverProfile` type exactly — no fields added or omitted without updating the shared type.
- Migration strategy for profile schema changes (at minimum: version field + clear-on-mismatch).
- Unit tests: save → reload → data matches; addSession appends to the correct driver.

**Dependencies:** `DriverProfile` + `DriverProfileStore` interfaces (already defined by Data Reasoning, Phase 6.3).

---

## UX / Frontend

### UX-1 — CoachPanel shows coaching metadata

**As a** developer demoing the split-brain coaching engine,
**I want** the UI to show priority, action name, and corner phase for each coaching message,
**so that** the Phase 0–6 Data Reasoning logic is visible to reviewers without opening the console.

**Acceptance criteria:**
- CoachPanel renders each `CoachingDecision` with: priority badge (P0 red / P1 orange / P2 blue / P3 grey), action label (e.g. `HUSTLE`, `BRAKE`), and current corner phase (e.g. `ACCELERATION`).
- Priority badge uses color + icon (accessible without color alone).
- Action label visible even when the spoken text is long — does not get truncated.
- Once deployed, the temporary `console.log` statements (tagged `// TODO: Remove when CoachPanel displays metadata`) in `coachingService.ts` are removed.
- Visual regression test (or screenshot in PR) shows all four priority styles.

**Dependencies:** None. Low-risk, high-visibility change for the Apr 29 gate.

---

### UX-2 — Pre-race chat UI

**As a** beginner driver 10 minutes before going on track,
**I want** to tell the coach "I want to focus on looking further ahead and braking earlier",
**so that** the coach prioritizes those issues over less relevant ones during my session.

**Acceptance criteria:**
- Interface (form or conversational chat) collects 1–3 session goals from the driver.
- Output conforms to the `SessionGoal[]` type per `docs/pre-race-chat-contract.md` on the `data-reasoning` branch.
- Selected goals are passed to `coachingService.setSessionGoals()` before the session starts.
- If the driver picks 0 goals, session proceeds with no bias (coaching works as today).
- Max 3 goals enforced by UI (Ross Bentley pedagogy constraint).
- Goals map cleanly to focus categories: `braking`, `throttle`, `vision`, `lines`, `smoothness`, `custom`.
- Accessible: keyboard navigation, screen reader friendly.

**Dependencies:** `SessionGoal` type and contract (already defined by Data Reasoning).

---

### UX-3 — Progressive Web App

**As a** driver at Sonoma Raceway with no cell signal in the paddock,
**I want** the app to load and run fully offline after my first visit,
**so that** I do not need a network connection to start a session.

**Acceptance criteria:**
- Service worker caches the app shell (HTML, JS, CSS, fonts, icons, pre-rendered MP3s from ET-2).
- `manifest.json` with name, icons, and standalone display mode so it installs to the home screen on Pixel 10.
- Second visit with airplane mode on: app loads, hot path works, feedforward works.
- Cold path (Gemini) degrades gracefully offline — no thrown errors, a clear UI hint that cloud coaching is unavailable.
- Lighthouse PWA audit passes.

**Dependencies:** None (hot path already runs client-side).

---

### UX-4 — Minimal HUD (signal light)

**As a** driver at 80 mph who cannot look at a screen,
**I want** a peripheral green/yellow/red signal,
**so that** I get a glance-able confirmation that the coach is active without reading text.

**Acceptance criteria:**
- Single large visual element (circle or bar) visible in peripheral vision.
- Color semantics: green = on track / no issues, yellow = P2/P3 coaching active, red = P0/P1 safety-critical coaching.
- No text in this view (text is only in the audio channel).
- Toggle-able from main UI; defaults on when session starts.
- Works portrait and landscape; tested on Pixel 10 dimensions.

**Dependencies:** Priority levels from `CoachingDecision` (already available).

---

### UX-5 — Coach persona selection UX

**As a** driver picking my coach voice,
**I want** the app to suggest a persona matching my skill level,
**so that** I do not get Garmin-style numeric data as a first-time driver.

**Acceptance criteria:**
- Persona selector shows a "recommended" label on one option based on `driverModel.getSkillLevel()`.
- Mapping documented: e.g., BEGINNER → Tony (motivational), ADVANCED → Garmin (data-driven).
- Mid-session switching: evaluate via a brief user study (even informal — 2–3 pod members). Document whether it is useful or distracting. Decision recorded in `docs/ux-decisions.md`.
- If mid-session switch is kept: switching does not drop any queued coaching messages.

**Dependencies:** Driver model skill level (already available).

---

## How this document is maintained

- One user story per README TODO. When a TODO ships, check the box in the README **and** mark the story `✅ Shipped in PR #___` here.
- New TODOs added to the README → add a matching story here in the same PR.
- Role names are consistent: `driver` (beginner by default), `Data Reasoning engineer`, `Edge engineer`, `UX engineer`, `AGY engineer`.
- Acceptance criteria are testable. If you cannot write a checklist someone else could verify, the story is not ready.
