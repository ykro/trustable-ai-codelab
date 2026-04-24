import type { TelemetryFrame, CoachAction, Corner, Track, CoachingDecision, CornerPhase, SessionGoal } from '../types';
import { COACHES, DEFAULT_COACH, DECISION_MATRIX, RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';
import { haversineDistance, isValidGps } from '../utils/geoUtils';
import { CornerPhaseDetector } from './cornerPhaseDetector';
import { TimingGate } from './timingGate';
import { CoachingQueue } from './coachingQueue';
import { DriverModel } from './driverModel';
import { PerformanceTracker } from './performanceTracker';

/** Safety actions that bypass blackout and cooldown */
const SAFETY_ACTIONS: Set<CoachAction> = new Set(['OVERSTEER_RECOVERY', 'BRAKE']);

/** Map actions to priority levels (module-level Map avoids per-call array allocations) */
const ACTION_PRIORITY: Map<string, 0 | 1 | 2 | 3> = new Map([
  ['OVERSTEER_RECOVERY', 0], ['BRAKE', 0],
  ['EARLY_THROTTLE', 1], ['LIFT_MID_CORNER', 1], ['SPIKE_BRAKE', 1],
  ['COGNITIVE_OVERLOAD', 2],
  ['PUSH', 3], ['FULL_THROTTLE', 3], ['MAINTAIN', 3], ['COAST', 3], ['HESITATION', 3],
  ['HUSTLE', 3],
]);

function actionPriority(action: CoachAction): 0 | 1 | 2 | 3 {
  return ACTION_PRIORITY.get(action) ?? 1;
}

type CoachingCallback = (msg: CoachingDecision) => void;

/**
 * Split-brain coaching engine:
 * - HOT: heuristic rules with humanized text (<50ms)
 * - COLD: Gemini Cloud with cooldown (2-5s)
 * - FEEDFORWARD: geofence-based corner advice
 *
 * Now integrated with:
 * - CornerPhaseDetector: knows if driver is mid-corner
 * - TimingGate: enforces blackout during mid-corner/apex, safety bypass
 */
export class CoachingService {
  private coachId: string = DEFAULT_COACH;
  private listeners: CoachingCallback[] = [];
  private lastColdTime = 0;
  private lastHotAction: CoachAction | null = null;
  private lastCorner: Corner | null = null;
  private coldCooldownMs = 15000;
  private apiKey: string | null = null;

  // New modules
  private cornerDetector = new CornerPhaseDetector();
  private timingGate = new TimingGate();
  private coachingQueue = new CoachingQueue();
  private driverModel = new DriverModel();
  private performanceTracker = new PerformanceTracker();
  private currentPhase: CornerPhase = 'STRAIGHT';
  private track: Track | null = null;
  private lastSkillLevel: import('../types').SkillLevel = 'BEGINNER';
  private lastCognitiveCheck = 0;
  private lastHustleCheck = 0;

  // Session goals (Phase 6.2 — populated by pre-race chat or auto-generated).
  // Actions that appear in any active goal's prioritizedActions get promoted
  // one priority tier (e.g. P2 → P1, P3 → P2) so the driver's focus areas
  // surface faster. Rebuilt on every setSessionGoals call.
  private sessionGoals: SessionGoal[] = [];
  private prioritizedActionSet: Set<CoachAction> = new Set();

  // Session progression
  private sessionPhase: 1 | 2 | 3 = 1;
  private static readonly PHASE_SUPPRESSED: Record<number, Set<CoachAction>> = {
    1: new Set(['TRAIL_BRAKE', 'COMMIT', 'ROTATE', 'EARLY_THROTTLE', 'COGNITIVE_OVERLOAD']),
    2: new Set(['COGNITIVE_OVERLOAD']),
    3: new Set([]),
  };

  setCoach(id: string) { this.coachId = id; }
  getCoach() { return COACHES[this.coachId] || COACHES[DEFAULT_COACH]; }
  setApiKey(key: string) { this.apiKey = key; }

  setTrack(track: Track): void {
    this.track = track;
    this.cornerDetector.setTrack(track);
  }

  getTimingState() { return this.timingGate.getState(); }
  getCornerPhase() { return this.currentPhase; }
  getDriverState() { return this.driverModel.getState(); }
  getSessionGoals() { return this.sessionGoals; }
  getPerformanceTracker() { return this.performanceTracker; }

  /** Call when a new lap starts (e.g. from lap detection logic) */
  newLap(): void { this.performanceTracker.newLap(); }

  /**
   * Set session goals (Phase 6.2).
   * Called before session starts — either from pre-race chat UI (Rabimba/UX)
   * or auto-generated from driver profile + track knowledge.
   *
   * Goals bias the hot path: actions listed in any goal's prioritizedActions
   * get a one-tier priority boost at enqueue time (P3→P2, P2→P1). P0 stays P0.
   * Max 3 goals per session (Ross Bentley: "1-3 specific physical changes").
   */
  setSessionGoals(goals: SessionGoal[]): void {
    this.sessionGoals = goals.slice(0, 3);
    this.prioritizedActionSet = new Set(
      this.sessionGoals.flatMap(g => g.prioritizedActions ?? []),
    );
  }

  /** One-tier boost for actions the driver is actively working on. P0 is unchanged. */
  private boostForGoals(action: CoachAction, base: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
    if (base === 0) return 0;
    if (!this.prioritizedActionSet.has(action)) return base;
    return (base - 1) as 0 | 1 | 2 | 3;
  }

  onCoaching(cb: CoachingCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(msg: CoachingDecision) {
    // DEBUG log gated behind Vite env flag — strip the string interpolation cost in prod/field use.
    if (import.meta.env.DEV && import.meta.env.VITE_COACH_DEBUG === 'true') {
      const pri = ['P0', 'P1', 'P2', 'P3'][msg.priority] ?? `P${msg.priority}`;
      console.log(`[COACH] ${pri} ${msg.action ?? msg.path} | ${msg.cornerPhase} | ${msg.text}`);
    }
    this.timingGate.startDelivery();
    this.listeners.forEach(cb => cb(msg));
  }

  /** Called on every telemetry frame */
  processFrame(frame: TelemetryFrame) {
    // Detect corner phase
    const detection = this.cornerDetector.detect(frame);
    this.currentPhase = detection.phase;

    // Track per-corner performance (Phase 6.4)
    const improvement = this.performanceTracker.update(
      frame, this.currentPhase,
      detection.cornerId ?? null, detection.cornerName ?? null,
    );
    if (improvement) this.coachingQueue.enqueue(improvement);

    // Update timing gate with current phase
    this.timingGate.update(this.currentPhase);

    // Update driver model and adapt coaching parameters
    this.driverModel.update(frame);
    this.adaptToSkillLevel();

    // Session progression
    this.updateSessionPhase(frame.time);

    // Run coaching paths (enqueue decisions)
    this.runHotPath(frame);
    this.checkCognitiveOverload(frame);
    this.checkHustle(frame);
    this.runFeedforward(frame);
    void this.runColdPath(frame);

    // Drain queue — deliver highest-priority message if timing allows
    this.drainQueue();
  }

  private drainQueue(): void {
    const decision = this.coachingQueue.dequeue(this.timingGate, this.currentPhase);
    if (decision) {
      this.emit(decision);
    }
  }

  /** Adapt coaching parameters when skill level changes */
  private adaptToSkillLevel(): void {
    const level = this.driverModel.getSkillLevel();
    if (level === this.lastSkillLevel) return;
    if (import.meta.env.DEV && import.meta.env.VITE_COACH_DEBUG === 'true') {
      console.log(`[DRIVER] Skill level changed: ${this.lastSkillLevel} -> ${level}`);
    }
    this.lastSkillLevel = level;

    switch (level) {
      case 'BEGINNER':
        this.timingGate.updateConfig({
          cooldownMs: 3000,
          blackoutPhases: ['MID_CORNER', 'APEX'],
        });
        this.coldCooldownMs = 20000;
        break;
      case 'INTERMEDIATE':
        this.timingGate.updateConfig({
          cooldownMs: 1500,
          blackoutPhases: ['APEX'],
        });
        this.coldCooldownMs = 15000;
        break;
      case 'ADVANCED':
        this.timingGate.updateConfig({
          cooldownMs: 1000,
          blackoutPhases: [],
        });
        this.coldCooldownMs = 10000;
        break;
    }
  }

  /** Update session phase based on frame time and skill level */
  private updateSessionPhase(frameTime: number): void {
    const skill = this.driverModel.getSkillLevel();
    if (skill === 'ADVANCED') { this.sessionPhase = 3; return; }
    if (frameTime > 180) { this.sessionPhase = 3; }
    else if (frameTime > 60) { this.sessionPhase = 2; }
    else { this.sessionPhase = 1; }
  }

  // ── HOT PATH: instant heuristic commands ───────────────

  private runHotPath(frame: TelemetryFrame) {
    // TelemetryFrame is a structural superset of DecisionRule.check's parameter,
    // so we pass it directly — no intermediate object allocation at 25Hz.
    for (const rule of DECISION_MATRIX) {
      if (rule.check(frame)) {
        // Skip neutral actions — continue scanning so a higher-priority rule
        // later in the matrix (e.g., a P0 safety rule) can still fire this frame.
        if (rule.action === 'STABILIZE' || rule.action === 'MAINTAIN') continue;
        // Session progression: suppress advanced actions in early phases
        const suppressed = CoachingService.PHASE_SUPPRESSED[this.sessionPhase];
        if (suppressed?.has(rule.action)) continue;
        // Skip repeats
        if (rule.action === this.lastHotAction) continue;

        const priority = this.boostForGoals(rule.action, actionPriority(rule.action));
        this.lastHotAction = rule.action;

        const decision: CoachingDecision = {
          path: 'hot',
          action: rule.action,
          text: this.humanizeAction(rule.action, frame),
          priority,
          cornerPhase: this.currentPhase,
          timestamp: Date.now(),
        };

        // P0 safety: preempt queue and emit immediately
        if (priority === 0) {
          this.emit(this.coachingQueue.preempt(decision));
        } else {
          this.coachingQueue.enqueue(decision);
        }
        return;
      }
    }
  }

  /** Check driver model for cognitive overload — runs outside decision matrix */
  private checkCognitiveOverload(frame: TelemetryFrame): void {
    // Only check every 10 seconds
    if (frame.time - this.lastCognitiveCheck < 10) return;
    this.lastCognitiveCheck = frame.time;

    const state = this.driverModel.getState();
    if (state.inputSmoothness < 0.3 && state.skillLevel !== 'ADVANCED') {
      this.coachingQueue.enqueue({
        path: 'hot',
        action: 'COGNITIVE_OVERLOAD',
        text: this.humanizeAction('COGNITIVE_OVERLOAD', frame),
        priority: this.boostForGoals('COGNITIVE_OVERLOAD', 2),
        cornerPhase: this.currentPhase,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Detect lazy throttle application on exits (Ross Bentley "hustle zones").
   * Drivers get lazy mid-session — brain says "why go to 100% for 2 seconds?"
   * But that last 10-15% throttle matters for exit speed onto straights.
   * Fires every 8 seconds when on straight/acceleration with throttle 50-92%.
   * Beginner-focused: only fires for BEGINNER skill level.
   */
  private checkHustle(frame: TelemetryFrame): void {
    if (frame.time - this.lastHustleCheck < 8) return;
    if (this.driverModel.getSkillLevel() !== 'BEGINNER') return;

    const onExit = this.currentPhase === 'ACCELERATION' || this.currentPhase === 'STRAIGHT';
    const lazyThrottle = frame.throttle > 50 && frame.throttle < 92;
    const movingFast = frame.speed > 40;
    const lowLateralG = Math.abs(frame.gLat) < 0.3;

    if (onExit && lazyThrottle && movingFast && lowLateralG) {
      this.lastHustleCheck = frame.time;
      this.coachingQueue.enqueue({
        path: 'hot',
        action: 'HUSTLE',
        text: this.humanizeAction('HUSTLE', frame),
        priority: this.boostForGoals('HUSTLE', 3),
        cornerPhase: this.currentPhase,
        timestamp: Date.now(),
      });
    }
  }

  /** Convert action enum to coaching phrase — context-aware and persona-specific */
  private humanizeAction(action: CoachAction, frame: TelemetryFrame): string {
    const skillLevel = this.driverModel.getSkillLevel();

    // Skill-adapted phrases for key actions (override persona for clarity)
    // Beginner phrases: T-Rod feel-based + Ross Bentley trigger phrases
    // Ross Bentley coaching pedagogy: short, actionable, feel-based for beginners
    // "Do this, do this now" — direct commands, no jargon (00:28:56)
    if (skillLevel === 'BEGINNER') {
      switch (action) {
        case 'TRAIL_BRAKE': return 'Hold a little brake as you turn in.';
        case 'BRAKE': return frame.speed > 80 ? 'Brake! Hard initial!' : 'Start braking — squeeze it.';
        case 'THRESHOLD': return 'Harder initial! Squeeze the brakes faster.';
        case 'COMMIT': return 'Commit! Full throttle now — the car can take it.';
        case 'THROTTLE': return 'Gently add gas now.';
        case 'COAST': return 'Pick a pedal — gas or brake. Stay committed!';
        case 'OVERSTEER_RECOVERY': return 'Easy! Straighten the wheel gently!';
        case 'EARLY_THROTTLE': return 'Wait for it... wait... NOW! Full throttle.';
        case 'LIFT_MID_CORNER': return 'Keep a little gas on through the turn — don\'t lift!';
        case 'SPIKE_BRAKE': return 'Smoother on the brakes — squeeze, don\'t stab.';
        case 'COGNITIVE_OVERLOAD': return 'Feeling busy? Just focus on your marks this lap.';
        case 'HESITATION': return 'Trust the car — commit!';
        case 'HUSTLE': return 'Hustle! Squirt the throttle — full send!';
        case 'PUSH': return 'Eyes up! Look further ahead.';
        case 'FULL_THROTTLE': return 'Full throttle — stay flat!';
      }
    }

    if (skillLevel === 'ADVANCED') {
      const advGLat = Math.abs(frame.gLat);
      switch (action) {
        case 'TRAIL_BRAKE': return `Trail off. G-Lat: ${advGLat.toFixed(2)}. Release linearly to apex.`;
        case 'BRAKE': return `Brake. ${frame.speed.toFixed(0)} mph, target ${Math.abs(frame.gLong).toFixed(1)}G decel.`;
        case 'COMMIT': return `Committed. G-Lat: ${advGLat.toFixed(2)}. Hold.`;
        case 'THROTTLE': return `Throttle. ${frame.throttle.toFixed(0)}%. ${advGLat > 0.8 ? 'Progressive.' : 'Extend.'}`;
        case 'COAST': return `Coasting — zero G-vector at ${frame.speed.toFixed(0)} mph. Losing time.`;
        case 'OVERSTEER_RECOVERY': return `Countersteer. G-Lat ${advGLat.toFixed(2)}. Smooth inputs.`;
        case 'EARLY_THROTTLE': return `Early throttle — still ${advGLat.toFixed(2)}G lateral. Delay.`;
        case 'LIFT_MID_CORNER': return `Lift detected mid-corner. Maintenance throttle.`;
        case 'SPIKE_BRAKE': return `Brake spike — ${frame.brake.toFixed(0)}% at ${Math.abs(frame.gLong).toFixed(1)}G. Squeeze, don't stab.`;
        case 'COGNITIVE_OVERLOAD': return 'Reset. Smooth lap, no heroics.';
        case 'HUSTLE': return `Throttle ${frame.throttle.toFixed(0)}% on exit. Commit 100%.`;
      }
    }

    // INTERMEDIATE falls through to existing persona-based logic
    const coach = this.getCoach();
    const speed = frame.speed;
    const gLat = Math.abs(frame.gLat);
    const gLong = frame.gLong;
    const brake = frame.brake;
    const throttle = frame.throttle;

    const fast = speed > 80;
    const med  = speed > 45 && speed <= 80;
    const highBrake  = brake > 70;
    const lightBrake = brake > 0 && brake <= 40;
    const highCornerLoad = gLat > 1.2;
    const highThrottle   = throttle > 70;

    // ── AJ: terse telemetry commands ────────────────────────
    if (coach.id === 'aj') {
      switch (action) {
        case 'OVERSTEER_RECOVERY': return 'Countersteer. Smooth.';
        case 'THRESHOLD':    return highBrake ? 'Max brake. Hold.' : 'More brake. Now.';
        case 'TRAIL_BRAKE':  return highCornerLoad ? 'Trail. Ease.' : 'Trail off. Release.';
        case 'BRAKE':        return fast ? 'Brake hard.' : 'Brake.';
        case 'WAIT':         return 'Hold. Wait.';
        case 'TURN_IN':      return fast ? 'Late turn. Now.' : 'Turn.';
        case 'COMMIT':       return 'Commit. Go.';
        case 'ROTATE':       return highCornerLoad ? 'Rotate. Less wheel.' : 'Rotate.';
        case 'APEX':         return 'Apex. Hit it.';
        case 'THROTTLE':     return 'Throttle. Now.';
        case 'PUSH':         return fast ? 'Flat. Stay flat.' : 'Push. More speed.';
        case 'FULL_THROTTLE':return 'Flat.';
        case 'STABILIZE':    return 'Stabilize.';
        case 'MAINTAIN':     return 'Maintain.';
        case 'COAST':        return 'Pick a pedal.';
        case 'HESITATION': return 'Send it.';
        case 'EARLY_THROTTLE': return 'Too early. Wait.';
        case 'LIFT_MID_CORNER': return 'Don\'t lift. Maintenance throttle.';
        case 'SPIKE_BRAKE': return 'Squeeze. Not stab.';
        case 'COGNITIVE_OVERLOAD': return 'Reset. Smooth lap.';
        case 'HUSTLE': return 'Hustle. Full throttle.';
      }
    }

    // ── Rachel: physics-grounded ─────────────────────────────
    if (coach.id === 'rachel') {
      switch (action) {
        case 'OVERSTEER_RECOVERY': return 'Countersteer gently — the rear has lost grip. Ease off inputs.';
        case 'THRESHOLD':    return highBrake
          ? 'Maximum decel — you\'re saturating the friction circle.'
          : 'More brake pedal — you have front traction available.';
        case 'TRAIL_BRAKE':  return highCornerLoad
          ? 'Trail off the brake — front is loaded, ease the G-vector.'
          : 'Trail brake into the corner — transfer weight to the front axle.';
        case 'BRAKE':        return fast
          ? 'Brake now — shift weight forward, load the fronts.'
          : 'Light brake — set platform balance for the corner.';
        case 'WAIT':         return 'Patience — wait for weight to settle before turning.';
        case 'TURN_IN':      return lightBrake
          ? 'Turn in — you\'re still on brakes, use the understeer to your advantage.'
          : 'Turn in — front is free, commit to the line.';
        case 'COMMIT':       return highCornerLoad
          ? 'Committed — you\'re near the friction limit, maintain the line.'
          : 'Commit to the corner — trust available grip.';
        case 'ROTATE':       return 'Ease the wheel — let yaw momentum rotate the car.';
        case 'APEX':         return 'Clip the apex — tighten the radius, minimum speed point.';
        case 'THROTTLE':     return highCornerLoad
          ? 'Progressive throttle — don\'t overwhelm the rear on exit.'
          : 'Build throttle — shift weight rearward, drive off the corner.';
        case 'PUSH':         return fast
          ? 'You\'re at speed — max longitudinal, full friction circle forward.'
          : 'Straight — extend throttle application, chase the exit.';
        case 'FULL_THROTTLE':return 'Full throttle — max longitudinal G, rear is planted.';
        case 'STABILIZE':    return 'Neutral inputs — let the platform settle.';
        case 'MAINTAIN':     return 'Platform balanced — maintain this G-vector.';
        case 'COAST':        return `Coasting at ${speed.toFixed(0)} mph — no G-vector. Pick a pedal to load the tires.`;
        case 'HESITATION': return 'The friction circle has margin — commit, the data says so.';
        case 'EARLY_THROTTLE': return 'Throttle before exit — you\'re overloading the rear.';
        case 'LIFT_MID_CORNER': return 'Lift mid-corner shifts weight forward — maintain throttle.';
        case 'SPIKE_BRAKE': return 'Brake input too aggressive — the trace should be a ski slope, not a cliff.';
        case 'COGNITIVE_OVERLOAD': return 'Cognitive saturation. Focus on one thing — smoothness.';
        case 'HUSTLE': return `Exit throttle ${frame.throttle.toFixed(0)}% — commit to 100%. Tire load demands it.`;
      }
    }

    // ── Tony: motivational, feel-based ──────────────────────
    if (coach.id === 'tony') {
      switch (action) {
        case 'OVERSTEER_RECOVERY': return 'Easy! Catch it — smooth hands!';
        case 'THRESHOLD':    return highBrake
          ? 'Yes! Hammer those brakes — own the stop!'
          : 'More brake — you\'ve got more stopping left!';
        case 'TRAIL_BRAKE':  return 'Breathe off the brake — feel the car rotate!';
        case 'BRAKE':        return fast
          ? 'Brake! Brake! Brake! Trust the tires!'
          : 'Brake now — set it up clean!';
        case 'WAIT':         return 'Hold it — patience is speed here!';
        case 'TURN_IN':      return 'Turn in — commit, you\'ve got grip!';
        case 'COMMIT':       return highCornerLoad
          ? 'You\'re committed — hold it, trust the car!'
          : 'Commit! Don\'t second-guess yourself!';
        case 'ROTATE':       return 'Let it breathe — feel the rear come around!';
        case 'APEX':         return 'Clip that apex — laser focus!';
        case 'THROTTLE':     return highCornerLoad
          ? 'Careful on the throttle — feed it in!'
          : 'Gas! Get on it — drive off that corner!';
        case 'PUSH':         return fast
          ? `${speed.toFixed(0)} mph and climbing — stay flat, push it!`
          : 'Clear road ahead — push harder, more speed!';
        case 'FULL_THROTTLE':return 'Full send — floor it, don\'t lift!';
        case 'STABILIZE':    return 'Easy — breathe, hold it steady!';
        case 'MAINTAIN':     return 'That\'s it! Keep that pace — you\'re flying!';
        case 'COAST':        return 'Don\'t coast — commit to a pedal, stay sharp!';
        case 'HESITATION': return 'Stop lifting! Trust it — send it!';
        case 'EARLY_THROTTLE': return 'Easy on the gas — wait for the exit!';
        case 'LIFT_MID_CORNER': return 'Don\'t lift! Keep a little gas on!';
        case 'SPIKE_BRAKE': return 'Squeeze those brakes — smooth is fast!';
        case 'COGNITIVE_OVERLOAD': return 'Take a breath — one thing at a time!';
        case 'HUSTLE': return 'Hustle! Squirt the throttle — full send!';
      }
    }

    // ── Garmin: data-focused, clinical numbers ───────────────
    if (coach.id === 'garmin') {
      switch (action) {
        case 'OVERSTEER_RECOVERY': return `Oversteer detected. G-Lat: ${gLat.toFixed(2)}. Countersteer.`;
        case 'THRESHOLD':    return highBrake
          ? `${brake.toFixed(0)}% brake — holding threshold. Maintain.`
          : `${brake.toFixed(0)}% brake — ${(100 - brake).toFixed(0)}% capacity unused. Apply more.`;
        case 'TRAIL_BRAKE':  return `Trail braking. G-Long: ${gLong.toFixed(2)}. Release linearly.`;
        case 'BRAKE':        return fast
          ? `Brake point. ${speed.toFixed(0)} mph — target -${Math.abs(gLong).toFixed(1)}G decel.`
          : `Brake. Entry speed ${speed.toFixed(0)} mph.`;
        case 'WAIT':         return 'Patience zone. Hold position. Delta neutral.';
        case 'TURN_IN':      return `Turn-in. Speed: ${speed.toFixed(0)} mph. G-Lat target: 1.2+.`;
        case 'COMMIT':       return `Committed. G-Lat: ${frame.gLat.toFixed(2)}. Hold the line.`;
        case 'ROTATE':       return `Rotation phase. Yaw in progress. Reduce steering input.`;
        case 'APEX':         return `Apex. Minimum speed: ${speed.toFixed(0)} mph. Begin exit.`;
        case 'THROTTLE':     return highCornerLoad
          ? `Throttle — ${throttle.toFixed(0)}%. G-Lat ${gLat.toFixed(2)} — progressive only.`
          : `Throttle. ${throttle.toFixed(0)}% — room to extend.`;
        case 'PUSH':         return `Straight. ${speed.toFixed(0)} mph — +${(0.3 + (90 - Math.min(speed, 90)) * 0.01).toFixed(1)}s potential. Stay flat.`;
        case 'FULL_THROTTLE':return `Full throttle. G-Long: ${gLong.toFixed(2)}. Max longitudinal.`;
        case 'STABILIZE':    return 'Inputs neutral. G-forces stabilizing.';
        case 'MAINTAIN':     return `On delta. ${speed.toFixed(0)} mph. Maintain.`;
        case 'COAST':        return `Coasting — ${speed.toFixed(0)} mph. Zero G-vector. Losing time.`;
        case 'HESITATION': return `G-Lat headroom: ${(2.0 - gLat).toFixed(1)}G unused. Commit.`;
        case 'EARLY_THROTTLE': return `Early throttle. G-Lat: ${gLat.toFixed(2)}. Delay to exit.`;
        case 'LIFT_MID_CORNER': return `Lift detected. G-Lat: ${gLat.toFixed(2)}. Maintain 10-20% throttle.`;
        case 'SPIKE_BRAKE': return `Brake spike: ${brake.toFixed(0)}% at ${Math.abs(gLong).toFixed(1)}G. Modulate.`;
        case 'COGNITIVE_OVERLOAD': return 'Input variance high. Simplify.';
        case 'HUSTLE': return `Exit throttle: ${frame.throttle.toFixed(0)}%. Target: 100%. Commit.`;
      }
    }

    // ── Super AJ: adaptive, hobby-driver-friendly ────────────
    switch (action) {
      case 'OVERSTEER_RECOVERY': return 'Catch the slide! Countersteer gently and ease off!';
      case 'THRESHOLD':    return highBrake
        ? 'Good — keep that brake pressure!'
        : 'Squeeze harder on the brakes — you\'ve got more stopping power!';
      case 'TRAIL_BRAKE':  return fast
        ? 'Release the brake slowly as you turn — don\'t let go all at once!'
        : 'Ease off the brake as you turn in — balance the car.';
      case 'BRAKE':        return fast
        ? 'Brake now — you\'re carrying too much speed!'
        : 'Start braking — set up the corner entry.';
      case 'WAIT':         return 'Be patient — wait for the car to settle before turning!';
      case 'TURN_IN':      return lightBrake
        ? 'Turn in while trailing the brake — use that front grip!'
        : 'Turn in now — commit to the line!';
      case 'COMMIT':       return highCornerLoad
        ? 'Stay committed — you\'re on the limit, hold it!'
        : 'Trust the car — commit to the corner!';
      case 'ROTATE':       return 'Less steering, more patience — let the car rotate naturally.';
      case 'APEX':         return med
        ? 'Hit that apex tight — clip it!'
        : 'Apex — get close to the inside!';
      case 'THROTTLE':     return highCornerLoad
        ? 'Feed in the throttle gently — don\'t overwhelm the rear!'
        : 'Get on the gas — drive off the corner!';
      case 'PUSH':         return fast
        ? `${speed.toFixed(0)} mph — stay flat, don't lift!`
        : 'Nice straight — push it harder!';
      case 'FULL_THROTTLE':return 'Floor it — full throttle now!';
      case 'STABILIZE':    return 'Smooth inputs — hold it steady.';
      case 'MAINTAIN':     return 'Looking good — keep that pace!';
      case 'COAST':        return `Coasting at ${speed.toFixed(0)} mph — pick a pedal, stay committed!`;
      case 'HESITATION': return highThrottle
        ? 'You\'re on throttle — now commit fully, don\'t lift!'
        : 'Stop hesitating — trust the grip and send it!';
      case 'EARLY_THROTTLE': return 'Wait for the exit before getting on the gas!';
      case 'LIFT_MID_CORNER': return 'Don\'t lift mid-corner — keep a bit of throttle!';
      case 'SPIKE_BRAKE': return 'Easy on the brakes — squeeze, don\'t slam!';
      case 'COGNITIVE_OVERLOAD': return 'Slow down mentally — focus on smooth inputs.';
      case 'HUSTLE': return 'Hustle! Get on that throttle — full commit!';
    }

    return action;
  }

  // ── COLD PATH: Gemini Cloud detailed analysis ──────────

  private async runColdPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastColdTime < this.coldCooldownMs) return;
    if (!this.apiKey) return;

    // Set before await to prevent hammering a slow endpoint while one call is in flight.
    // On fetch failure we reset to 0 below so offline → back-online recovers quickly
    // instead of silently burning a 15–20s window per failure.
    this.lastColdTime = now;
    const coach = this.getCoach();

    const cornerName = this.lastCorner?.name || 'straight';
    const cornerAdvice = this.lastCorner?.advice || '';

    const skillLevel = this.driverModel.getSkillLevel();
    let instruction: string;
    switch (skillLevel) {
      case 'BEGINNER':
        instruction = 'Give ONE simple instruction using feel-based language. No jargon. Under 10 words. Sound like a patient driving instructor.';
        break;
      case 'ADVANCED':
        instruction = 'Give a data-driven analysis referencing the telemetry numbers. Be concise. Under 15 words.';
        break;
      default:
        instruction = 'Give a technique instruction with a brief physics explanation. Under 20 words.';
    }

    const prompt = `${coach.systemPrompt}

${RACING_PHYSICS_KNOWLEDGE}

Current Telemetry:
Speed: ${frame.speed.toFixed(1)} mph | Brake: ${frame.brake.toFixed(0)}% | Throttle: ${frame.throttle.toFixed(0)}%
G-Lat: ${frame.gLat.toFixed(2)} | G-Long: ${frame.gLong.toFixed(2)}
Location: ${cornerName} - ${cornerAdvice}

${instruction}`;

    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey!,
          },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!res.ok) {
        // Don't penalize the driver for a one-off 5xx — retry on the next frame.
        this.lastColdTime = 0;
        return;
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) this.coachingQueue.enqueue({
        path: 'cold',
        text,
        priority: 2,
        cornerPhase: this.currentPhase,
        timestamp: Date.now(),
      });
    } catch (err) {
      // Network failure (common offline at the track) — retry on the next frame.
      this.lastColdTime = 0;
      console.error('Cold path failed:', err);
    }
  }

  // ── FEEDFORWARD: geofence-based corner advice ──────────

  private runFeedforward(frame: TelemetryFrame) {
    if (!this.track) return;
    if (!isValidGps(frame.latitude, frame.longitude)) return;
    const nearest = this.findNearestCorner(frame.latitude, frame.longitude, this.track.corners);

    if (nearest && nearest !== this.lastCorner) {
      this.lastCorner = nearest;
      this.coachingQueue.enqueue({
        path: 'feedforward',
        text: `${nearest.name}: ${nearest.advice}`,
        priority: 1,
        cornerPhase: this.currentPhase,
        timestamp: Date.now(),
      });
    }
  }

  private findNearestCorner(lat: number, lon: number, corners: Corner[]): Corner | null {
    for (const c of corners) {
      const dist = haversineDistance(lat, lon, c.lat, c.lon);
      if (dist < 150) return c;
    }
    return null;
  }
}
