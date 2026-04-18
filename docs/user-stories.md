# User Stories — Cross-Team Work Items

Companion to the [Roadmap in the README](../README.md#roadmap). This document translates the TODOs for the **Edge/Telemetry**, **AGY Pipeline**, **UX/Frontend**, and **Future Work** tracks into user stories with acceptance criteria, so each team can pick up an item and know what "done" looks like.

**Scope:** This file covers work owned by teams *other than* Data Reasoning. For Data Reasoning stories, the work is tracked directly in `docs/data-reasoning.md` on the `data-reasoning` branch.

**Primary user:** Beginner driver in a 2024 Subaru GR86, first time on a real road course (Sonoma Raceway, May 23). Every story assumes this persona unless stated otherwise.

**Convention:** Each story uses the format `As a [role], I want [capability], so that [benefit]`. Acceptance criteria are written so that a developer can self-verify without ambiguity.

---

## Table of Contents

- [Edge / Telemetry](#edge--telemetry)
- [AGY Pipeline](#agy-pipeline)
- [UX / Frontend](#ux--frontend)
- [Future Work](#future-work)

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

### ET-3 — Dual Bluetooth validation on Pixel 10

**As a** field engineer setting up the car before a session,
**I want** to confirm that the Pixel 10 can simultaneously stream from RaceBox Mini (BLE 5.2) and OBDLink MX+ (BT Classic 3.0),
**so that** I know the phone will not drop one device mid-session at Sonoma.

**Acceptance criteria:**
- Written test procedure: pair both devices, start coaching app, drive a 20-minute session at Sonoma or equivalent.
- Measured: frame drop rate per device over the session (target: < 1% dropped frames on either stream).
- Pass criterion: no BT disconnection events in 3 consecutive test sessions.
- If dual-BT fails, document fallback (e.g., RaceBox over USB-C, OBD over BT only).
- Results logged to `docs/hardware-validation.md` (create the doc).

**Dependencies:** Physical access to both devices and the GR86. Blocks field test confidence.

---

### ET-4 — CAN-to-USB bridge for BMW E46 (Team 2)

**As a** Team 2 driver in the BMW E46,
**I want** vehicle data read directly over CAN via USB,
**so that** I get higher-rate OBD data without the BT Classic multiplexing bottleneck.

**Acceptance criteria:**
- USB CAN adapter identified and purchased (one candidate evaluated and documented).
- Adapter emits frames in a format consumable by the same ingestion layer as OBDLink MX+ (adapter layer if needed).
- OBD data rate measured: target ≥ 20Hz sustained.
- Pixel 10 recognizes the USB device; no root or custom kernel required.

**Dependencies:** Team 2 availability for testing. Lower priority than Team 1 GR86 for the May 23 field test.

---

### ET-5 — Steering angle channel

**As a** data analyst reviewing a session post-facto,
**I want** steering angle included in the telemetry stream,
**so that** I can distinguish driver input from vehicle response (per Ross Bentley's Apr 15 request).

**Acceptance criteria:**
- Steering angle available as a field on the telemetry frame (`steeringAngle`, degrees, signed).
- Source identified: OBD PID if available on GR86/E46; otherwise IMU-derived estimate with documented accuracy.
- Field is `null` when unavailable, not zero (zero is a valid steering angle).
- Schema update propagated to `TelemetryFrame` type in `koru-application`.
- Replay CSV format includes the column.

**Dependencies:** ET-1 schema agreement. Does not block May 23 field test but unlocks post-session analysis.

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

## Future Work

> These stories are intentionally lower-fidelity — they capture intent for post-field-test exploration, not commitments for May 23.

### FW-1 — Cold path offline fallback

**As a** driver at a track with no cell signal,
**I want** the coach to still give context-rich multi-frame coaching without the cloud,
**so that** my experience does not degrade to just the hot path at the track.

**Acceptance criteria:**
- Lookup table pre-computed per known track: key = `(cornerId, commonMistake)`, value = coaching text.
- Coaching service tries cloud → lookup table → hot path, in that order.
- Table entries derived from T-Rod notes + Ross Bentley Speed Secrets for Sonoma as the first track.
- Evaluation: On-device Gemma 4 on Pixel 10 benchmarked as a possible upgrade over Gemini Nano; decision recorded.

**Dependencies:** Known tracks with coaching data. Sonoma is the first candidate.

---

### FW-2 — Track auto-detection

**As a** driver at a track day at a venue we did not pre-load,
**I want** the coach to detect corners automatically,
**so that** I get coaching even on unknown circuits.

**Acceptance criteria:**
- Algorithm detects corners from heading change rate alone (no pre-loaded track data required).
- Validated on 3 different tracks (1 pre-loaded, 2 unknown) with measured recall/precision for corner boundaries vs. a hand-labeled ground truth.
- Performance: runs in the hot path budget (< 50 ms per frame).
- Works on a first lap (no prior laps needed to bootstrap).

**Dependencies:** None. Extends current `CornerPhaseDetector`.

---

### FW-3 — Corner-specific coaching on known tracks

**As a** driver at Sonoma with T-Rod's notes loaded,
**I want** corner-specific advice delivered through feedforward,
**so that** I get the real coaching value of a pro before I even reach the turn.

**Acceptance criteria:**
- Track data schema extended with per-corner coaching payload (the `advice` Ross or T-Rod would give).
- Feedforward path (geofence 150 m pre-corner) delivers that payload when the driver approaches a known corner.
- For unknown tracks: decision recorded on whether telemetry-only analysis is sufficient or if human-coach input is required to make feedforward useful.
- Sonoma loaded as the first populated track.

**Dependencies:** Coaching knowledge source (T-Rod notes, Ross material) converted to structured form.

---

### FW-4 — Two-way conversational dialog

**As an** advanced driver,
**I want** to ask the coach "why did I lose time in T6?" mid-session,
**so that** coaching becomes a dialog about nuance rather than one-way instructions.

**Acceptance criteria:**
- Voice-triggered input during the session (push-to-talk or wake word).
- Dialog does not interrupt safety-critical coaching (P0 messages still preempt).
- Response latency target: < 2 s from end-of-question to start-of-answer.
- Conversation state persists across the current session and feeds into post-session review.
- Intentionally scoped to advanced/professional drivers first — not a beginner feature.

**Dependencies:** Stable cold path; likely Gemini Live API or equivalent.

---

### FW-5 — Native Android app

**As a** driver using the system daily,
**I want** a native Android app instead of a PWA,
**so that** I get background audio, direct Bluetooth/USB access, and on-device Gemma 4 without browser limits.

**Acceptance criteria:**
- Native app on Pixel 10 with feature parity to the PWA.
- Direct BLE/BT Classic/USB access without browser Web Bluetooth limits.
- Background audio survives screen lock and app backgrounding.
- Gemma 4 runs on-device as the cold path.
- Installable outside Play Store for pod distribution (sideload or internal channel).

**Dependencies:** FW-1 (offline cold path) or equivalent on-device model.

---

## How this document is maintained

- One user story per README TODO. When a TODO ships, check the box in the README **and** mark the story `✅ Shipped in PR #___` here.
- New TODOs added to the README → add a matching story here in the same PR.
- Role names are consistent: `driver` (beginner by default), `Data Reasoning engineer`, `Edge engineer`, `UX engineer`, `AGY engineer`.
- Acceptance criteria are testable. If you cannot write a checklist someone else could verify, the story is not ready.
