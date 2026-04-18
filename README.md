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

## Roadmap

### Data Reasoning

- [x] **Timing state machine** — OPEN → DELIVERING → COOLDOWN → BLACKOUT. Enforces silence during mid-corner/apex. P0 safety messages bypass all states. Configurable per skill level.
- [x] **Priority queue** — P0 (safety: BRAKE, OVERSTEER_RECOVERY) preempts all. P1 tactical, P2 strategic, P3 encouragement. Max 5 items, 3s stale expiry.
- [x] **Driver model** — Classifies skill from input smoothness + coasting ratio. Time-based 10s rolling window (robust to 8Hz-25Hz data rates). 5s hysteresis before level change. Adapts cooldown, blackout, and cold path prompts per skill level.
- [x] **Coaching knowledge enrichment** — Ross Bentley mental models (friction circle, weight transfer, trail braking, vision, maintenance throttle). 4 new coaching rules (EARLY_THROTTLE, LIFT_MID_CORNER, SPIKE_BRAKE, COGNITIVE_OVERLOAD). Skill-adapted humanization (beginner: feel-based, advanced: data-driven). Session progression (phases 1-3 suppress advanced techniques early). Skill-aware cold path prompts.
- [x] **Test infrastructure** — Vitest with 42 tests: unit tests for geoUtils, CornerPhaseDetector, TimingGate, CoachingQueue, DriverModel, DecisionMatrix. Sonoma CSV integration test with synthetic fixture.

### Edge / Telemetry

- [ ] **Data fusion and time sync** — Implement cross-correlation calibration (hard throttle blip → RPM spike vs IMU G spike) to align RaceBox GPS epoch timestamps with the browser's monotonic clock (`performance.now()` / the clock used to stamp OBD frames arriving at the PWA). Expected offset: 20-80ms. Upsample OBD channels (5-8Hz) to RaceBox rate (25Hz) via linear interpolation (continuous) and zero-order hold (discrete).
- [ ] **Pre-rendered MP3s for safety-critical actions** — Record or source audio clips for BRAKE, OVERSTEER_RECOVERY, COMMIT per coach persona. The audioService already supports AudioContext pre-caching; this needs the actual MP3 files and integration to bypass TTS latency for time-critical calls.
- [ ] **Bluetooth telemetry bridge** — RaceBox Mini (BLE 5.2, 7.5-15ms latency at high priority) reaches the PWA via Web Bluetooth; OBDLink MX+ (Bluetooth Classic 3.0) is **not** reachable from the browser and requires either a tethered companion process (extending `streaming-telemetry-server`) or its USB interface via WebUSB. Keep-alive under screen lock uses `navigator.wakeLock.request('screen')` plus service worker registration — not native OS service primitives. See [user story ET-7](https://github.com/ykro/trustable-ai-codelab/blob/main/docs/user-stories.md#et-7--resilient-bt-bridge-that-survives-backgrounding) on `main` for the two implementation paths.
- [ ] **VehicleDataStream interface** — Abstract the OBD source behind a common interface so the coaching engine never changes when upgrading from OBD to CAN bus. Path A (OBDLink MX+ K-Line) and Path B (CANable 2.0 direct CAN) both implement the same callbacks.
- [ ] **Mocked data stream API** — Rabimba to deploy a throttled API endpoint providing synthetic telemetry streams. Enables pipeline development before the field test. All teams should validate their ingestion against this endpoint.
- [ ] **CAN-to-USB ingestion (Team 2)** — Team 2 BMW E46 will have direct CAN-to-USB access (decision: Apr 14). Plan software strategy for hardwired CAN ingestion at 100+ Hz, bypassing Bluetooth multiplexing.
- [ ] **Dual Bluetooth stability test (All Teams)** — Test simultaneous streaming from RaceBox Mini (BLE 5.2) and OBD sensors (BT Classic 3.0) to verify connection stability and stack multiplexing on Pixel 10.

### AGY Pipeline

- [ ] **Define post-session data schema** — Specify what format coaching events and lap metrics should be stored in (BigQuery, local JSON, or other) so the coaching engine can export session data for analysis and cross-session learning.
- [ ] **Build ingestion for coaching events** — Receive per-corner metrics (brake point, apex speed, exit speed), mistake zones, and coaching decisions from each session. Enable post-session analysis and improvement tracking.

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

## Hardware Stack

All teams share a common compute and sensor platform. Car-specific adapters vary by team.

### Common Stack (All Teams)

| Device | Role | Connection | Data Rate |
|--------|------|------------|-----------|
| **Pixel 10** | Compute gateway, audio output, edge AI inference | — | — |
| **RaceBox Mini** | 25Hz GPS + IMU (position, speed, heading, lateral/longitudinal G) | BLE 5.2 | 25 Hz, 7.5-15ms latency |
| **OBDLink MX+** | Standard OBD-II adapter (RPM, speed, pedal position, coolant temp) | Bluetooth Classic 3.0 | 5-8 Hz effective |

### Team Cars

| Team | Car | OBD Path | Notes |
|------|-----|----------|-------|
| **Team 1 (Beginner)** | 2024 Subaru GR86 (automatic) | DauntlessOBD Enhanced + Hachi ASC CAN | Full CAN access, 100-500 kbps |
| **Team 2 (Intermediate)** | BMW E46 M3 (MSS54HP) | OBDLink MX+ K-Line (Path A) or CANable 2.0 direct CAN (Path B) | K-Line limited to 10.4 kbaud, 9 channels |
| **Team 3 (Pro)** | Honda S2000 AP2 | MoTec system (separate sync) | Pro data unit handled by T-Rod |

### Data Channel Tiers

Coaching capability scales with available data channels:

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
