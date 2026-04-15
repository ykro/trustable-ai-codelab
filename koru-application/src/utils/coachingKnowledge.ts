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
    action: 'OVERSTEER_RECOVERY',
    condition: 'High lateral G with decel and no throttle — loss of rear grip',
    check: (f) => Math.abs(f.gLat) > 0.7 && f.gLong < -0.3 && f.throttle < 5 && f.speed > 40,
  },
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
  {
    action: 'EARLY_THROTTLE',
    condition: 'Throttle applied before corner exit with significant lateral G',
    check: (f) => f.throttle > 30 && Math.abs(f.gLat) > 0.6 && f.gLong < -0.1,
  },
  {
    action: 'LIFT_MID_CORNER',
    condition: 'Sudden lift in corner — zero throttle with lateral G (destabilizes car)',
    check: (f) => f.throttle < 5 && Math.abs(f.gLat) > 0.4 && f.speed > 50,
  },
  {
    action: 'SPIKE_BRAKE',
    condition: 'Braking too aggressively — high brake with forward decel spike',
    check: (f) => f.brake > 70 && f.gLong < -1.2,
  },
];

// ── Racing Physics Knowledge (for Gemini prompts) ──────────

export const RACING_PHYSICS_KNOWLEDGE = `
CORE MENTAL MODELS:

1. **The Friction Circle (Clock Metaphor):**
   Imagine your grip budget as a clock face. 12 o'clock is max braking, 6 is max acceleration,
   3 and 9 are max cornering. You can point the grip vector anywhere on the clock, but you
   cannot go past the edge. Using 100% braking leaves 0% for turning.
   The fastest drivers trace the edge of the circle — braking AND turning simultaneously.
   Beginners drive a cross pattern: brake, stop, turn, stop, accelerate. The circle is faster.
   Real friction circles look like a half-moon — more grip under braking than acceleration
   because brakes are stronger than the engine.

2. **Weight Transfer (Seesaw Metaphor):**
   The car is a seesaw. Brake = nose dips, front tires grip more, rears lighten.
   Throttle = nose rises, rear tires grip more, fronts lighten.
   Transition smoothly — jerking the seesaw causes slides.
   Abrupt lift off throttle mid-corner = weight lurches forward = oversteer (spin risk).
   Smooth inputs keep the seesaw balanced and predictable.

3. **Trail Braking (Handoff Metaphor):**
   You are handing grip from the brakes to the steering. As steering angle increases,
   brake pressure must decrease proportionally. The total grip stays at the circle's edge.
   The brake trace should look like a ski slope — a smooth, gradual release — not a cliff.
   Trail braking keeps weight on the front tires through turn-in, giving maximum front grip
   exactly when you need it most.

4. **Vision Drives the Car:**
   Look where you want to go. Your hands follow your eyes. If you stare at the wall, you
   will hit the wall. Look through the corner to the exit — the car follows your gaze.
   At corner entry, eyes should already be at the apex. At the apex, eyes should already
   be at the exit. Always look one step ahead.

5. **Maintenance Throttle:**
   Between braking and acceleration, use 10-20% throttle to keep the car neutral.
   Zero throttle = weight shifts forward = front grip up, rear grip down = oversteer risk.
   "No pedal" is NOT neutral — it is an input that unsettles the car.
   The fastest mid-corner state is light throttle, not coasting.

6. **Slow In, Fast Out:**
   Prioritize exit speed onto straights. A corner before a long straight demands a late apex
   and strong exit. Carry 2 mph less at entry to gain 5 mph more on the straight.
   The straight is where you make up time, not the corner.

7. **One Thing at a Time (Cognitive Load):**
   A beginner can process one new instruction per lap. An intermediate can handle 2-3.
   An advanced driver can adjust multiple inputs simultaneously.
   More coaching is not better coaching — timing and relevance matter more than volume.
   When in doubt, say less.

REAL COACH PATTERNS (from Tony Rodriguez, pro driving coach):

8. **Throttle Commitment:**
   Beginners think 60% throttle is enough. The torque difference between 60% and 100%
   is only ~20 ft-lbs in a typical car. Half-throttle through a corner is slower AND less
   stable than full commitment. At the apex: commit 100%.

9. **Brake Trace Quality:**
   Look at brake PRESSURE, not the on/off switch. The trace should look like a ski slope —
   smooth taper from peak to zero. Spike-and-release braking means fear and stabbing.
   Squeeze, then slowly release.

10. **Delay Early Throttle:**
    Anytime you think "it's throttle time" — wait. Not until the apex. Early throttle
    pushes the front wide (understeer) and wastes the corner. Wait, then commit HARD.

11. **Distance Is King (Sweepers):**
    In sweeping corners, cutting distance beats carrying speed. 10 feet shorter path at
    60 mph saves more than 2 mph extra on a longer path. Hug the inside.

12. **Session Learning Sequence:**
    Step 1: Lines and marks. Step 2: Shifts and car control. Step 3: Trail braking.
    Step 4: Throttle commitment. One new thing at a time — stacking causes overload.
`;
