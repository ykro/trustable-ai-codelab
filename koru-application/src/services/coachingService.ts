import type { TelemetryFrame, CoachAction, Corner } from '../types';
import { COACHES, DEFAULT_COACH, DECISION_MATRIX, RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';
import { THUNDERHILL_EAST } from '../data/trackData';

type CoachingCallback = (msg: { path: 'hot' | 'cold' | 'feedforward'; action?: CoachAction; text: string }) => void;

/**
 * Split-brain coaching engine:
 * - HOT: heuristic rules with humanized text (<50ms)
 * - COLD: Gemini Cloud with cooldown (2-5s)
 * - FEEDFORWARD: geofence-based corner advice
 */
export class CoachingService {
  private coachId: string = DEFAULT_COACH;
  private listeners: CoachingCallback[] = [];
  private lastColdTime = 0;
  private lastHotAction: CoachAction | null = null;
  private lastHotTime = 0;
  private lastCorner: Corner | null = null;
  private coldCooldownMs = 15000;
  private hotCooldownMs = 1500;
  private apiKey: string | null = null;

  setCoach(id: string) { this.coachId = id; }
  getCoach() { return COACHES[this.coachId] || COACHES[DEFAULT_COACH]; }
  setApiKey(key: string) { this.apiKey = key; }
  onCoaching(cb: CoachingCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(msg: Parameters<CoachingCallback>[0]) {
    this.listeners.forEach(cb => cb(msg));
  }

  /** Called on every telemetry frame */
  processFrame(frame: TelemetryFrame) {
    this.runHotPath(frame);
    this.runFeedforward(frame);
    this.runColdPath(frame);
  }

  // ── HOT PATH: instant heuristic commands ───────────────

  private runHotPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastHotTime < this.hotCooldownMs) return;

    const data = {
      brake: frame.brake,
      throttle: frame.throttle,
      gLat: frame.gLat,
      gLong: frame.gLong,
      speed: frame.speed,
    };

    for (const rule of DECISION_MATRIX) {
      if (rule.check(data)) {
        // Skip neutral actions
        if (rule.action === 'STABILIZE' || rule.action === 'MAINTAIN') return;
        // Skip repeats
        if (rule.action === this.lastHotAction) return;

        this.lastHotAction = rule.action;
        this.lastHotTime = now;

        // Humanize action name for display and TTS (e.g. TRAIL_BRAKE → "Trail brake")
        const text = this.humanizeAction(rule.action);
        this.emit({ path: 'hot', action: rule.action, text });
        return;
      }
    }
  }

  /** Convert action enum to hobby-driver-friendly coaching phrase */
  private humanizeAction(action: CoachAction): string {
    const phrases: Record<CoachAction, string> = {
      THRESHOLD:    'Squeeze the brakes hard!',
      TRAIL_BRAKE:  'Ease off the brake as you turn in',
      BRAKE:        'Brake now!',
      WAIT:         'Be patient — wait for it',
      TURN_IN:      'Turn in now!',
      COMMIT:       'Trust the car — commit to the corner!',
      ROTATE:       'Let the car rotate — less steering, more patience',
      APEX:         'Hit that apex!',
      THROTTLE:     'Get on the gas!',
      PUSH:         'Nice straight — push it!',
      FULL_THROTTLE:'Floor it — full throttle!',
      STABILIZE:    'Hold it steady',
      MAINTAIN:     'Looking good — keep it up!',
      COAST:        "You're coasting — pick a pedal!",
      DONT_BE_A_WUSS: "Don't be a wuss — send it!",
    };
    return phrases[action] ?? action;
  }

  // ── COLD PATH: Gemini Cloud detailed analysis ──────────

  private async runColdPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastColdTime < this.coldCooldownMs) return;
    if (!this.apiKey) return;

    this.lastColdTime = now;
    const coach = this.getCoach();

    const cornerName = this.lastCorner?.name || 'straight';
    const cornerAdvice = this.lastCorner?.advice || '';

    const prompt = `${coach.systemPrompt}

${RACING_PHYSICS_KNOWLEDGE}

Current Telemetry:
Speed: ${frame.speed.toFixed(1)} mph | Brake: ${frame.brake.toFixed(0)}% | Throttle: ${frame.throttle.toFixed(0)}%
G-Lat: ${frame.gLat.toFixed(2)} | G-Long: ${frame.gLong.toFixed(2)}
Location: ${cornerName} - ${cornerAdvice}

Give a short coaching instruction followed by a brief physics-based explanation.`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!res.ok) return;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) this.emit({ path: 'cold', text });
    } catch (err) {
      console.error('Cold path failed:', err);
    }
  }

  // ── FEEDFORWARD: geofence-based corner advice ──────────

  private runFeedforward(frame: TelemetryFrame) {
    const track = THUNDERHILL_EAST;
    const nearest = this.findNearestCorner(frame.latitude, frame.longitude, track.corners);

    if (nearest && nearest !== this.lastCorner) {
      this.lastCorner = nearest;
      this.emit({
        path: 'feedforward',
        text: `📍 ${nearest.name}: ${nearest.advice}`,
      });
    }
  }

  private findNearestCorner(lat: number, lon: number, corners: Corner[]): Corner | null {
    for (const c of corners) {
      const dist = this.haversine(lat, lon, c.lat, c.lon);
      if (dist < 150) return c;
    }
    return null;
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
