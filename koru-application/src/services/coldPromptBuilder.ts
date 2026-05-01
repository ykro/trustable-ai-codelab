/**
 * COLD prompt builder (DR-4: "Why over What").
 *
 * Pure function. No side effects. No Gemini calls. Unit-testable.
 *
 * Goal: instead of asking the LLM to restate symptoms ("you missed the apex"),
 * we feed it computed physics signals from the recent telemetry window and
 * explicitly request a Symptom -> Root Cause -> Fix structure where the
 * Root Cause is grounded in those numbers. Reviewer (April 29):
 *   "Drivers usually know when they made a mistake. Use Gemini's physics
 *    context to explain the root cause instead of the symptom."
 *
 * The window is whatever the caller passes — the cold path already keeps a
 * recent-frame buffer on the side. We compute lightweight derived signals on
 * the fly so we don't bolt a new computation engine onto the hot path.
 */
import type { TelemetryFrame, CornerPhase, SkillLevel, Corner } from '../types';

export interface ColdPromptContext {
  /** Recent telemetry window, oldest first. ~1-3s at 25Hz is the sweet spot. */
  frames: TelemetryFrame[];
  /** Current detected corner phase (for context, not for the rule). */
  cornerPhase: CornerPhase;
  /** Nearest/active corner if known (track-aware) — name + advice get injected. */
  corner: { name: string; advice: string } | Corner | null;
  /** Driver skill — controls verbosity/jargon in the constrained output. */
  skillLevel: SkillLevel;
  /** Coach persona system prompt (voice, tone). */
  systemPrompt: string;
  /** Static physics knowledge block (friction circle, weight transfer, etc). */
  physicsKnowledge: string;
}

/** Numbers we compute from the frame window to ground the root-cause analysis. */
export interface PhysicsContext {
  /** Lateral G integral (signed) over the window — proxy for total lateral weight transfer. */
  lateralWeightTransfer: number;
  /** Longitudinal G integral (signed) over the window — front/rear weight transfer history. */
  longitudinalWeightTransfer: number;
  /** Peak combined G magnitude in the window (sqrt(gLat^2 + gLong^2)). */
  peakCombinedG: number;
  /** Combined-G magnitude on the most recent frame (instantaneous friction-circle position). */
  currentCombinedG: number;
  /** Friction-circle utilization, 0..>1, vs assumed 1.4G street-tire grip limit. */
  frictionCircleUtilization: number;
  /** d(brake)/dt averaged over the brake-release portion of the window, %/sec. Negative = releasing.
   *  Only meaningful when `brakeReleasedInWindow` is true; otherwise the window ended with the
   *  driver still on the brakes and no release was captured. */
  brakeReleaseRate: number;
  /** True iff the window contained at least one post-peak frame with brake < 5 — i.e. the
   *  driver actually released the brake within the observation window. When false, the window
   *  ended mid-application; `brakeReleaseRate` should NOT be interpreted as "released smoothly". */
  brakeReleasedInWindow: boolean;
  /** d(throttle)/dt averaged over the throttle-application portion of the window, %/sec. */
  throttleApplicationRate: number;
  /** Speed delta (mph) across the window — positive = accelerating. */
  speedDelta: number;
  /** True if combined-G > FRICTION_LIMIT * 0.95 at any point. */
  atFrictionLimit: boolean;
}

/** Assumed grip ceiling for a street-tire'd 2024 Subaru GR86 on Sonoma tarmac.
 *  Not exact — used only as a normalizer so the LLM has a reference scale. */
const FRICTION_LIMIT_G = 1.4;

export function computePhysicsContext(frames: TelemetryFrame[]): PhysicsContext {
  if (frames.length === 0) {
    return {
      lateralWeightTransfer: 0,
      longitudinalWeightTransfer: 0,
      peakCombinedG: 0,
      currentCombinedG: 0,
      frictionCircleUtilization: 0,
      brakeReleaseRate: 0,
      brakeReleasedInWindow: false,
      throttleApplicationRate: 0,
      speedDelta: 0,
      atFrictionLimit: false,
    };
  }

  let latIntegral = 0;
  let longIntegral = 0;
  let peakCombined = 0;
  let atLimit = false;

  // Trapezoidal-ish integrals, plus brake/throttle slopes computed from
  // first-vs-last samples in their respective active regions.
  let brakeStartIdx = -1;
  let brakeEndIdx = -1;
  let throttleStartIdx = -1;
  let throttleEndIdx = -1;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dt = i === 0 ? 0 : Math.max(0, f.time - frames[i - 1].time);
    latIntegral += f.gLat * dt;
    longIntegral += f.gLong * dt;
    const combined = Math.hypot(f.gLat, f.gLong);
    if (combined > peakCombined) peakCombined = combined;
    if (combined > FRICTION_LIMIT_G * 0.9) atLimit = true;

    if (f.brake > 5) {
      if (brakeStartIdx === -1) brakeStartIdx = i;
      brakeEndIdx = i;
    }
    if (f.throttle > 5) {
      if (throttleStartIdx === -1) throttleStartIdx = i;
      throttleEndIdx = i;
    }
  }

  const last = frames[frames.length - 1];
  const first = frames[0];
  const currentCombined = Math.hypot(last.gLat, last.gLong);

  // Brake-release rate: from the peak-brake sample to the last brake-active sample.
  // Negative number = releasing. If brake never engaged, rate = 0.
  //
  // B4 framing fix: explicitly track whether the driver actually released the brake
  // within the window. If not (e.g. window ends still on the brakes), a near-zero
  // rate is misleading — the LLM would read it as "released smoothly" when the
  // truth is "no release captured." We expose `brakeReleasedInWindow` so the
  // prompt renderer can suppress the misleading numeric and label the case.
  let brakeReleaseRate = 0;
  let brakeReleasedInWindow = false;
  if (brakeStartIdx !== -1 && brakeEndIdx > brakeStartIdx) {
    // Use the LAST occurrence of peak brake so the release-rate window
    // measures only the actual release portion, not the held-peak portion.
    let peakIdx = brakeStartIdx;
    for (let i = brakeStartIdx; i <= brakeEndIdx; i++) {
      if (frames[i].brake >= frames[peakIdx].brake) peakIdx = i;
    }
    // Did any post-peak frame actually drop below the active threshold (i.e.
    // did the driver release within the window)?
    for (let i = peakIdx + 1; i < frames.length; i++) {
      if (frames[i].brake < 5) { brakeReleasedInWindow = true; break; }
    }
    if (brakeReleasedInWindow) {
      // Tail: prefer the first sample after peak that drops to ~0 (the end of
      // the release), even if it falls below the brake>5 active threshold.
      let tailIdx = brakeEndIdx;
      for (let i = peakIdx + 1; i < frames.length; i++) {
        tailIdx = i;
        if (frames[i].brake < 5) break;
      }
      const dt = frames[tailIdx].time - frames[peakIdx].time;
      if (dt > 0) {
        brakeReleaseRate = (frames[tailIdx].brake - frames[peakIdx].brake) / dt;
      }
    }
    // else: no release captured. Leave brakeReleaseRate at 0; renderer
    // will substitute a "no release captured" line instead of "0.0 %/s".
  }

  // Throttle-application rate: rising edge from start of throttle window to peak.
  let throttleApplicationRate = 0;
  if (throttleStartIdx !== -1 && throttleEndIdx > throttleStartIdx) {
    let peakIdx = throttleStartIdx;
    for (let i = throttleStartIdx; i <= throttleEndIdx; i++) {
      if (frames[i].throttle > frames[peakIdx].throttle) peakIdx = i;
    }
    const dt = frames[peakIdx].time - frames[throttleStartIdx].time;
    if (dt > 0) {
      throttleApplicationRate =
        (frames[peakIdx].throttle - frames[throttleStartIdx].throttle) / dt;
    }
  }

  return {
    lateralWeightTransfer: latIntegral,
    longitudinalWeightTransfer: longIntegral,
    peakCombinedG: peakCombined,
    currentCombinedG: currentCombined,
    frictionCircleUtilization: peakCombined / FRICTION_LIMIT_G,
    brakeReleaseRate,
    brakeReleasedInWindow,
    throttleApplicationRate,
    speedDelta: last.speed - first.speed,
    atFrictionLimit: atLimit,
  };
}

/** Skill-tuned word budget and jargon level for the constrained output. */
function outputConstraint(skill: SkillLevel): string {
  switch (skill) {
    case 'BEGINNER':
      return 'Output under 30 words total. Feel-based language. No jargon. Drive a beginner toward ONE physical fix.';
    case 'ADVANCED':
      return 'Output under 40 words total. Reference the telemetry numbers directly. Technical terms OK.';
    default:
      return 'Output under 35 words total. One sentence per section. Brief physics rationale OK.';
  }
}

/**
 * Build the cold-path prompt. Pure function — same inputs always yield the
 * same string (modulo IEEE-754 rounding in the .toFixed calls).
 *
 * Structure: persona -> physics knowledge -> telemetry snapshot ->
 * computed physics context -> location -> root-cause directive ->
 * Symptom/Root Cause/Fix output schema -> skill-tuned constraint.
 */
export function buildColdPrompt(ctx: ColdPromptContext): string {
  const { frames, cornerPhase, corner, skillLevel, systemPrompt, physicsKnowledge } = ctx;
  const last = frames[frames.length - 1];
  const physics = computePhysicsContext(frames);

  const cornerName = corner?.name || 'straight';
  const cornerAdvice = corner?.advice || '';

  const snapshot = last
    ? `Speed: ${last.speed.toFixed(1)} mph | Brake: ${last.brake.toFixed(0)}% | Throttle: ${last.throttle.toFixed(0)}%
G-Lat: ${last.gLat.toFixed(2)} | G-Long: ${last.gLong.toFixed(2)} | Combined: ${physics.currentCombinedG.toFixed(2)}G
Phase: ${cornerPhase}`
    : `(no telemetry samples)`;

  const physicsBlock = `Computed Physics Context (last ${frames.length} samples, ~${
    frames.length > 1 ? ((last.time - frames[0].time) * 1000).toFixed(0) : 0
  }ms window):
- Lateral weight transfer (∫gLat dt): ${physics.lateralWeightTransfer.toFixed(3)} G·s
- Longitudinal weight transfer (∫gLong dt): ${physics.longitudinalWeightTransfer.toFixed(3)} G·s
- Peak combined G: ${physics.peakCombinedG.toFixed(2)}G
- Friction-circle utilization: ${(physics.frictionCircleUtilization * 100).toFixed(0)}% of ${FRICTION_LIMIT_G}G limit${
    physics.atFrictionLimit ? ' (AT LIMIT)' : ''
  }
- ${physics.brakeReleasedInWindow
    ? `Brake release rate (d(brake)/dt from peak): ${physics.brakeReleaseRate.toFixed(1)} %/s${
        physics.brakeReleaseRate < -200 ? ' (ABRUPT — unloads front tires)' : ''
      }`
    : 'Brake release rate: brake still applied at end of window (no release captured)'}
- Throttle application rate (d(throttle)/dt rising): ${physics.throttleApplicationRate.toFixed(1)} %/s
- Speed delta over window: ${physics.speedDelta >= 0 ? '+' : ''}${physics.speedDelta.toFixed(1)} mph`;

  const rootCauseDirective = `ROOT CAUSE ANALYSIS DIRECTIVE:
Do NOT restate the symptom — the driver already knows what happened (e.g. they
know they missed the apex, ran wide, or were slow on exit). Use the computed
physics context above to explain WHY it happened in mechanical terms (weight
transfer, friction-circle position, brake-release rate, tire loading). The
"why" is what the driver cannot feel from the seat. That is your value.`;

  const outputFormat = `OUTPUT FORMAT (mandatory — emit exactly these three sections, in order, each ONE short sentence):
Symptom: <what the driver felt — one short clause, no numbers>
Root Cause: <the physics, grounded in at least one number from the context above>
Fix: <ONE physical action the driver can take next lap>`;

  return `${systemPrompt}

${physicsKnowledge}

Current Telemetry:
${snapshot}
Location: ${cornerName}${cornerAdvice ? ' - ' + cornerAdvice : ''}

${physicsBlock}

${rootCauseDirective}

${outputFormat}

${outputConstraint(skillLevel)}`;
}
