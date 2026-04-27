# Trustable AI Race Coach

Today's best telemetry systems — including the SOTA Garmin Catalyst — run on fixed, deterministic rules. They tell you what went wrong after the fact, with numbers. This project takes a different approach: a multimodal, agentic AI system built on Google's stack — Gemini API for cloud reasoning today, with on-device inference (Gemini Nano via the Chrome Prompt API, or a Gemma model) explored as part of the roadmap — that processes real-time data streams to deliver context-aware coaching as it happens, adapted to driver skill level.

The goal is to build a reference architecture that proves a split-brain AI can be trusted in a mission-critical, zero-latency environment. The patterns and learnings from high-frequency racing telemetry are designed to translate to broader enterprise domains where real-time AI decision-making under pressure is the challenge.

```
Catalyst tells you what you did wrong with numbers.
This system tells you in real time how to adapt and fix it, adjusted to your skill level.
```

## Table of Contents

- [April 29 Technical Gate — Data Reasoning Checkpoint](#april-29-technical-gate--data-reasoning-checkpoint)
- [Roadmap](#roadmap)
  - [Data Reasoning](#data-reasoning)
  - [Edge / Telemetry](#edge--telemetry)
  - [AGY Pipeline](#agy-pipeline)
  - [UX / Frontend](#ux--frontend)
  - [Future Work](#future-work)
- [Hardware Stack](#hardware-stack)
- [Architecture](#architecture)
  - [Split-Brain Coaching Engine](#split-brain-coaching-engine)
  - [Coach Personas](#coach-personas)
- [Onboarding](#onboarding)
- [streaming-telemetry-server](#streaming-telemetry-server)
- [koru-application](#koru-application)
- [Tech Stack](#tech-stack)
- [Data Reasoning Documentation](docs/data-reasoning.md)

---

## April 29 Technical Gate — Data Reasoning Checkpoint

This section is the entry point for the architecture + code review on **April 29, 2026**. It summarizes what data reasoning has shipped, how it sits in the larger system, and what reviewers should evaluate.

### What has shipped (Phases 0–5 complete, Phase 6 partial)

All work lives in [`koru-application/src/services`](koru-application/src/services) and [`koru-application/src/utils`](koru-application/src/utils). Detailed module-by-module documentation in [`docs/data-reasoning.md`](docs/data-reasoning.md).

| Phase | Status | What's in it |
|-------|--------|--------------|
| 0 — Foundation | ✅ | Types (`CornerPhase`, `TimingState`, `CoachingDecision`, `DriverState`), shared `geoUtils`, telemetry parser fix for Sonoma CSV, `OVERSTEER_RECOVERY` safety rule. |
| 1 — Detection + timing | ✅ | `CornerPhaseDetector` (GPS primary with equirectangular pre-filter + G-force fallback). `TimingGate` state machine with pre-blackout state restoration. |
| 2 — Priority queue | ✅ | `CoachingQueue` with P0–P3 priorities, 3s stale expiry, P0 preempt, max 5 items. |
| 3 — Driver model | ✅ | `DriverModel` classifies BEGINNER / INTERMEDIATE / ADVANCED from input smoothness + coasting ratio. Time-based 10s window, 5s hysteresis with re-promotion guard. |
| 4 — Test infrastructure | ✅ | Vitest, **81 tests across 9 files**, Sonoma CSV integration. Covers cooldown-during-blackout, GPS phase reachability, hysteresis, P0 floor. |
| 5 — Coaching knowledge | ✅ | Ross Bentley mental models + T-Rod patterns in physics knowledge. 4 new decision rules. Skill-adapted humanization. Session progression. Hustle detection. |
| 6 — Session intelligence | 🟡 partial | `SessionGoal` + `setSessionGoals()` with working `prioritizedActions` boost (floored at P1). `DriverProfile` / `DriverProfileStore` interfaces. In-session `PerformanceTracker`. **Pending:** message compression (owned), pre-race chat UI (UX), persistence backend (AGY). |

### Architecture in one diagram

The system is described as an 8-layer split, with data reasoning owning layers 2–6. Edge / Telemetry feeds layer 1, AGY Pipeline persists layer 8, UX renders layer 7. The 8 layers are *logical* boundaries (data contracts and responsibilities) rather than separate processes — in the current PWA build, layers 2–6 live inside `CoachingService` as a module graph. The boundaries show up in the type system, not the deployment topology, which is a deliberate trade-off for the <50ms HOT-path budget.

```
                     ┌─────────────────────────────────────────────────┐
                     │        koru-application (PWA, Pixel 10)         │
                     │                                                 │
 ┌──────────────┐SSE │  ┌─────────────┐    ┌──────────────────────┐    │
 │ RaceBox 25Hz │───►│  │ Telemetry   │───►│   CoachingService     │   │
 │ + OBDLink    │    │  │ Stream      │    │   ─────────────────   │   │
 │ + CSV replay │    │  └─────────────┘    │ DriverModel ─┐        │   │
 └──────────────┘    │                     │ CornerPhase ─┤        │   │
                     │                     │ TimingGate  ─┼─► HOT  │   │
                     │                     │ Queue       ─┤  COLD ─┼──►│ Gemini Flash
                     │                     │ Performance ─┤  FEED ─┤   │
                     │                     │ SessionGoals ┘        │   │
                     │                     └────────┬─────────────┘    │
                     │                              ▼                  │
                     │                  Audio (TTS + AudioContext)     │
                     └─────────────────────────────────────────────────┘

   Latency budget: <50ms HOT, 2–5s COLD, 150m geofence FEED.  "800ms late > silence."
```

**Decision routing:** every frame fans out to three paths. HOT runs heuristics + driver-adapted humanization in-process; COLD prompts Gemini with a skill-adapted prompt and physics context; FEEDFORWARD fires from a 150m geofence around known corners. All three enqueue into a single priority queue, and the TimingGate decides whether the dequeue actually speaks.

**Data reasoning enriches Gemini, not replaces it:** see the [Architecture → How Data Reasoning Works Alongside Gemini](#how-data-reasoning-works-alongside-gemini) section below for the full framing.

### What we'd value reviewer input on (April 29)

The hard technical gate is two days out. These are the areas where outside review would be most useful — both to validate decisions we're confident in and to surface concerns we may have under-weighted.

1. **Latency budget.** The HOT path is designed for <50ms; we now have a benchmark test ([`coachingService.latency.test.ts`](koru-application/src/services/__tests__/coachingService.latency.test.ts)) reporting mean and p99 over 1000 frames. We have not yet measured on a Pixel 10 with audio + Gemini in flight; that measurement is the most useful thing reviewers could push for.
2. **Safety bypass surface area.** P0 (`OVERSTEER_RECOVERY`, and future `BRAKE`) is the only intended path that bypasses the TimingGate. After PR #3, `boostForGoals` is floored at P1 so no goal-promoted action can reach P0. The TimingGate state machine (`OPEN → DELIVERING → COOLDOWN → BLACKOUT`) and the COOLDOWN-interrupted-by-BLACKOUT restoration in [`timingGate.ts`](koru-application/src/services/timingGate.ts) are the load-bearing pieces — fresh eyes are welcome.
3. **Driver model.** Smoothness + coasting are coarse proxies. The 10s window + 5s hysteresis + re-promotion guard keep the classification stable, but the underlying signals haven't been validated against actual coach assessments. Reviewer feedback on whether this is a reasonable v1 versus a placeholder would be useful.
4. **Offline behavior.** Cold path resets `lastColdTime = 0` on fetch failure so the next frame can retry. HOT + FEEDFORWARD work without network. Worth confirming the offline contract is clear enough for the May 23 Sonoma field test.
5. **Coaching content.** `humanizeAction` covers 5 personas × ~20 actions × 3 skill levels — a lot of strings. The BEGINNER set is derived from Ross Bentley pedagogy and the T-Rod Sonoma session. A spot-check against the T-Rod transcript would help.
6. **Cross-team contracts.** Phase 6.2 depends on UX (Rabimba) — see [`docs/pre-race-chat-contract.md`](docs/pre-race-chat-contract.md). Phase 6.3 depends on AGY Pipeline (Mike) — `DriverProfileStore` interface in [`types.ts`](koru-application/src/types.ts). Useful for reviewers to sanity-check whether these contracts are enough for the downstream pods to start.
7. **Test coverage.** 81 unit + integration tests with regressions for every blocker fix, plus the new latency benchmark. Acknowledged gaps: no soak test for queue under burst input; no end-to-end test of cold-path retry on the actual Gemini endpoint. Flagging in case either is needed before the field test.

### Telemetry capability matrix (degraded modes)

If BT Classic on the OBDLink MX+ doesn't reach the PWA in time for May 23, the system runs in a degraded telemetry mode. A breakdown of what coaching capability survives in each channel set is documented in [`docs/data-reasoning.md` → Telemetry Capability Matrix](docs/data-reasoning.md#telemetry-capability-matrix-degraded-modes). Short version: GPS + IMU only retains roughly 60–70% of coaching actions, with FEEDFORWARD corner advice intact, but DriverModel classification leans BEGINNER because synthetic brake/throttle from G-force estimation have low variance.

### Comparison vs. Garmin Catalyst (the SOTA we're trying to beat)

|  | Garmin Catalyst | This project |
|---|---|---|
| Coaching model | Pure heuristic, fixed rules | Heuristic (HOT) + Gemini (COLD) + geofence (FEED) |
| Driver adaptation | None | Driver model classifies skill, adjusts cooldown / blackout / prompts |
| Timing | Always talks (even mid-corner) | TimingGate with blackout during apex / mid-corner |
| Track knowledge | Delta vs best lap (numbers) | Corner-specific advice, real-coach phrasing, physics |
| Personalization | One voice, one style | 5 personas × 3 skill levels |
| Hustle detection | No | Lazy-throttle detection on exits (Ross Bentley insight) |
| Session goals | No | 1–3 focus areas bias hot-path priority |
| Improvement tracking | Lap times only | Per-corner deltas, lap-over-lap encouragement |
| Offline | Yes | Yes for HOT + FEEDFORWARD; COLD requires network (degrades silently to HOT-only) |

---

## Roadmap

> Cross-team TODOs below have testable user-story versions with acceptance criteria in [`docs/user-stories.md`](docs/user-stories.md).

### Data Reasoning

> **Focus: BEGINNER drivers** (Team 1 Beginner Pod). All coaching logic, humanization, and thresholds are tuned for beginner skill level first. The same codebase supports intermediate/advanced via the Driver Model, but the primary target is someone on track for the first time.

See [`docs/data-reasoning.md`](docs/data-reasoning.md) for detailed feature documentation and how to run tests.

**Phase 0-3: Foundation + Core Engine** (implemented on `data-reasoning` branch)
- [x] **Timing state machine** — OPEN → DELIVERING → COOLDOWN → BLACKOUT. P0 safety bypasses blackout. Blackout during MID_CORNER + APEX for beginners. Restores COOLDOWN cleanly when BLACKOUT interrupts it.
- [x] **Priority queue** — P0 safety, P1 tactical, P2 strategic, P3 encouragement. Max 5 items, 3s stale expiry, preempt for safety.
- [x] **Driver model** — Skill classification from smoothness + coasting ratio. Time-based 10s window (handles 8Hz OBD + 25Hz RaceBox). 5s hysteresis with re-promotion guard.
- [x] **Corner phase detection** — GPS primary (APEX/MID_CORNER/TURN_IN/EXIT/BRAKE_ZONE all reachable, ordering verified by tests) + G-force fallback (track-agnostic). Equirectangular pre-filter for performance.
- [x] **Foundation types** — CornerPhase, TimingState, CoachingDecision, DriverState, OVERSTEER_RECOVERY, telemetry parser fix for Sonoma CSV.

**Phase 4: Test Infrastructure** (implemented)
- [x] **78 tests across 9 files** — geoUtils, CornerPhaseDetector, TimingGate, CoachingQueue, DriverModel, DecisionMatrix, PerformanceTracker, CoachingService Phase 6, Sonoma CSV integration. Includes regression tests for the cooldown-during-blackout fix, GPS phase reachability, hysteresis, and session-goal priority boost.
- [x] **Vitest setup** — `npm test` runs all tests.

**Phase 5: Coaching Knowledge Enrichment** (implemented)
- [x] Ross Bentley mental models (7) + T-Rod coaching patterns (5) in racing physics knowledge
- [x] 4 new decision matrix rules: EARLY_THROTTLE, LIFT_MID_CORNER, SPIKE_BRAKE, COGNITIVE_OVERLOAD
- [x] Skill-adapted humanization (beginner: feel-based T-Rod + Ross Bentley trigger phrases, advanced: data-driven)
- [x] Session progression (time-based phases, suppress advanced actions for beginners)
- [x] Cold path prompts adapted per skill level
- [x] Ross Bentley trigger phrases: "Hard initial!", "Eyes up!", "Hustle!", "Squeeze don't stab"
- [x] Hustle/laziness detection — detects lazy throttle on exits for beginners (Ross Bentley insight)

**Phase 6: Session Intelligence** (in progress)
- [ ] **6.1 Message Compression** — paragraph → sentence → trigger phrase progression. First time: full instruction. Repeated: trigger phrase only. Per action+corner tracking within session. (Ross Bentley: trigger phrases are the goal state). *Owned by data-reasoning, no external blockers — next task to land in this branch.*
- [x] **6.2 Pre-Session Goal Setting** — `SessionGoal` type + `setSessionGoals()` API. `prioritizedActions` now actually bias the hot path: a listed action gets a one-tier priority boost (P3→P2, P2→P1; P0 stays P0).
  - *Needs from UX (Rabimba):* A pre-race chat screen that collects 1–3 goals, serializes them to the `SessionGoal[]` shape in [`docs/pre-race-chat-contract.md`](docs/pre-race-chat-contract.md), and calls `coachingService.setSessionGoals(goals)` before the live session starts.
  - *Needs from data-reasoning (after UX lands):* emit P3 encouragement when the associated `PerformanceTracker` metric improves.
- [x] **6.3 Cross-Session Driver Profile** — `DriverProfile` + `DriverProfileStore` interfaces defined. Tracks skill level, problem corners, strengths/weaknesses across sessions.
  - *Needs from AGY Pipeline (Mike):* (a) define the storage schema covering `DriverProfile` fields (skill level history, weak corners by track, goal completion counts), (b) expose endpoints / a client SDK that satisfies the `DriverProfileStore` interface in `types.ts`, and (c) a write hook at session end to flush `PerformanceTracker.getCornerHistories()` into the profile. Tracked as AGY-1 / AGY-2 in `docs/user-stories.md`.
  - *Needs from data-reasoning (after AGY lands):* swap the in-memory stub for the real store, add a session-boundary flush call, add regression tests against a fake store.
- [x] **6.4 In-Session Improvement Tracking** — `PerformanceTracker` tracks per-corner metrics (min speed, brake point, throttle %, corner name) within a session. Lap-over-lap delta emits P3 encouragement on improvement. Cross-session trends require persistence layer (Phase 6.3).
- [ ] **Auto-generation of session goals from DriverProfile** — Once persistence lands, derive default goals from the driver's recent weak corners/mistakes instead of asking from scratch. *Depends on 6.2 + 6.3 above — no net new cross-team asks.*

### Edge / Telemetry

**Hardware stack** (confirmed Apr 14 mentorship with Brian Luc):
| Device | Rate | Interface | Data |
|--------|------|-----------|------|
| RaceBox Mini | 25Hz GPS + IMU | BLE 5.2 | lat, lon, speed, gLat, gLong, altitude |
| OBDLink MX+ | 5-8Hz OBD-II | BT Classic 3.0 | throttle, brake, RPM, gear, coolant |
| Pixel 10 | — | USB-C / BT | Runs the coaching PWA. On-device inference (Gemini Nano via Chrome Prompt API, or a Gemma model) is roadmap, not deployed today. |

**Team car:** 2024 Subaru GR86 (automatic, DauntlessOBD CAN) — Team 1 Beginner Pod.

**Latency budget:** 300-500ms from event to audio. "Feedback 800ms late is worse than silence."

- [x] **Hardware stack documented** — RaceBox Mini 25Hz, OBDLink MX+ 5-8Hz, Pixel 10 pipeline
- [ ] **Extend `streaming-telemetry-server` to emit merged RaceBox+OBD stream** — Server already exposes SSE + CSV replay + CORS. Needed: emit the OBD/IMU channels already present in `SampleStream2024.csv` (throttle, brake, RPM, gear, gLat, gLong, steering), drive replay off source timestamps instead of fixed 10Hz `sleep()`, and separate rates (25Hz GPS/IMU, 5-8Hz OBD). Unblocks removing the virtual brake/throttle hack in `telemetryStreamService.ts`.
- [ ] **Pre-rendered MP3s for safety-critical actions** — Audio clips for BRAKE, OVERSTEER_RECOVERY, COMMIT per persona
- [ ] **Dual BT test** — Validate BLE 5.2 (RaceBox) + BT Classic 3.0 (OBDLink) simultaneous on Pixel 10
- [ ] **Steering angle channel** — OBD PID if available on the GR86; otherwise IMU-derived estimate
- [ ] **Time sync and OBD upsampling** — Cross-correlation calibration (hard throttle blip → RPM spike vs longitudinal G spike) aligns RaceBox GPS epoch with the browser's monotonic clock (expected 20-80ms offset). Upsample OBD (5-8Hz) to RaceBox rate (25Hz): linear interp for continuous channels, zero-order hold for discrete.
- [ ] **Resilient BT bridge (PWA survives backgrounding)** — Pick an implementation path (Web Bluetooth for RaceBox + tethered companion process for OBDLink BT Classic, OR tethered process for both). PWA-level keep-alive with `navigator.wakeLock` + service worker; automatic reconnect on disconnect. See user story ET-6 for acceptance criteria.

### AGY Pipeline

- [ ] **Define post-session data schema** — Specify what format coaching events and lap metrics should be stored in (BigQuery, local JSON, or other) so the coaching engine can export session data for analysis and cross-session learning.
- [ ] **Build ingestion for coaching events** — Receive per-corner metrics (brake point, apex speed, exit speed), mistake zones, and coaching decisions from each session. Enable post-session analysis and improvement tracking.
- [ ] **Persistence layer for cross-session driver profile** — Implement `DriverProfileStore` interface (defined by Data Reasoning in `src/types.ts`). Storage backend (IndexedDB, localStorage, or cloud sync) that persists `DriverProfile` across sessions. Data Reasoning defines what to store; AGY Pipeline provides the how. See `DriverProfileStore` interface: `load()`, `save()`, `addSession()`.

### UX / Frontend

- [ ] **Update CoachPanel to show coaching metadata** — CoachPanel currently shows only `path` and `text`. Update to display priority badge (P0-P3), action name, and corner phase from `CoachingDecision`. This makes the Data Reasoning layer visible in the UI.
- [ ] **Pre-race chat UI** — Build a pre-session goal-setting interface (form or conversational). Output: array of `SessionGoal` objects passed to `coachingService.setSessionGoals()`. See integration contract: `docs/pre-race-chat-contract.md`. Max 3 goals, beginner-focused.
- [ ] **Convert to PWA** — Add service worker and manifest for offline support. The hot path and feedforward already run client-side; PWA ensures the UI loads without network at the track.
- [ ] **Minimal HUD for track use** — Design a signal-light-only visual (green/yellow/red) for in-car use. The driver cannot look at a screen; audio is primary, but a peripheral color signal adds confirmation without distraction.
- [ ] **Coach persona selection UX** — Evaluate whether mid-session coach switching is useful or distracting. Consider recommending a persona based on driver skill level from the driver model.

### Future Work

- [ ] **Cold path offline fallback** — Pre-compute a coaching lookup table for known tracks (keyed by corner + common mistakes) as offline replacement for Gemini cold path. Evaluate on-device Gemma 4 on Pixel 10 as an upgrade over Gemini Nano.
- [ ] **Track auto-detection** — Detect corners on unknown tracks from heading change rate alone, without pre-loaded track data. Enables track-agnostic coaching for any track day.
- [ ] **Corner-specific coaching** — Integrate real coach knowledge (T-Rod session notes, Ross Bentley curriculum) into feedforward path for known tracks. For unknown tracks, determine whether telemetry-only analysis is sufficient or human coaching input is required.
- [ ] **Two-way conversational dialog** — Enable real-time back-and-forth between the driver and the AI coach. This is the pinnacle for advanced drivers, where coaching becomes a discussion about minute nuances, setup adjustments, and driving strategy rather than one-way instructions.
- [ ] **Native Android app** — Move from PWA to a native Android application on the Pixel 10. Native access to Bluetooth/USB for direct hardware communication, background audio, and on-device Gemma 4 inference without browser limitations.

---

## Hardware Stack

All teams share a common compute and sensor platform. Car-specific adapters vary by team. **This repo's active work targets Team 1 (Beginner Pod) — the TODOs above are scoped to the GR86.**

### Common Stack (All Teams)

| Device | Role | Connection | Data Rate |
|--------|------|------------|-----------|
| **Pixel 10** | Compute gateway, audio output, edge AI inference | — | — |
| **RaceBox Mini** | 25Hz GPS + IMU (position, speed, heading, lateral/longitudinal G) | BLE 5.2 | 25 Hz, 7.5-15ms latency |
| **OBDLink MX+** | Standard OBD-II adapter (RPM, speed, pedal position, coolant temp) | Bluetooth Classic 3.0 | 5-8 Hz effective |

### Team Cars (reference only — active work is Team 1)

| Team | Car | OBD Path | Notes |
|------|-----|----------|-------|
| **Team 1 (Beginner)** | 2024 Subaru GR86 (automatic) | DauntlessOBD Enhanced + Hachi ASC CAN | Full CAN access, 100-500 kbps |
| **Team 2 (Intermediate)** | BMW E46 M3 (MSS54HP) | OBDLink MX+ K-Line (Path A) or CANable 2.0 direct CAN (Path B) | K-Line limited to 10.4 kbaud, 9 channels |
| **Team 3 (Pro)** | Honda S2000 AP2 | MoTec system (separate sync) | Pro data unit handled by T-Rod |

### Data Channel Tiers

Coaching capability scales with available data channels. Team 1 sits at Tier 1; Tiers 2–3 are referenced for roadmap context only.

| Tier | Channels | Coaching Capability |
|------|----------|-------------------|
| **Tier 1 (Beginner)** | GPS + IMU + RPM + Speed | Lap time delta, brake markers, apex location, corner speed |
| **Tier 2 (Enthusiast)** | + Pedal position + Coolant temp + Oil temp | Throttle commitment, safety alerts (S54 >105°C coolant, >130°C oil) |
| **Tier 3 (Professional)** | + Wheel speeds x4 + Steering angle + Brake state | Traction circle utilisation, slip ratio, ABS map, trail braking quality |

### Latency Budget

Total budget from telemetry event to audio coaching: **300-500ms**.

```
RaceBox BLE → Pixel 10:     7.5 - 15 ms
OBD K-Line round-trip:      80 - 150 ms (vehicle-side, cannot reduce)
Browser BLE → fusion:       5 - 10 ms
AI inference (hot path):    < 50 ms
TTS audio output:           50 - 200 ms
                            ─────────────
Total:                      ~200 - 425 ms
```

> "Feedback 800ms late is worse than silence." — Brian Luc, Mentorship Session 1

---

## Architecture

Two components work together: a **telemetry server** streams GPS/vehicle data over SSE, and a **web application** processes that stream through a split-brain coaching engine that decides what to say and when.

```
                         ┌─────────────────────────────────────────────┐
                         │           koru-application (React)          │
                         │                                             │
 ┌───────────────┐  SSE  │  ┌─────────────┐    ┌──────────────────┐   │
 │  Telemetry    │──────►│  │  Telemetry   │───►│  CoachingService │   │
 │  Server       │       │  │  Stream      │    │  (Split-Brain)   │   │
 │  (FastAPI)    │       │  │  Service     │    │                  │   │
 └───────────────┘       │  └─────────────┘    │  HOT ──► <50ms   │   │
        ▲                │                      │  COLD ─► Gemini  │   │
        │                │                      │  FEED ─► Geofence│   │
 ┌──────┴──────┐         │                      └────────┬─────────┘   │
 │ GPS Device  │         │                               │             │
 │ (Racelogic) │         │  ┌──────────┐    ┌────────────▼──────────┐  │
 │ or Mock CSV │         │  │  Gemini  │    │    Audio Output       │  │
 └─────────────┘         │  │  Service │    │  (TTS + AudioContext) │  │
                         │  └──────────┘    └───────────────────────┘  │
                         │                                             │
                         │  Pages: Landing │ Dashboard │ Live │ Replay │
                         └─────────────────────────────────────────────┘
```

### Split-Brain Coaching Engine

The coaching engine routes decisions through three paths based on urgency:

```
  TelemetryFrame
       │
       ├──► HOT PATH (heuristic rules, <50ms)
       │    "Trail brake!" "Commit!" "Brake!"
       │    No cloud round-trip. Fires on threshold violations.
       │
       ├──► COLD PATH (Gemini 2.5 Flash Lite, 2-5s)
       │    Multi-frame telemetry analysis with physics context.
       │    "You're lifting early in T5 — trust the grip through mid-corner."
       │
       └──► FEEDFORWARD (geofence triggers, 150m before corner)
            Corner-specific advice delivered before the maneuver.
            "T3 right: late apex, brake at the 100m board."
```

### How Data Reasoning Works Alongside Gemini

Data reasoning is designed to partner with Gemini end-to-end. Gemini is the language and voice of the coach — generating nuanced cold-path analysis, shaping prompts into natural coaching lines, and speaking them via TTS. Data reasoning is the judgment layer that sits beside Gemini and makes it race-safe: it decides which telemetry events are worth reasoning about, hands Gemini a skill-adapted prompt with the right physics and pedagogy context, and governs when any output — Gemini's or heuristic — is actually delivered. The two are co-designed:

- **Feeding Gemini (input enrichment)** — The HOT path filters raw telemetry through a decision matrix so only meaningful events reach the coaching layer. The DriverModel classifies the driver (BEG/INT/ADV) and rewrites the cold-path prompt accordingly: beginners get feel-based, trigger-phrase prompts; advanced drivers get data-driven, technical prompts. Ross Bentley mental models and session-phase context are injected into the prompt so Gemini reasons with physics + pedagogy, not just numbers.
- **Pairing with Gemini (output gating)** — The TimingGate state machine (OPEN → DELIVERING → COOLDOWN → BLACKOUT) decides *when* any output is actually spoken. The priority queue replaces stale Gemini responses with fresher P0/P1 safety calls rather than queueing a 2-second-old paragraph behind a "BRAKE!".
- **Complementing Gemini (hot path for safety)** — For sub-50ms safety calls (BRAKE, OVERSTEER_RECOVERY), heuristic rules fire directly alongside Gemini's slower cold-path work; a 2–5s round trip is unacceptable on those. Gemini continues to own cold-path multi-frame analysis and feedforward corner enrichment on its own cadence.

Put another way: **Gemini is the voice; data reasoning is the judgment about what's worth saying, to whom, and when.** They work as a single coach — "800ms late is worse than silence," so the layer exists to make sure Gemini arrives at the driver's ear at the right moment with the right message.

### Coach Personas

Five AI personas with different communication styles. Switch mid-session.

| Coach | Style | Example |
|-------|-------|---------|
| **Tony** | Motivational | "Commit! Trust the grip!" |
| **Rachel** | Technical | "Trail off brake before turn-in. Balance the platform." |
| **AJ** | Direct | "Brake 5m later." |
| **Garmin** | Data | "Entry speed: -8 mph vs ideal. +0.3s potential." |
| **Super AJ** | Adaptive | Switches style per error type |

---

## Onboarding

### Prerequisites

- Node.js 20+
- Python 3.10+
- A [Gemini API key](https://aistudio.google.com/apikey) (optional, hot path works without it)

> **Note:** The original lab used `gemini-2.0-flash` which is now deprecated ([deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations)). Updated to `gemini-2.5-flash-lite` for cold path and analysis.

### 1. Start the Telemetry Server

```bash
cd streaming-telemetry-server
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python ingest.py --mock
```

The server starts at `http://localhost:8000`. The `--mock` flag replays `SampleStream2024.csv` (Sonoma Raceway data) at 10Hz over SSE.

For live GPS hardware (VK-162 USB dongle):

```bash
python ingest.py --port /dev/tty.usbserial-XXXX --baud 9600
```

### 2. Start the Web Application

```bash
cd koru-application
npm install
npm run dev
```

Open `http://localhost:5173`. Click **Open Dashboard** to enter the app.

### 3. Configure Gemini (optional)

Click the gear icon in the navbar and paste your Gemini API key. This enables:
- Cold path cloud coaching (Gemini Flash)
- Post-session AI lap comparison
- Gemini TTS voice output

The hot path and feedforward path work without an API key.

### 4. Run a Session

| Mode | Steps |
|------|-------|
| **Live** | Go to Live > paste SSE endpoint (`http://localhost:8000/events`) > pick a coach > drive |
| **Replay** | Go to Replay > upload a CSV from your datalogger > scrub with synced charts |
| **Analysis** | Go to Analysis > upload two CSVs > click Compare Laps for sector-by-sector AI breakdown |

---

## streaming-telemetry-server

Python FastAPI service that streams GPS telemetry over Server-Sent Events (SSE).

```
streaming-telemetry-server/
  ingest.py              # FastAPI app: SSE broadcast, mock generator, serial reader, NMEA parser
  requirements.txt       # fastapi, uvicorn, sse-starlette, pyserial, pynmea2
  SampleStream2024.csv   # Sonoma Raceway sample data (VBOX format)
  test_nmea_parsing.py   # NMEA parsing tests
  Procfile               # Heroku/Railway deployment
```

### How it works

```
 ┌────────────────┐         ┌──────────────┐         ┌──────────┐
 │ Data Source     │         │   ingest.py  │   SSE   │ Clients  │
 │                 │         │              │ /events │          │
 │ --mock:         │────────►│  Broadcaster │────────►│ Browser  │
 │   CSV at 10Hz   │         │  (pub/sub)   │         │ koru-app │
 │                 │         │              │         │          │
 │ --port:         │────────►│  NMEA Parser │────────►│ Any SSE  │
 │   Serial GPS    │         │  or Binary   │         │ client   │
 └────────────────┘         └──────────────┘         └──────────┘
```

**Modes:**
- `--mock` — Replays `SampleStream2024.csv` as GPSD TPV objects at 10Hz. No hardware needed.
- `--port /dev/ttyXXX --baud 9600` — Reads NMEA sentences from serial GPS (VK-162 tested).
- `--binary` — Experimental binary protocol mode for VBox devices.

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | GET | SSE stream of GPS data (TPV JSON objects) |
| `/state` | GET | Current mock mode status |
| `/mock` | POST | Enable/disable mock data `{"enabled": true}` |

**Environment variables** (`.env`):
- `PORT` — Server port (default: 8000)
- `HOST` — Bind address (default: 0.0.0.0)

---

## koru-application

React + TypeScript + Vite web application for real-time coaching visualization and interaction.

```
koru-application/
  src/
    components/
      CoachPanel.tsx         # Coaching message display and persona selector
      GaugeCluster.tsx       # Speed, throttle, brake, G-force gauges
      Navbar.tsx             # Navigation bar with API key settings
      PlaybackControls.tsx   # Replay scrubber and playback speed
      TelemetryCharts.tsx    # Recharts-based telemetry visualization
      TrackMap.tsx           # Canvas track map with car position
    data/
      trackData.ts           # Thunderhill East track definition (corners, sectors)
    hooks/
      useGeminiCloud.ts      # Gemini API integration hook
      usePredictiveCoaching.ts  # Mistake zone tracking + 8s lookahead
      useTTS.ts              # Text-to-speech hook (Web Speech API + Gemini TTS)
    pages/
      Landing.tsx            # Landing page
      Dashboard.tsx          # Main dashboard
      LiveSession.tsx        # Live telemetry + real-time coaching
      Replay.tsx             # CSV replay with synced charts
      Analysis.tsx           # Two-lap AI comparison
    services/
      audioService.ts        # AudioContext pre-caching + Web Speech API fallback
      coachingService.ts     # Split-brain coaching engine (hot/cold/feedforward)
      geminiService.ts       # Gemini REST API wrapper
      telemetryStreamService.ts  # SSE client, CSV/JSON file replay, virtual sensors
    utils/
      audioUtils.ts          # Audio helper utilities
      coachingKnowledge.ts   # Coach personas, decision matrix, racing physics knowledge
      telemetryParser.ts     # Telemetry data parsing utilities
    types.ts                 # TelemetryFrame, Track, Corner, CoachAction, CoachPersona
```

### Data Flow

```
 SSE/CSV Input
      │
      ▼
 TelemetryStreamService ──► TelemetryFrame
      │
      ├──► GaugeCluster (speed, throttle, brake, G)
      ├──► TelemetryCharts (time-series plots)
      ├──► TrackMap (car position on canvas)
      │
      └──► CoachingService
              │
              ├──► Hot Path ──► immediate CoachAction
              ├──► Feedforward ──► geofence-triggered advice
              └──► Cold Path ──► GeminiService ──► analysis
                                                      │
                                        All paths ────┘
                                             │
                                             ▼
                                      CoachPanel (display)
                                      AudioService (TTS)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS 4 |
| Charts | Recharts |
| AI | Gemini 2.0 Flash via `@google/genai` |
| Audio | Web Speech API + Gemini TTS (`gemini-2.5-pro-preview-tts`) |
| Track rendering | Canvas API |
| Telemetry server | Python FastAPI + SSE |
| GPS parsing | pynmea2 |
| Communication | Server-Sent Events (SSE) |

## License

MIT
