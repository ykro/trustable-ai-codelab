// ── Telemetry ──────────────────────────────────────────────

export interface TelemetryFrame {
  time: number;          // seconds from session start
  latitude: number;
  longitude: number;
  altitude?: number;
  speed: number;         // mph
  rpm?: number;
  throttle: number;      // 0-100
  brake: number;         // 0-100
  steering?: number;     // degrees
  gLat: number;          // lateral G
  gLong: number;         // longitudinal G
  gear?: number;
  distance?: number;     // cumulative meters
}

export interface GpsSSEPoint {
  time: string | number;
  lat: number;
  lon: number;
  alt?: number;
  speed: number;         // m/s or mph
  climb?: number;
  track?: number;        // heading
  mode?: number;
  brake?: number;
  throttle?: number;
  rpm?: number;
  gear?: number;
  steering?: number;
  gLat?: number;
  gLong?: number;
}

// ── Track ──────────────────────────────────────────────────

export interface Corner {
  id: number;
  name: string;
  entryDist: number;
  apexDist: number;
  exitDist: number;
  lat: number;
  lon: number;
  advice: string;
  entryLat?: number;
  entryLon?: number;
  targetSpeed?: number;    // safe entry speed (mph)
}

export interface Sector {
  id: number;
  name: string;
  startDist: number;
  endDist: number;
}

export interface Track {
  name: string;
  length: number;        // meters
  sectors: Sector[];
  corners: Corner[];
  mapPoints: { x: number; y: number }[];
  recordLap: number;     // seconds
  center?: { lat: number; lng: number };
  zoom?: number;
}

// ── Lap & Session ──────────────────────────────────────────

export interface Lap {
  id: string;
  lapNumber: number;
  time: number;          // total seconds
  valid: boolean;
  frames: TelemetryFrame[];
  sectors: number[];     // sector times
  isComplete: boolean;
}

export interface Session {
  id: string;
  trackName: string;
  date: string;
  laps: Lap[];
  bestLapId: string;
  weather: 'Sunny' | 'Cloudy' | 'Rain';
  trackTemp: number;
}

// ── Coaching ───────────────────────────────────────────────

export interface CoachPersona {
  id: string;
  name: string;
  style: string;
  systemPrompt: string;
  icon: string;
}

export type CoachAction =
  | 'THRESHOLD' | 'TRAIL_BRAKE' | 'BRAKE' | 'WAIT'
  | 'TURN_IN' | 'COMMIT' | 'ROTATE' | 'APEX'
  | 'THROTTLE' | 'PUSH' | 'FULL_THROTTLE'
  | 'STABILIZE' | 'MAINTAIN' | 'COAST'
  | 'HESITATION' | 'OVERSTEER_RECOVERY'
  | 'EARLY_THROTTLE' | 'LIFT_MID_CORNER' | 'SPIKE_BRAKE' | 'COGNITIVE_OVERLOAD'
  | 'HUSTLE';

// ── Session Goals (Phase 6.2) ────────────────────────────

export interface SessionGoal {
  id: string;
  focus: 'braking' | 'throttle' | 'vision' | 'lines' | 'smoothness' | 'custom';
  description: string;            // e.g. "Work on harder initial brake application in Turn 7"
  source: 'pre_race_chat' | 'auto_generated' | 'coach_assigned';
  prioritizedActions?: CoachAction[];  // Hot path rules to boost when this goal is active
}

// ── Cross-Session Driver Profile (Phase 6.3) ─────────────
// Persistence layer owned by AGY Pipeline.
// Data Reasoning defines the interface and implements read/write logic.

export interface CornerPerformance {
  cornerId: number;
  cornerName: string;
  minSpeed: number;
  brakePoint: number;         // distance from corner entry where braking started
  throttleApplication: number; // avg throttle % on exit
  issueCount: number;          // how many coaching messages fired here
}

export interface SessionSummary {
  sessionId: string;
  date: string;
  trackName: string;
  totalLaps: number;
  bestLapTime: number;
  avgLapTime: number;
  skillLevel: SkillLevel;
  cornerPerformance: CornerPerformance[];
  goalsAchieved: string[];     // SessionGoal IDs that were met
}

export interface DriverProfile {
  driverId: string;
  currentSkillLevel: SkillLevel;
  sessions: SessionSummary[];
  problemCorners: number[];     // Corner IDs that consistently cause issues
  strengths: CoachAction[];     // Actions driver rarely triggers (doing well)
  weaknesses: CoachAction[];    // Actions driver frequently triggers (needs work)
}

/**
 * Interface that AGY Pipeline must implement for cross-session persistence.
 * Data Reasoning calls these methods; AGY Pipeline provides the storage backend
 * (IndexedDB, localStorage, or cloud sync).
 */
export interface DriverProfileStore {
  load(driverId: string): Promise<DriverProfile | null>;
  save(profile: DriverProfile): Promise<void>;
  addSession(driverId: string, summary: SessionSummary): Promise<void>;
}

// ── Corner Phase & Timing ─────────────────────────────────

export type CornerPhase =
  | 'STRAIGHT' | 'BRAKE_ZONE' | 'TURN_IN'
  | 'MID_CORNER' | 'APEX' | 'EXIT' | 'ACCELERATION';

export type TimingState = 'OPEN' | 'DELIVERING' | 'COOLDOWN' | 'BLACKOUT';

export interface CoachingDecision {
  path: 'hot' | 'cold' | 'feedforward';
  action?: CoachAction;
  text: string;
  priority: 0 | 1 | 2 | 3;
  cornerPhase: CornerPhase;
  timestamp: number;
}

// ── Driver Model ──────────────────────────────────────────

export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface DriverState {
  skillLevel: SkillLevel;
  cognitiveLoad: number;       // 0-1
  inputSmoothness: number;     // 0-1 (1 = perfectly smooth)
  coastingRatio: number;       // 0-1 (fraction of recent frames coasting)
}

export type SSEConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type TTSProvider = 'browser' | 'gemini';

export type CloudModel = 'flash' | 'pro';
