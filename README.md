# Trustable AI Race Coach

Today's best telemetry systems — including the SOTA Garmin Catalyst — run on fixed, deterministic rules. They tell you what went wrong after the fact, with numbers. This project takes a different approach: a multimodal, agentic AI system built on Google's latest stack (Gemma 4 edge + Gemini 3 cloud + Vertex AI) that processes real-time data streams to deliver context-aware coaching as it happens, adapted to driver skill level.

The goal is to build a reference architecture that proves a split-brain AI can be trusted in a mission-critical, zero-latency environment — the kind where you're approaching a wall at 130 mph. The patterns and learnings from high-frequency racing telemetry are designed to translate to broader enterprise domains where real-time AI decision-making under pressure is the challenge.

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

- [ ] **Timing state machine** — Replace the simple cooldown (`if now - lastTime < 1500ms return`) with a state machine (OPEN → DELIVERING → COOLDOWN → BLACKOUT). Enforce silence during mid-corner and apex phases to prevent cognitive overload. This is a safety feature.
- [ ] **Priority queue** — Ensure safety-critical messages (BRAKE, OVERSTEER_RECOVERY) always preempt lower-priority coaching (technique tips, compliments). Currently all messages share the same cooldown with no priority ranking.
- [ ] **Driver model** — Classify driver skill from telemetry signals (input smoothness, lap time consistency, brake point variance) and adjust coaching thresholds per skill level. Currently the system coaches all drivers identically.
- [ ] **Automate coaching validation** — The Replay page already parses CSV and runs frames through the coaching engine (hot/cold/feedforward). Build automated tests that replay Sonoma CSV files and assert coaching rules trigger at the correct corners and moments.

### Edge / Telemetry

- [ ] **Understand hardware and data sources** — Document exactly what the Racelogic Mini (20Hz GPS) and OBDLink MX (CAN bus) provide on the Pixel 10. Map which TelemetryFrame fields come from hardware vs which are derived by telemetryStreamService (virtual brake/throttle from G-forces, heading from lat/lon deltas).
- [ ] **Pre-rendered MP3s for safety-critical actions** — Record or source audio clips for BRAKE, OVERSTEER_RECOVERY, COMMIT per coach persona. The audioService already supports AudioContext pre-caching; this needs the actual MP3 files and integration to bypass TTS latency for time-critical calls.
- [ ] **Bluetooth/USB telemetry bridge** — Define how the Pixel 10 receives data from Racelogic Mini and OBDLink MX. Serial? Bluetooth? WiFi direct? This determines the streaming-telemetry-server deployment model (on-device vs separate).

### AGY Pipeline

- [ ] **Define post-session data schema** — Specify what format coaching events and lap metrics should be stored in (Vertex AI, BigQuery, local JSON) so the coaching engine can export session data for analysis and cross-session learning.
- [ ] **Build ingestion for coaching events** — Receive per-corner metrics (brake point, apex speed, exit speed), mistake zones, and coaching decisions from each session. Enable post-session analysis and improvement tracking.

### UX / Frontend

- [ ] **Convert to PWA** — Add service worker and manifest for offline support. The hot path and feedforward already run client-side; PWA ensures the UI loads without network at the track.
- [ ] **Minimal HUD for track use** — Design a signal-light-only visual (green/yellow/red) for in-car use. The driver cannot look at a screen; audio is primary, but a peripheral color signal adds confirmation without distraction.
- [ ] **Coach persona selection UX** — Evaluate whether mid-session coach switching is useful or distracting. Consider recommending a persona based on driver skill level from the driver model.

### Future Work

- [ ] **Cold path offline fallback** — Pre-compute a coaching lookup table for known tracks (keyed by corner + common mistakes) as offline replacement for Gemini cold path. Evaluate on-device Gemma 4 on Pixel 10 as an alternative.
- [ ] **Track auto-detection** — Detect corners on unknown tracks from heading change rate alone, without pre-loaded track data. Enables track-agnostic coaching for any track day.
- [ ] **Corner-specific coaching** — Integrate real coach knowledge (T-Rod session notes, Ross Bentley curriculum) into feedforward path for known tracks. For unknown tracks, determine whether telemetry-only analysis is sufficient or human coaching input is required.
- [ ] **Two-way conversational dialog** — Enable real-time back-and-forth between the driver and the AI coach. This is the pinnacle for advanced drivers, where coaching becomes a discussion about minute nuances, setup adjustments, and driving strategy rather than one-way instructions.

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
       ├──► COLD PATH (Gemini Flash/Pro, 2-5s)
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
- Cold path cloud coaching (Gemini Flash/Pro)
- Post-session AI lap comparison
- Google Cloud TTS voice output

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
      useTTS.ts              # Text-to-speech hook (Web Speech API + Google Cloud TTS)
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
| AI | Gemini Flash/Pro via `@google/genai` |
| Audio | Web Speech API + Google Cloud TTS |
| Track rendering | Canvas API |
| Telemetry server | Python FastAPI + SSE |
| GPS parsing | pynmea2 |
| Communication | Server-Sent Events (SSE) |

## License

MIT
