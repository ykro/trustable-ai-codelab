# Data Reasoning — Feature Documentation

This document describes the data reasoning layer implemented on the `data-reasoning` branch. These modules sit between raw telemetry ingestion and audio coaching output, making the AI coach context-aware, skill-adaptive, and safe.

## Table of Contents

- [Overview](#overview)
- [Modules](#modules)
  - [Corner Phase Detector](#corner-phase-detector)
  - [Timing Gate](#timing-gate)
  - [Coaching Queue](#coaching-queue)
  - [Driver Model](#driver-model)
  - [Coaching Knowledge](#coaching-knowledge)
  - [Session Progression](#session-progression)
  - [Skill-Adapted Cold Path](#skill-adapted-cold-path)
- [Running Tests](#running-tests)
- [Architecture Diagram](#architecture-diagram)

---

## Overview

The original coaching engine had a simple cooldown (`if now - lastTime < 1500ms, return`) and no awareness of where the driver was on track, what skill level they had, or whether it was safe to speak. The data reasoning layer adds:

| Problem | Solution | Module |
|---------|----------|--------|
| Coaching mid-corner causes cognitive overload | Blackout during apex/mid-corner | TimingGate |
| Safety messages delayed by cooldown | P0 safety bypasses all states | CoachingQueue |
| All drivers coached identically | Skill classification from telemetry | DriverModel |
| Coaching too thin / generic | Ross Bentley mental models, 4 new rules | coachingKnowledge |
| Beginners overwhelmed early in session | Phase 1/2/3 action suppression | Session Progression |
| Cold path (Gemini) gives same prompt to all | Skill-adapted prompt instructions | Cold Path |

---

## Modules

### Corner Phase Detector

**File:** `src/services/cornerPhaseDetector.ts`

Detects what phase of a corner the driver is in: `STRAIGHT`, `BRAKE_ZONE`, `TURN_IN`, `MID_CORNER`, `APEX`, `EXIT`, `ACCELERATION`.

Two modes:
- **GPS primary:** When a `Track` with corner coordinates is loaded, uses haversine distance to entry/apex to classify phase.
- **G-force fallback:** When no track data is available (track-agnostic), uses lateral G, brake, and throttle thresholds.

```
Straight → BRAKE_ZONE → TURN_IN → MID_CORNER → APEX → EXIT → ACCELERATION → Straight
```

### Timing Gate

**File:** `src/services/timingGate.ts`

State machine that controls when coaching messages can be delivered:

```
OPEN → DELIVERING → COOLDOWN → OPEN
  ↓                              ↑
BLACKOUT (mid-corner/apex) ──────┘
```

- P0 (safety) messages bypass COOLDOWN and BLACKOUT
- Cooldown and blackout phases are configurable per skill level
- Beginners: 3s cooldown, blackout during MID_CORNER + APEX
- Advanced: 1s cooldown, no blackout

### Coaching Queue

**File:** `src/services/coachingQueue.ts`

Priority queue for coaching messages:

| Priority | Category | Example Actions |
|----------|----------|----------------|
| P0 | Safety | BRAKE, OVERSTEER_RECOVERY |
| P1 | Tactical | TRAIL_BRAKE, THROTTLE, EARLY_THROTTLE, LIFT_MID_CORNER, SPIKE_BRAKE |
| P2 | Strategic | Gemini cold path analysis, COGNITIVE_OVERLOAD |
| P3 | Encouragement | PUSH, FULL_THROTTLE, HUSTLE, HESITATION |

- Max 5 items, sorted by priority then timestamp
- Messages expire after 3 seconds (stale)
- P0 `preempt()` clears all non-safety messages and delivers immediately

### Driver Model

**File:** `src/services/driverModel.ts`

Classifies driver skill from two telemetry signals:

| Signal | How | Threshold |
|--------|-----|-----------|
| **Input smoothness** | Variance of throttle/brake rate-of-change | < 0.4 = jerky (beginner) |
| **Coasting ratio** | Fraction of frames with throttle < 10% and brake < 10% | > 30% = timid (beginner) |

Classification:
- **BEGINNER:** smoothness < 0.4 OR coasting > 30%
- **ADVANCED:** smoothness > 0.7 AND coasting < 10%
- **INTERMEDIATE:** everything else

Features:
- **Time-based window:** 10-second rolling window (robust to 8Hz OBD and 25Hz RaceBox)
- **5-second hysteresis:** Prevents rapid skill-level oscillation

When skill level changes, the system adapts:
- Timing gate cooldown and blackout phases
- Cold path prompt complexity
- Humanization language (feel-based vs data-driven)

### Coaching Knowledge

**File:** `src/utils/coachingKnowledge.ts`

#### Racing Physics Knowledge (for Gemini prompts)

7 Ross Bentley mental models + 5 T-Rod coaching patterns, all track-agnostic:

**Ross Bentley:**
1. Friction Circle (clock metaphor)
2. Weight Transfer (seesaw metaphor)
3. Trail Braking (handoff metaphor)
4. Vision Drives the Car
5. Maintenance Throttle
6. Slow In, Fast Out
7. One Thing at a Time (cognitive load)

**T-Rod (Tony Rodriguez, real coaching session at Sonoma):**
8. Throttle Commitment — commit 100% at apex
9. Brake Trace Quality — ski slope, not cliff
10. Delay Early Throttle — wait for apex, then commit hard
11. Distance Is King — shorter path beats higher speed in sweepers
12. Session Learning Sequence — lines → shifts → trail braking → throttle

#### Decision Matrix Rules

12 heuristic rules evaluated per frame on the hot path:

| Rule | Condition | Priority |
|------|-----------|----------|
| OVERSTEER_RECOVERY | High lateral G + decel + no throttle | P0 (safety) |
| THRESHOLD | Heavy braking + strong decel | P1 |
| TRAIL_BRAKE | Light braking while cornering | P1 |
| COMMIT | High lateral G + low throttle | P1 |
| THROTTLE | Moderate cornering + low throttle | P1 |
| PUSH | High throttle on straight | P3 |
| COAST | No throttle, no brake, high speed | P1 |
| HESITATION | Driver hesitating — heavy braking at low speed or lifting too early | P3 |
| FULL_THROTTLE | Straight with good speed | P3 |
| **EARLY_THROTTLE** | Throttle before corner exit with lateral G | P1 |
| **LIFT_MID_CORNER** | Zero throttle mid-corner (destabilizes car) | P1 |
| **SPIKE_BRAKE** | Brake too aggressively (>70%, >1.2G decel) | P1 |

Bold = new in Phase 5.

**COGNITIVE_OVERLOAD** is not in the decision matrix — it is emitted directly by `CoachingService.checkCognitiveOverload()` which reads `driverModel.getState().inputSmoothness`. Fires every 10s when smoothness < 0.3 for non-ADVANCED drivers (P2).

#### Skill-Adapted Humanization

Each coaching action produces different text based on skill level:

| Action | Beginner | Advanced |
|--------|----------|----------|
| TRAIL_BRAKE | "Hold a little brake as you turn in." | "Trail off. G-Lat: 0.85. Release linearly to apex." |
| COAST | "Pick a pedal — gas or brake. Stay committed!" | "Coasting — zero G-vector at 72 mph. Losing time." |
| SPIKE_BRAKE | "Smoother on the brakes — squeeze, then slowly release." | "Brake spike — 85% at 1.3G. Squeeze, don't stab." |
| COGNITIVE_OVERLOAD | "Feeling busy? Just focus on your marks this lap." | "Reset. Smooth lap, no heroics." |

Intermediate drivers get persona-specific phrases (AJ, Rachel, Tony, Garmin, Super AJ).

### Session Progression

**File:** `src/services/coachingService.ts` (integrated)

Three phases that gradually introduce complexity:

| Phase | When | Suppressed Actions |
|-------|------|--------------------|
| Phase 1 (warm-up) | First 60 seconds | TRAIL_BRAKE, COMMIT, ROTATE, EARLY_THROTTLE, COGNITIVE_OVERLOAD |
| Phase 2 (building) | 60-180 seconds | COGNITIVE_OVERLOAD |
| Phase 3 (full) | After 180 seconds | None |

Advanced drivers skip directly to Phase 3.

### Skill-Adapted Cold Path

**File:** `src/services/coachingService.ts` → `runColdPath()`

Gemini Flash prompts are adapted per skill level:

| Skill | Prompt Instruction |
|-------|-------------------|
| BEGINNER | "Give ONE simple instruction using feel-based language. No jargon. Under 10 words." |
| INTERMEDIATE | "Give a technique instruction with a brief physics explanation. Under 20 words." |
| ADVANCED | "Give a data-driven analysis referencing the telemetry numbers. Under 15 words." |

---

## Running Tests

### Prerequisites

```bash
cd koru-application
npm install
```

### Run all tests

```bash
npm test
```

This runs `vitest run` and executes all 60 tests across 9 test files:

```
 Test Files  9 passed (9)
      Tests  60 passed (60)
```

### Test files

| File | Module | Tests |
|------|--------|-------|
| `src/utils/__tests__/geoUtils.test.ts` | Haversine, heading, GPS validation | 11 |
| `src/utils/__tests__/decisionMatrix.test.ts` | Decision matrix rules and ordering | 7 |
| `src/services/__tests__/cornerPhaseDetector.test.ts` | G-force fallback + GPS detection | 8 |
| `src/services/__tests__/timingGate.test.ts` | State machine transitions, blackout, cooldown | 4 |
| `src/services/__tests__/coachingQueue.test.ts` | Priority sorting, stale expiry, preempt | 4 |
| `src/services/__tests__/driverModel.test.ts` | Skill classification, smoothness | 3 |
| `src/services/__tests__/performanceTracker.test.ts` | Corner metrics, improvement detection, trends | 8 |
| `src/services/__tests__/coachingServicePhase6.test.ts` | HUSTLE, session goals, Ross Bentley phrases | 10 |
| `src/__tests__/sonomaReplay.test.ts` | **Integration:** CSV parse → phase detect → coaching | 5 |

### Run a specific test file

```bash
npx vitest run src/__tests__/sonomaReplay.test.ts
```

### Run tests in watch mode (during development)

```bash
npx vitest
```

### Integration Test Details

The Sonoma replay integration test (`src/__tests__/sonomaReplay.test.ts`) validates the full pipeline:

1. **CSV parsing** — Reads `src/__tests__/fixtures/sonoma-excerpt.csv` (30 frames: straight → braking → corner → exit) and verifies all fields parse correctly.
2. **G-force phase detection** — Runs frames through CornerPhaseDetector without track data. Verifies braking and cornering phases are detected from G-forces alone.
3. **Coaching action firing** — Creates a CoachingService, feeds all frames, and verifies at least one coaching decision is emitted with correct fields (text, path, priority).
4. **GPS-based corner detection** — Loads Sonoma test track fixture, feeds frames with GPS coordinates near Turn 1, and verifies the detector identifies the corner by ID.

The CSV fixture uses TrackAddict column format (`Speed (MPH)`, `Accel X`, `Accel Y`, `Brake (calculated)`, `Throttle Position (%) *OBD`).

---

## Telemetry Capability Matrix (Degraded Modes)

The data-reasoning layer is built to degrade gracefully when telemetry channels go missing. Field-test reality: BT Classic from the OBDLink MX+ may not reach the PWA in time for May 23 (see `Edge / Telemetry` TODOs on `main`). This table documents what coaching capability exists in each mode.

| Channel set | Available signals | Decision rules that fire | Driver model | Coverage |
|---|---|---|---|---|
| **Full (RaceBox + OBD)** | lat/lon, speed, gLat, gLong, brake %, throttle %, RPM, gear | All 12 rules in `DECISION_MATRIX` + HUSTLE + COGNITIVE_OVERLOAD | Full smoothness + coasting classification (BEG/INT/ADV) | 100% |
| **GPS + IMU only (RaceBox-only fallback)** | lat/lon, speed, gLat, gLong, derived brake/throttle from `telemetryStreamService` G-force estimator | OVERSTEER_RECOVERY, COMMIT, THROTTLE, COAST, PUSH, FULL_THROTTLE, FEEDFORWARD corner advice. Conditional: TRAIL_BRAKE / EARLY_THROTTLE / LIFT_MID_CORNER fire when gLat thresholds match. Excluded: THRESHOLD, SPIKE_BRAKE (need real brake %). | Smoothness/coasting based on synthesized signals — **biased toward BEGINNER classification** because synthetic brake/throttle have low variance | ~60–70% of actions |
| **GPS only (no IMU)** | lat/lon, speed | FEEDFORWARD only (corner geofence advice). No threshold-based hot path. | Cannot classify; defaults to BEGINNER. | ~20% — feedforward only |
| **OBD only (no GPS)** | brake %, throttle %, RPM, gear, speed | THRESHOLD, TRAIL_BRAKE, COMMIT, THROTTLE, PUSH, COAST, HESITATION, FULL_THROTTLE, EARLY_THROTTLE, LIFT_MID_CORNER, SPIKE_BRAKE, COGNITIVE_OVERLOAD. No FEEDFORWARD (no track position), no OVERSTEER_RECOVERY (no gLat). | Full classification possible. | ~80%, but no corner-specific advice |

**Field-test implication:** if BT Classic doesn't ship before May 23, we expect to run in GPS+IMU mode. Roughly 60–70% of coaching actions still fire. The DriverModel will tend to classify as BEGINNER because synthetic brake/throttle from the G-force estimator have low variance — for the Beginner Pod this is the safe default, but it means INTERMEDIATE/ADVANCED classification is effectively unavailable until ET-1 (extended `streaming-telemetry-server`) lands.

**Suggested follow-up for ET-1 (Edge pod):** when the merged telemetry stream lands, it would help to expose a `signals: { brake: 'real' | 'estimated', throttle: 'real' | 'estimated' }` metadata field on each frame, so the DriverModel can opt out of classifying off synthetic signals. Until then, `koru-application/src/services/telemetryStreamService.ts:185-190` keeps the G-force estimator in place as a fallback.

## Cold path design notes (Gemini cloud)

The COLD path is intentionally a small REST call rather than a richer Gemini integration. A few decisions worth flagging:

- **Free-text response, not structured output.** The model's response is consumed by TTS, so structure (JSON schema, function calling) would add round-trip overhead with no parsing benefit downstream.
- **No multi-turn context.** Each frame is a fresh context — session state lives in `DriverModel`, `PerformanceTracker`, and `SessionGoal[]` in-process. Carrying conversation history into the Gemini context window would inflate token cost without observed quality gains, and would couple session state to a remote service that may be unreachable at the track.
- **Static `RACING_PHYSICS_KNOWLEDGE` injected per call.** Roughly 1 KB of curated Ross Bentley + physics reference. Not large enough today to justify a system-instruction or implicit-cache pattern, though both would be reasonable optimizations later.
- **Skill-adapted instruction.** The DriverModel-derived skill level rewrites the user instruction (BEGINNER → "feel-based, under 10 words"; ADVANCED → "data-driven, under 15 words"). This is the part that makes the prompt substantive; the rest is plumbing.
- **Cooldown-gated, not per-frame.** 15s cooldown between calls (20s for BEGINNER) — the COLD path is a strategic narrator, not a real-time reflex. Real-time work belongs to the HOT path and FEEDFORWARD.

What this implementation is *not*: it is not a thin REST wrapper around Gemini that makes Gemini "the AI" of the system. The judgment about *what* to send, *when*, and at *what skill level* lives in the data-reasoning layer; Gemini is the language and voice of the coach, not the policy.

## Architecture Diagram

```
 TelemetryFrame (every 40-100ms)
       │
       ▼
 CornerPhaseDetector ──► CornerPhase (STRAIGHT, BRAKE_ZONE, MID_CORNER, APEX, EXIT...)
       │                        │
       │                        ▼
       │                  TimingGate ──► State (OPEN, DELIVERING, COOLDOWN, BLACKOUT)
       │                        │
       ▼                        │
 DriverModel ──► SkillLevel ────┤──► adapts cooldown, blackout, cold prompt
       │         (BEG/INT/ADV)  │
       │                        │
       ▼                        ▼
 Hot Path (DecisionMatrix) ──► CoachingQueue (P0-P3)
       │                              │
       │  P0 safety ──► preempt() ────┤
       │                              │
       ├── Session Phase Filter       ▼
       │   (suppress advanced     dequeue() ──► TimingGate.canDeliver()
       │    actions early)              │
       │                               ▼
       │                         emit() ──► Listeners (CoachPanel, AudioService)
       │
 Cold Path (Gemini Flash) ──► skill-adapted prompt ──► enqueue P2
       │
 Feedforward (geofence) ──► corner advice ──► enqueue P1
       │
 PerformanceTracker ──► per-corner metrics ──► improvement P3
```

---

## Phase 6: Session Intelligence

### Hustle Detection (5.4 mod)

**File:** `src/services/coachingService.ts` → `checkHustle()`

Ross Bentley insight: drivers get lazy mid-session. The brain says "why go to 100% throttle for 2 seconds?" But that last 10-15% matters for exit speed.

Detects when a beginner driver is on a straight/acceleration zone with throttle between 50-92% (not fully committed). Fires every 8 seconds with P3 encouragement: "Hustle! Squirt the throttle — full send!"

Only fires for BEGINNER skill level — advanced drivers manage throttle commitment intentionally.

### Ross Bentley Trigger Phrases (5.3 mod)

Beginner humanization enriched with Ross Bentley's standardized coaching vocabulary:

| Action | Trigger Phrase | Ross Bentley Source |
|--------|---------------|---------------------|
| BRAKE | "Hard initial!" | Harder initial brake application (01:14:27) |
| SPIKE_BRAKE | "Squeeze, don't stab" | Brake trace quality — ski slope not cliff |
| PUSH | "Eyes up!" | Vision drives the car |
| HUSTLE | "Squirt the throttle!" | Lazy throttle on exits (00:25:31) |
| HESITATION | "Trust the car — commit!" | Self-preservation detection (00:16:05) |

These phrases are short, standardized, and build a common vocabulary between AI coach and driver — exactly the approach Ross used with the Garmin Catalyst team (00:34:09).

### Pre-Session Goal Setting (Phase 6.2)

**File:** `src/types.ts` → `SessionGoal`, `src/services/coachingService.ts` → `setSessionGoals()`

Placeholder for pre-race chat integration. The UX team (Rabimba) builds the chat UI; Data Reasoning consumes the goals.

Ross Bentley: "1-3 specific physical changes per session" (01:23:15). Max 3 goals enforced.

```typescript
interface SessionGoal {
  id: string;
  focus: 'braking' | 'throttle' | 'vision' | 'lines' | 'smoothness' | 'custom';
  description: string;
  source: 'pre_race_chat' | 'auto_generated' | 'coach_assigned';
  prioritizedActions?: CoachAction[];  // Hot path rules to boost
}
```

**TODO:** UX team implements pre-race chat → calls `coachingService.setSessionGoals()`.
**TODO:** Auto-generation from DriverProfile when persistence layer is ready.

### Cross-Session Driver Profile (Phase 6.3)

**File:** `src/types.ts` → `DriverProfile`, `DriverProfileStore`

Interface for persisting driver data across sessions. The persistence layer (IndexedDB/localStorage/cloud) is owned by AGY Pipeline. Data Reasoning defines what to store and how to read/write.

```typescript
interface DriverProfileStore {
  load(driverId: string): Promise<DriverProfile | null>;
  save(profile: DriverProfile): Promise<void>;
  addSession(driverId: string, summary: SessionSummary): Promise<void>;
}
```

Ross Bentley: "The more I learn about the driver, the more effective I get" (00:27:56).

**What gets persisted:**
- Skill level history
- Per-corner performance (min speed, brake point, throttle %)
- Problem corners (consistently trigger coaching messages)
- Session goals and achievement

**Status:** Interfaces defined. Awaiting AGY Pipeline persistence backend.

### In-Session Performance Tracking (Phase 6.4)

**File:** `src/services/performanceTracker.ts`

Tracks per-corner metrics within a single session (no persistence needed):

| Metric | How | Use |
|--------|-----|-----|
| Min speed | Track minimum speed through each corner pass | Detect carrying more speed |
| Entry/exit speed | Speed at corner entry and exit | Detect improvement on exits |
| Max brake | Peak brake percentage per corner | Detect harder initial application |
| Max throttle | Peak throttle per corner | Detect better throttle commitment |

**Lap-over-lap comparison:** When exit speed improves by 2+ mph or min speed by 1+ mph, emits a P3 encouragement: *"Nice improvement! Exit speed up 3 mph!"*

Ross Bentley: "Drivers want to see improvements" — visible progress is a strong motivator.

**Limitations without persistence layer:**
- Can only compare within a session (lap-over-lap)
- Cannot say "Last week you struggled with Turn 7, today you nailed it"
- Cross-session trends require AGY Pipeline persistence (Phase 6.3)
