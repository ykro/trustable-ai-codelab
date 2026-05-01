import type { TelemetryFrame, CoachAction, Corner, Track, CoachingDecision, CornerPhase, SessionGoal } from '../types';
import { COACHES, DEFAULT_COACH, DECISION_MATRIX, RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';
import { haversineDistance, isValidGps } from '../utils/geoUtils';
import { CornerPhaseDetector } from './cornerPhaseDetector';
import { TimingGate } from './timingGate';
import { CoachingQueue } from './coachingQueue';
import { DriverModel } from './driverModel';
import { PerformanceTracker } from './performanceTracker';
import { buildColdPrompt } from './coldPromptBuilder';

// ── DR-3: Humanization latency budget ─────────────────────
/** If a single humanizeAction call exceeds this, the NEXT hot-path emission
 *  drops humanization and emits the raw action label (e.g. "BRAKE") instead.
 *  Humanization should normally be sub-millisecond — 50ms is a tripwire,
 *  not an expected operating point. */
const HUMANIZATION_BUDGET_MS = 50;

// ── DR-6: Safety-override of humanization ─────────────────
/** Above this speed, BRAKE-class actions bypass humanization and emit a
 *  short authoritative imperative. Frame speed is in mph (see TelemetryFrame). */
const HIGH_SPEED_BRAKE_THRESHOLD_MPH = 70;

/** Actions that are "BRAKE-class" for the high-speed safety override.
 *  Excludes TRAIL_BRAKE: trail braking is a deliberate technique, not an
 *  emergency. Treating it as "Brake hard!" at speed would be coaching the
 *  driver out of a correct input. (Audit B2.) */
const BRAKE_CLASS_ACTIONS: ReadonlySet<CoachAction> = new Set<CoachAction>([
  'BRAKE', 'THRESHOLD', 'SPIKE_BRAKE',
]);

/** Terse, authoritative imperatives for safety-override emissions.
 *  Tone borrowed from Ross Bentley trigger phrases ("Both feet in!" /
 *  "Brake hard!" / "Eyes up!"). Only actions reachable via the override need
 *  entries — anything else falls back to the raw action label. */
const SAFETY_OVERRIDE_TEXT: Partial<Record<CoachAction, string>> = {
  OVERSTEER_RECOVERY: 'Both feet in!',
  BRAKE: 'Brake hard!',
  THRESHOLD: 'Brake hard!',
  SPIKE_BRAKE: 'Brake hard!',
};

/** Map actions to priority levels (module-level Map avoids per-call array allocations).
 *  Safety bypass is determined by `priority === 0` at the call site, not by a separate set. */
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

// ── FEEDFORWARD geofence tunables (DR-1) ───────────────────
// Replace the legacy static 150m radius with a velocity-scaled trigger so
// the lead time the driver gets is constant in *seconds*, not in metres.
// At 100 mph a 150m fence gave only ~3.3s of lead — minus a 1.5s TTS budget
// the driver had ~1.8s of cognitive headroom. Scaling by velocity gives
// FEEDFORWARD_LEAD_S of true thinking time at every speed.
//
//   triggerDistance = max(MIN_TRIGGER_M, v_mps * (FEEDFORWARD_LEAD_S + TTS_BUDGET_S))
export const FEEDFORWARD_LEAD_S = 3.0;
export const TTS_BUDGET_S = 1.5;
export const MIN_TRIGGER_M = 40;
export const MPH_TO_MPS = 0.44704;

/** Velocity-scaled FEEDFORWARD geofence radius (DR-1).
 *  Returns 0 when stationary so the path does not fire at idle. */
export function getTriggerDistance(speedMph: number): number {
  if (!Number.isFinite(speedMph) || speedMph <= 0) return 0;
  const vMps = speedMph * MPH_TO_MPS;
  const scaled = vMps * (FEEDFORWARD_LEAD_S + TTS_BUDGET_S);
  return Math.max(MIN_TRIGGER_M, scaled);
}

/** Build the FEEDFORWARD message text for a corner (DR-5).
 *  When the corner has a `visualReference`, prepend it so the driver is told
 *  where to *look* before being told what to do with the pedals. */
export function buildFeedforwardText(corner: Corner): string {
  if (corner.visualReference && corner.visualReference.trim().length > 0) {
    return `${corner.name}: ${corner.visualReference}. ${corner.advice}`;
  }
  return `${corner.name}: ${corner.advice}`;
}

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
  private lastHustleFire = 0;

  // Recent telemetry window for the COLD prompt builder. ~2s at 25Hz = 50 frames.
  // Keep this small — it's read on every cold call but only the cold path needs it.
  private static readonly COLD_WINDOW_FRAMES = 50;
  private coldFrameWindow: TelemetryFrame[] = [];

  // Session goals (Phase 6.2 — populated by pre-race chat or auto-generated).
  // Actions that appear in any active goal's prioritizedActions get promoted
  // one priority tier (e.g. P2 → P1, P3 → P2) so the driver's focus areas
  // surface faster. Rebuilt on every setSessionGoals call.
  private sessionGoals: SessionGoal[] = [];
  private prioritizedActionSet: Set<CoachAction> = new Set();

  // ── DR-3: Humanization budget tracking ──────────────────
  /** Per-call wall-clock samples; bounded ring buffer to avoid unbounded growth. */
  private humanizationLatencySamples: number[] = [];
  private static readonly LATENCY_SAMPLE_CAP = 2000;
  /** Sticky for ONE emission after a budget breach: next hot-path emission
   *  uses the raw action label, then this resets. Single-frame stickiness keeps
   *  the recovery cheap without permanently degrading coaching quality. */
  private humanizationFallbackArmed = false;
  private humanizationBudgetMs = HUMANIZATION_BUDGET_MS;

  // ── DR-6: Safety-override threshold (configurable) ──────
  private highSpeedBrakeThresholdMph = HIGH_SPEED_BRAKE_THRESHOLD_MPH;

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
    // Drop the stale corner reference so the feedforward path doesn't compare
    // a fresh corner against a stale identity from the previous track.
    this.lastCorner = null;
  }

  getTimingState() { return this.timingGate.getState(); }
  getCornerPhase() { return this.currentPhase; }
  getDriverState() { return this.driverModel.getState(); }
  getSessionGoals() { return this.sessionGoals; }
  getPerformanceTracker() { return this.performanceTracker; }

  // ── DR-3 configuration & telemetry ───────────────────────
  /** Returns the live ring buffer of per-call humanization latencies (ms).
   *  Tests and the latency benchmark use this. Mutating clears history. */
  getHumanizationLatencySamples(): number[] { return this.humanizationLatencySamples; }
  setHumanizationBudgetMs(ms: number): void { this.humanizationBudgetMs = ms; }
  setHighSpeedBrakeThresholdMph(mph: number): void { this.highSpeedBrakeThresholdMph = mph; }

  /**
   * DR-6: Should we bypass humanization and emit a terse safety imperative?
   *  (a) OVERSTEER_RECOVERY — always (high-slip, regardless of speed).
   *  (b) BRAKE-class action AND speed > threshold (panic-brake at speed).
   * Public for unit testing of the predicate in isolation.
   */
  shouldBypassHumanization(action: CoachAction, frame: TelemetryFrame): boolean {
    if (action === 'OVERSTEER_RECOVERY') return true;
    if (BRAKE_CLASS_ACTIONS.has(action) && frame.speed > this.highSpeedBrakeThresholdMph) return true;
    return false;
  }

  /**
   * Wraps humanizeAction with:
   *  - DR-6 safety bypass (returns SAFETY_OVERRIDE_TEXT, no humanization at all)
   *  - DR-3 raw-label fallback (if the previous call breached the budget, return
   *    the raw action label this once and disarm the flag)
   *  - DR-3 latency measurement (records every call that DOES humanize)
   */
  private humanizeOrFallback(action: CoachAction, frame: TelemetryFrame): string {
    // DR-6 takes precedence — the override imperative is the right output
    // regardless of any DR-3 budget state. We do NOT measure these calls.
    if (this.shouldBypassHumanization(action, frame)) {
      return SAFETY_OVERRIDE_TEXT[action] ?? action;
    }
    // DR-3 fallback: prior call breached the budget → emit raw label this once.
    if (this.humanizationFallbackArmed) {
      this.humanizationFallbackArmed = false;
      return action;
    }
    const start = performance.now();
    const text = this.humanizeAction(action, frame);
    const elapsed = performance.now() - start;

    // Bounded ring buffer — drop oldest when capped.
    if (this.humanizationLatencySamples.length >= CoachingService.LATENCY_SAMPLE_CAP) {
      this.humanizationLatencySamples.shift();
    }
    this.humanizationLatencySamples.push(elapsed);

    if (elapsed > this.humanizationBudgetMs) {
      this.humanizationFallbackArmed = true;
      if (import.meta.env.DEV) {
        console.warn(
          `[humanizeAction] budget breach: ${elapsed.toFixed(2)}ms > ${this.humanizationBudgetMs}ms ` +
          `(action=${action}). Next emission will use raw label.`,
        );
      }
    }
    return text;
  }

  /** Call when a new lap starts (e.g. from lap detection logic).
   *  Surfaces the flushed corner's improvement decision into the queue. */
  newLap(): void {
    const improvement = this.performanceTracker.newLap();
    if (improvement) this.coachingQueue.enqueue(improvement);
  }

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

  /**
   * One-tier boost for actions the driver is actively working on.
   * Floor is 1 (not 0): P0 is reserved for safety and triggers preempt() which
   * bypasses the TimingGate blackout. A goal-boosted P1 must NEVER cross that
   * line, or a tactical message could fire mid-apex (Cursor Bugbot, PR #2).
   */
  private boostForGoals(action: CoachAction, base: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
    if (base === 0) return 0;
    if (!this.prioritizedActionSet.has(action)) return base;
    return Math.max(1, base - 1) as 1 | 2 | 3;
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
    // Maintain rolling window for COLD prompt builder (DR-4).
    this.coldFrameWindow.push(frame);
    if (this.coldFrameWindow.length > CoachingService.COLD_WINDOW_FRAMES) {
      this.coldFrameWindow.shift();
    }

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

        let priority = this.boostForGoals(rule.action, actionPriority(rule.action));
        this.lastHotAction = rule.action;

        // Audit B2: when DR-6 safety override applies to a non-P0 action
        // (e.g. THRESHOLD, SPIKE_BRAKE at >70 mph), promote priority to P0
        // so the message bypasses the TimingGate MID_CORNER blackout. The
        // text is already the override imperative; without P0 promotion the
        // override imperative would be silenced mid-corner — exactly the
        // moment a panicked driver needs it.
        if (priority !== 0 && this.shouldBypassHumanization(rule.action, frame)) {
          priority = 0;
        }

        const decision: CoachingDecision = {
          path: 'hot',
          action: rule.action,
          text: this.humanizeOrFallback(rule.action, frame),
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
        text: this.humanizeOrFallback('COGNITIVE_OVERLOAD', frame),
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
   * Fires HUSTLE at most once every 8 seconds (throttle is on the fire, not on
   * the check — eligibility is re-evaluated every frame so we don't miss the
   * moment conditions actually match). Beginner-focused: BEGINNER skill only.
   */
  private checkHustle(frame: TelemetryFrame): void {
    if (frame.time - this.lastHustleFire < 8) return;
    if (this.driverModel.getSkillLevel() !== 'BEGINNER') return;

    const onExit = this.currentPhase === 'ACCELERATION' || this.currentPhase === 'STRAIGHT';
    const lazyThrottle = frame.throttle > 50 && frame.throttle < 92;
    const movingFast = frame.speed > 40;
    const lowLateralG = Math.abs(frame.gLat) < 0.3;

    if (onExit && lazyThrottle && movingFast && lowLateralG) {
      this.lastHustleFire = frame.time;
      this.coachingQueue.enqueue({
        path: 'hot',
        action: 'HUSTLE',
        text: this.humanizeOrFallback('HUSTLE', frame),
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

    // Defensive fallback: if a new CoachAction is added to the union and not
    // wired into a persona switch, we MUST NOT speak the raw enum identifier
    // (e.g. "SPIKE_BRAKE") at the driver. Empty string is filtered upstream
    // by the audio service. Surface the gap loudly in dev builds.
    if (import.meta.env.DEV) {
      console.warn(
        `[humanizeAction] no phrase for action="${action}" coach="${this.getCoach().id}" skill="${skillLevel}"`,
      );
    }
    return '';
  }

  // ── COLD PATH: Gemini Cloud detailed analysis ──────────

  /**
   * Build the COLD prompt for the current state. Pure-ish (depends on this.*),
   * exposed so tests can render the prompt without invoking Gemini. DR-4.
   */
  buildColdPromptForCurrentState(frame?: TelemetryFrame): string {
    const coach = this.getCoach();
    const window = frame
      ? [...this.coldFrameWindow, ...(this.coldFrameWindow[this.coldFrameWindow.length - 1] === frame ? [] : [frame])]
      : this.coldFrameWindow;
    return buildColdPrompt({
      frames: window,
      cornerPhase: this.currentPhase,
      corner: this.lastCorner,
      skillLevel: this.driverModel.getSkillLevel(),
      systemPrompt: coach.systemPrompt,
      physicsKnowledge: RACING_PHYSICS_KNOWLEDGE,
    });
  }

  private async runColdPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastColdTime < this.coldCooldownMs) return;
    if (!this.apiKey) return;

    // Set before await to prevent hammering a slow endpoint while one call is in flight.
    // On fetch failure we reset to 0 below so offline → back-online recovers quickly
    // instead of silently burning a 15–20s window per failure.
    this.lastColdTime = now;

    const prompt = this.buildColdPromptForCurrentState(frame);

    try {
      const res = await fetch(
        // API key passed via x-goog-api-key header (review fix) — never in URL.
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
    // DR-1: velocity-scaled geofence. At 0 mph triggerDistance == 0 so the
    // path does not fire when the car is stationary (e.g. paddock, pre-grid).
    const triggerDistance = getTriggerDistance(frame.speed);
    if (triggerDistance <= 0) return;
    const nearest = this.findNearestCornerWithinTriggerDistance(
      frame.latitude, frame.longitude, this.track.corners, triggerDistance,
    );

    if (nearest && nearest !== this.lastCorner) {
      this.lastCorner = nearest;
      this.coachingQueue.enqueue({
        path: 'feedforward',
        // DR-5: vision cue is prepended when the corner has visualReference.
        text: buildFeedforwardText(nearest),
        priority: 1,
        cornerPhase: this.currentPhase,
        timestamp: Date.now(),
      });
    }
  }

  /** Pick the geometrically closest corner within `triggerDistance` metres.
   *  At Sonoma's T2/T3 complex two corner geofences can overlap; returning the
   *  actually-closest avoids array-order determining which advice fires. */
  private findNearestCornerWithinTriggerDistance(
    lat: number, lon: number, corners: Corner[], triggerDistance: number,
  ): Corner | null {
    let nearest: Corner | null = null;
    let minDist = triggerDistance;
    for (const c of corners) {
      const dist = haversineDistance(lat, lon, c.lat, c.lon);
      if (dist < minDist) {
        minDist = dist;
        nearest = c;
      }
    }
    return nearest;
  }
}
