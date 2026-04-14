# Trustable AI Race Coach

Today's best telemetry systems — including the SOTA Garmin Catalyst — run on fixed, deterministic rules. They tell you what went wrong after the fact, with numbers. This project takes a different approach: a multimodal, agentic AI system built on Google's latest stack (Gemini Nano on-device + Gemini API) that processes real-time data streams to deliver context-aware coaching as it happens, adapted to driver skill level.

The goal is to build a reference architecture that proves a split-brain AI can be trusted in a mission-critical, zero-latency environment. The patterns and learnings from high-frequency racing telemetry are designed to translate to broader enterprise domains where real-time AI decision-making under pressure is the challenge.

```
Catalyst tells you what you did wrong with numbers.
This system tells you in real time how to adapt and fix it, adjusted to your skill level.
```

## Table of Contents

- [Roadmap](#roadmap)
  - [Data Reasoning](#data-reasoning)
  - [Edge / Telemetry](#edge--telemetry)
  - [AGY Pipeline](#agy-pipeline)
  - [UX / Frontend](#ux--frontend)
  - [Future Work](#future-work)
- [Architecture](#architecture)
  - [Split-Brain Coaching Engine](#split-brain-coaching-engine)
  - [Coach Personas](#coach-personas)
- [Onboarding](#onboarding)
- [streaming-telemetry-server](#streaming-telemetry-server)
- [koru-application](#koru-application)
- [Tech Stack](#tech-stack)

---

## Roadmap

### Data Reasoning

> **Focus: BEGINNER drivers** (Team 1 Beginner Pod). All coaching logic, humanization, and thresholds are tuned for beginner skill level first. The same codebase supports intermediate/advanced via the Driver Model, but the primary target is someone on track for the first time.

See [`docs/data-reasoning.md`](docs/data-reasoning.md) for detailed feature documentation and how to run tests.

**Phase 0-3: Foundation + Core Engine** (implemented on `data-reasoning` branch)
- [x] **Timing state machine** — OPEN → DELIVERING → COOLDOWN → BLACKOUT. P0 safety bypasses blackout. Blackout during MID_CORNER + APEX for beginners.
- [x] **Priority queue** — P0 safety, P1 tactical, P2 strategic, P3 encouragement. Max 5 items, 3s stale expiry, preempt for safety.
- [x] **Driver model** — Skill classification from smoothness + coasting ratio. Time-based 10s window (handles 8Hz OBD + 25Hz RaceBox). 5s hysteresis.
- [x] **Corner phase detection** — GPS primary + G-force fallback (track-agnostic). Equirectangular pre-filter for performance.
- [x] **Foundation types** — CornerPhase, TimingState, CoachingDecision, DriverState, OVERSTEER_RECOVERY, telemetry parser fix for Sonoma CSV.

**Phase 4: Test Infrastructure** (implemented)
- [x] **42 tests across 7 files** — geoUtils, CornerPhaseDetector, TimingGate, CoachingQueue, DriverModel, DecisionMatrix, Sonoma CSV integration.
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
- [ ] **6.1 Message Compression** — paragraph → sentence → trigger phrase progression. First time: full instruction. Repeated: trigger phrase only. Per action+corner tracking within session. (Ross Bentley: trigger phrases are the goal state)
- [x] **6.2 Pre-Session Goal Setting** — Interfaces and placeholders ready. `setSessionGoals()` accepts 1-3 focus areas (Ross Bentley: "1-3 specific physical changes per session"). UX team (Rabimba) builds pre-race chat UI; Data Reasoning consumes the goal output to bias hot path rule priority.
- [x] **6.3 Cross-Session Driver Profile** — `DriverProfile` + `DriverProfileStore` interfaces defined. Tracks skill level, problem corners, strengths/weaknesses across sessions. **Persistence layer (IndexedDB/localStorage) owned by AGY Pipeline; Data Reasoning defines the read/write interface and implements the logic.**
- [x] **6.4 In-Session Improvement Tracking** — `PerformanceTracker` tracks per-corner metrics (min speed, brake point, throttle %) within a session. Lap-over-lap delta emits P3 encouragement on improvement. Cross-session trends require persistence layer (Phase 6.3).

### Edge / Telemetry

**Hardware stack** (confirmed Apr 14 mentorship with Brian Luc):
| Device | Rate | Interface | Data |
|--------|------|-----------|------|
| RaceBox Mini | 25Hz GPS + IMU | BLE 5.2 | lat, lon, speed, gLat, gLong, altitude |
| OBDLink MX+ | 5-8Hz OBD-II | BT Classic 3.0 | throttle, brake, RPM, gear, coolant |
| Pixel 10 | — | USB-C / BT | Runs coaching app, Gemini Nano on-device |

**Team cars:** Team 1 Beginner: 2024 Subaru GR86 (automatic, DauntlessOBD CAN). Team 2: BMW E46 (direct CAN-to-USB, bypassing BT multiplexing).

**Latency budget:** 300-500ms from event to audio. "Feedback 800ms late is worse than silence."

- [x] **Hardware stack documented** — RaceBox Mini 25Hz, OBDLink MX+ 5-8Hz, Pixel 10 pipeline
- [ ] **Mocked data stream API** — Rabimba deploying throttled API endpoint simulating RaceBox+OBD merged stream for pipeline development
- [ ] **Pre-rendered MP3s for safety-critical actions** — Audio clips for BRAKE, OVERSTEER_RECOVERY, COMMIT per persona
- [ ] **Dual BT test** — Validate BLE 5.2 (RaceBox) + BT Classic 3.0 (OBDLink) simultaneous on Pixel 10
- [ ] **CAN-to-USB bridge for Team 2 BMW** — Direct CAN access bypassing BT multiplexing
- [ ] **Steering angle channel** — Requested by Ross Bentley for data analysis (Apr 15 session)

### AGY Pipeline

- [ ] **Define post-session data schema** — Specify what format coaching events and lap metrics should be stored in (BigQuery, local JSON, or other) so the coaching engine can export session data for analysis and cross-session learning.
- [ ] **Build ingestion for coaching events** — Receive per-corner metrics (brake point, apex speed, exit speed), mistake zones, and coaching decisions from each session. Enable post-session analysis and improvement tracking.
- [ ] **Persistence layer for cross-session driver profile** — Implement `DriverProfileStore` interface (defined by Data Reasoning in `src/types.ts`). Storage backend (IndexedDB, localStorage, or cloud sync) that persists `DriverProfile` across sessions. Data Reasoning defines what to store; AGY Pipeline provides the how. See `DriverProfileStore` interface: `load()`, `save()`, `addSession()`.

### UX / Frontend

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
       ├──► COLD PATH (Gemini Flash, 2-5s)
       │    Multi-frame telemetry analysis with physics context.
       │    "You're lifting early in T5 — trust the grip through mid-corner."
       │
       └──► FEEDFORWARD (geofence triggers, 150m before corner)
            Corner-specific advice delivered before the maneuver.
            "T3 right: late apex, brake at the 100m board."
```

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

Open `http://localhost:5175`. Click **Open Dashboard** to enter the app.

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
