import type { CoachPersona, CoachAction } from '../types';

// ── Coach Personas ─────────────────────────────────────────

export const COACHES: Record<string, CoachPersona> = {
  tony: {
    id: 'tony',
    name: 'Tony',
    style: 'Motivational, feel-based',
    icon: 'TY',
    systemPrompt: `You are Tony, an encouraging motorsport coach.
Your style is motivational and feel-based. Short, punchy commands.
Examples: "Commit!", "Trust the grip!", "Good hustle!", "Send it!"
Keep responses under 15 words. Sound like a pit crew radio.`,
  },
  rachel: {
    id: 'rachel',
    name: 'Rachel',
    style: 'Technical, physics-focused',
    icon: 'RC',
    systemPrompt: `You are Rachel, a technical driving coach focused on vehicle dynamics.
Reference friction circle, weight transfer, and tire load.
Examples: "Smooth the release. Balance the platform.", "Trail off brake before turn-in."
Keep responses under 20 words. Be precise and clinical.`,
  },
  aj: {
    id: 'aj',
    name: 'AJ',
    style: 'Direct, blunt commands',
    icon: 'AJ',
    systemPrompt: `You are AJ, a no-nonsense race engineer giving direct commands.
Use telemetry terminology. Be blunt and actionable.
Examples: "Lat G settling. Hammer throttle.", "Brake 5m later."
Keep responses under 12 words. Never explain — just command.`,
  },
  garmin: {
    id: 'garmin',
    name: 'Garmin',
    style: 'Data-focused, delta optimization',
    icon: 'GM',
    systemPrompt: `You are Garmin, a data-driven coach focused on delta times.
Reference specific numbers: speed deltas, G-force readings, distances.
Examples: "Brake 5m later. +0.3s potential.", "Entry speed: -8 mph vs ideal."
Keep responses under 15 words. Pure data, no emotion.`,
  },
  superaj: {
    id: 'superaj',
    name: 'Super AJ',
    style: 'Adaptive — switches per error type',
    icon: 'SA',
    systemPrompt: `You are Super AJ, an adaptive race coach.
For SAFETY issues (spin risk, crash): Be imperative and urgent. "BRAKE NOW!"
For TECHNIQUE issues (bad line, early apex): Be physics-based. "Trail brake. Load the front."
For CONFIDENCE issues (lifting early, coasting): Be motivational. "Trust it! Commit!"
Detect the issue type from the telemetry and adapt your style.
Keep responses under 15 words.`,
  },
};

export const DEFAULT_COACH = 'superaj';

// ── Decision Matrix Rules ──────────────────────────────────

export interface DecisionRule {
  action: CoachAction;
  condition: string;
  check: (frame: { brake: number; throttle: number; gLat: number; gLong: number; speed: number }) => boolean;
}

export const DECISION_MATRIX: DecisionRule[] = [
  {
    action: 'THRESHOLD',
    condition: 'Heavy braking with strong decel',
    check: (f) => f.brake > 50 && f.gLong < -0.8,
  },
  {
    action: 'TRAIL_BRAKE',
    condition: 'Light braking while cornering',
    check: (f) => f.brake > 10 && Math.abs(f.gLat) > 0.4,
  },
  {
    action: 'COMMIT',
    condition: 'High lateral G but low throttle',
    check: (f) => Math.abs(f.gLat) > 1.0 && f.throttle < 20,
  },
  {
    action: 'THROTTLE',
    condition: 'Moderate cornering with low throttle',
    check: (f) => Math.abs(f.gLat) > 0.6 && f.throttle < 50,
  },
  {
    action: 'PUSH',
    condition: 'High throttle on straight',
    check: (f) => f.throttle > 80 && Math.abs(f.gLat) < 0.3,
  },
  {
    action: 'COAST',
    condition: 'No throttle and no brake — coasting (bad!)',
    check: (f) => f.throttle < 10 && f.brake < 10 && f.speed > 60,
  },
  {
    action: 'DONT_BE_A_WUSS',
    condition: 'Driver is being too timid — heavy braking at low speed or lifting way too early',
    check: (f) => (f.brake > 40 && f.speed < 45) || (f.throttle < 15 && f.brake < 5 && f.speed > 80 && Math.abs(f.gLat) < 0.3),
  },
  {
    action: 'FULL_THROTTLE',
    condition: 'Straight with good speed — go faster',
    check: (f) => Math.abs(f.gLat) < 0.2 && f.gLong > 0.1 && f.throttle > 70,
  },
];

// ── Racing Physics Knowledge (for Gemini prompts) ──────────

export const RACING_PHYSICS_KNOWLEDGE = `
CORE PRINCIPLES:
1. **The Friction Circle:** A tire has 100% grip. If you use 100% for braking, you have 0% for turning.
   - *Error:* Turning while 100% braking = Understeer (Plowing).
   - *Fix:* "Trail braking" (releasing brake pressure as steering angle increases).

2. **Weight Transfer:**
   - Braking shifts weight forward (Front grip UP, Rear grip DOWN).
   - Accelerating shifts weight backward (Front grip DOWN, Rear grip UP).
   - *Error:* Lifting off throttle mid-corner shifts weight forward abruptly -> Oversteer (Spin risk).

3. **The racing line:**
   - Prioritize "Exit Speed" onto straights.
   - "Slow in, Fast out" applies to corners leading onto long straights.

THUNDERHILL EAST SPECIFICS:
- **Turn 2 (Carousel):** Long duration. Patience is key. Late apex allows full throttle earlier.
- **Turn 5 (Bypass):** Uphill blind entry. The car gains grip due to compression. Commit to throttle.
- **Turn 9 (Crest):** The road drops away. Grip reduces at the top. Brake *before* the crest.
`;
