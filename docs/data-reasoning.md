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
| P3 | Encouragement | PUSH, FULL_THROTTLE, DONT_BE_A_WUSS |

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

7 Ross Bentley mental models, track-agnostic:
1. Friction Circle (clock metaphor)
2. Weight Transfer (seesaw metaphor)
3. Trail Braking (handoff metaphor)
4. Vision Drives the Car
5. Maintenance Throttle
6. Slow In, Fast Out
7. One Thing at a Time (cognitive load)

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
| DONT_BE_A_WUSS | Heavy braking at low speed or lifting too early | P3 |
| FULL_THROTTLE | Straight with good speed | P3 |
| **EARLY_THROTTLE** | Throttle before corner exit with lateral G | P1 |
| **LIFT_MID_CORNER** | Zero throttle mid-corner (destabilizes car) | P1 |
| **SPIKE_BRAKE** | Brake too aggressively (>70%, >1.2G decel) | P1 |

Bold = new in Phase 5.

#### Skill-Adapted Humanization

Each coaching action produces different text based on skill level:

| Action | Beginner | Advanced |
|--------|----------|----------|
| TRAIL_BRAKE | "Hold a little brake as you turn in." | "Trail off. G-Lat: 0.85. Release linearly to apex." |
| COAST | "Pick a pedal — gas or brake, don't coast." | "Coasting — zero G-vector at 72 mph. Losing time." |
| SPIKE_BRAKE | "Squeeze the brakes — don't stomp!" | "Brake spike — 85% at 1.3G. Squeeze, don't stab." |

Intermediate drivers get persona-specific phrases (AJ, Rachel, Tony, Garmin, Super AJ).

### Session Progression

**File:** `src/services/coachingService.ts` (integrated)

Three phases that gradually introduce complexity:

| Phase | When | Suppressed Actions |
|-------|------|--------------------|
| Phase 1 (warm-up) | First 600 frames | TRAIL_BRAKE, COMMIT, ROTATE, EARLY_THROTTLE, COGNITIVE_OVERLOAD |
| Phase 2 (building) | 600-1800 frames | COGNITIVE_OVERLOAD |
| Phase 3 (full) | After 1800 frames | None |

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

This runs `vitest run` and executes all 42 tests across 7 test files:

```
 Test Files  7 passed (7)
      Tests  42 passed (42)
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
| `src/__tests__/sonomaReplay.test.ts` | **Integration:** CSV parse → phase detect → coaching | 4 |

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
```
