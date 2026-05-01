import { describe, it, expect } from 'vitest';
import { buildColdPrompt, computePhysicsContext, type ColdPromptContext } from '../coldPromptBuilder';
import type { TelemetryFrame, SkillLevel } from '../../types';

/**
 * DR-4 ("Why over What") — COLD prompt structure tests.
 *
 * The reviewer's complaint: the old prompt asked the LLM to restate symptoms
 * ("you missed the apex"). We now feed the LLM computed physics context and
 * demand it answer with Symptom -> Root Cause -> Fix where Root Cause cites
 * the physics. These tests assert the prompt template enforces that, and that
 * the physics numbers actually flow through from telemetry into the string.
 *
 * IMPORTANT: we test the PROMPT STRING, not Gemini's response. No network.
 */

const PHYSICS_KNOWLEDGE_STUB = '<<PHYSICS_KNOWLEDGE>>';
const SYSTEM_PROMPT_STUB = '<<SYSTEM_PROMPT>>';

function frame(over: Partial<TelemetryFrame>, t: number): TelemetryFrame {
  return {
    time: t,
    latitude: 38.16,
    longitude: -122.45,
    speed: 60,
    throttle: 0,
    brake: 0,
    gLat: 0,
    gLong: 0,
    ...over,
  };
}

/** Missed-apex scenario: driver was hard on brakes, then released abruptly,
 *  then loaded the front into a heavy lateral G — classic "brake release too
 *  abrupt unloads front tires" root cause. */
function missedApexFrames(): TelemetryFrame[] {
  const out: TelemetryFrame[] = [];
  // 0.0–0.4s: heavy braking
  for (let i = 0; i < 10; i++) {
    out.push(frame({ speed: 95 - i * 1.2, brake: 90, gLong: -1.1, gLat: 0.1 }, i * 0.04));
  }
  // 0.4–0.5s: ABRUPT release (90 -> 0 in 0.08s = -1125 %/s)
  out.push(frame({ speed: 83, brake: 40, gLong: -0.5, gLat: 0.6 }, 0.44));
  out.push(frame({ speed: 82, brake: 0, gLong: -0.1, gLat: 1.0 }, 0.48));
  // 0.5–1.0s: heavy lateral, no throttle, running wide
  for (let i = 0; i < 12; i++) {
    out.push(frame({ speed: 81, brake: 0, throttle: 5, gLat: 1.25, gLong: 0 }, 0.52 + i * 0.04));
  }
  return out;
}

function lateBrakeFrames(): TelemetryFrame[] {
  const out: TelemetryFrame[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(frame({ speed: 110 - i, brake: 0, throttle: 100, gLong: 0.3 }, i * 0.04));
  }
  // Very late, very hard brake stab
  for (let i = 0; i < 12; i++) {
    out.push(frame({ speed: 108 - i * 2, brake: 100, throttle: 0, gLong: -1.3 }, 0.32 + i * 0.04));
  }
  return out;
}

function earlyThrottleFrames(): TelemetryFrame[] {
  const out: TelemetryFrame[] = [];
  // Mid-corner with high gLat, throttle ramping aggressively too soon
  for (let i = 0; i < 20; i++) {
    out.push(frame({
      speed: 55 + i * 0.5,
      brake: 0,
      throttle: 10 + i * 4, // ramps from 10% to 86%
      gLat: 1.15,
      gLong: 0.2,
    }, i * 0.04));
  }
  return out;
}

function oversteerFrames(): TelemetryFrame[] {
  const out: TelemetryFrame[] = [];
  for (let i = 0; i < 15; i++) {
    out.push(frame({
      speed: 65,
      brake: 0,
      throttle: 70,
      gLat: 1.3 - i * 0.05,  // grip collapsing
      gLong: 0.1,
    }, i * 0.04));
  }
  return out;
}

function ctxFor(frames: TelemetryFrame[], skill: SkillLevel = 'BEGINNER'): ColdPromptContext {
  return {
    frames,
    cornerPhase: 'MID_CORNER',
    corner: { name: 'Turn 7', advice: 'Late apex, watch for camber.' },
    skillLevel: skill,
    systemPrompt: SYSTEM_PROMPT_STUB,
    physicsKnowledge: PHYSICS_KNOWLEDGE_STUB,
  };
}

describe('buildColdPrompt — root cause directive', () => {
  it('includes an explicit "do not restate the symptom" directive', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/ROOT CAUSE ANALYSIS DIRECTIVE/);
    expect(prompt).toMatch(/[Dd]o NOT restate the symptom/);
    expect(prompt).toMatch(/explain WHY/);
  });

  it('mentions the physics levers the LLM must reason over', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/weight transfer/i);
    expect(prompt).toMatch(/friction[- ]circle/i);
    expect(prompt).toMatch(/brake[- ]release/i);
    expect(prompt).toMatch(/tire/i);
  });
});

describe('buildColdPrompt — physics context placeholders are populated', () => {
  it('injects lateral & longitudinal weight-transfer integrals as numbers', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Lateral weight transfer.*-?\d+\.\d{3}\s*G·s/);
    expect(prompt).toMatch(/Longitudinal weight transfer.*-?\d+\.\d{3}\s*G·s/);
  });

  it('injects friction-circle utilization as a percentage', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Friction-circle utilization:\s*\d+%/);
  });

  it('injects brake-release rate (%/s) and flags abrupt releases', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Brake release rate.*-?\d+\.\d\s*%\/s/);
    expect(prompt).toMatch(/ABRUPT — unloads front tires/);
  });

  it('injects throttle-application rate (%/s)', () => {
    const prompt = buildColdPrompt(ctxFor(earlyThrottleFrames()));
    expect(prompt).toMatch(/Throttle application rate.*\d+\.\d\s*%\/s/);
  });

  it('injects peak combined G and current combined G', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Peak combined G:\s*\d+\.\d{2}G/);
    expect(prompt).toMatch(/Combined:\s*\d+\.\d{2}G/);
  });

  it('flags AT LIMIT when combined G exceeds ~1.33G', () => {
    const prompt = buildColdPrompt(ctxFor(lateBrakeFrames()));
    expect(prompt).toMatch(/AT LIMIT/);
  });

  it('numbers reflect the actual telemetry — different scenarios produce different prompts', () => {
    const a = buildColdPrompt(ctxFor(missedApexFrames()));
    const b = buildColdPrompt(ctxFor(earlyThrottleFrames()));
    expect(a).not.toEqual(b);
  });
});

describe('buildColdPrompt — output schema', () => {
  it('requests Symptom / Root Cause / Fix structure explicitly', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Symptom:/);
    expect(prompt).toMatch(/Root Cause:/);
    expect(prompt).toMatch(/Fix:/);
    expect(prompt).toMatch(/OUTPUT FORMAT/);
  });

  it('demands the Root Cause cite at least one number from the context', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/grounded in at least one number/);
  });

  it('skill level shapes the output constraint (beginner = no jargon, advanced = numbers)', () => {
    const beg = buildColdPrompt(ctxFor(missedApexFrames(), 'BEGINNER'));
    const adv = buildColdPrompt(ctxFor(missedApexFrames(), 'ADVANCED'));
    expect(beg).toMatch(/[Nn]o jargon/);
    expect(adv).toMatch(/[Tt]echnical terms OK|telemetry numbers/);
  });
});

describe('buildColdPrompt — covers known scenarios', () => {
  it('builds for missed-apex without throwing', () => {
    expect(() => buildColdPrompt(ctxFor(missedApexFrames()))).not.toThrow();
  });
  it('builds for late-brake without throwing', () => {
    expect(() => buildColdPrompt(ctxFor(lateBrakeFrames()))).not.toThrow();
  });
  it('builds for early-throttle without throwing', () => {
    expect(() => buildColdPrompt(ctxFor(earlyThrottleFrames()))).not.toThrow();
  });
  it('builds for oversteer-recovery follow-up without throwing', () => {
    expect(() => buildColdPrompt(ctxFor(oversteerFrames()))).not.toThrow();
  });
  it('handles empty frame window defensively', () => {
    const prompt = buildColdPrompt(ctxFor([]));
    expect(prompt).toMatch(/no telemetry samples/);
  });
});

/** B4: a window where the driver is still on the brakes at the end — never
 *  released within the observation window. brake stays > 5 the entire time.
 *  The old code reported brakeReleaseRate ~ 0 here, which the LLM read as
 *  "released smoothly." That's wrong — the right answer is "no release captured." */
function brakeNotReleasedFrames(): TelemetryFrame[] {
  const out: TelemetryFrame[] = [];
  // Heavy braking from start to end of window — peak holds, never released.
  for (let i = 0; i < 25; i++) {
    out.push(frame({
      speed: 95 - i * 0.5,
      brake: 80 + (i % 3),  // wobbles 80..82, never < 5
      throttle: 0,
      gLong: -1.0,
      gLat: 0.05,
    }, i * 0.04));
  }
  return out;
}

describe('computePhysicsContext — B4 brake-released-in-window flag', () => {
  it('flags brakeReleasedInWindow=true when a post-peak frame drops below active threshold', () => {
    const p = computePhysicsContext(missedApexFrames());
    expect(p.brakeReleasedInWindow).toBe(true);
    expect(p.brakeReleaseRate).toBeLessThan(-200);
  });

  it('flags brakeReleasedInWindow=false when window ends still on the brakes', () => {
    const p = computePhysicsContext(brakeNotReleasedFrames());
    expect(p.brakeReleasedInWindow).toBe(false);
    // Numeric rate is meaningless here — the renderer should not use it.
    // We only assert it's finite (no NaN) so downstream consumers don't crash.
    expect(Number.isFinite(p.brakeReleaseRate)).toBe(true);
  });

  it('flags brakeReleasedInWindow=false when brake never engaged', () => {
    const p = computePhysicsContext([
      frame({ brake: 0, throttle: 100, gLong: 0.3 }, 0),
      frame({ brake: 0, throttle: 100, gLong: 0.3 }, 0.04),
    ]);
    expect(p.brakeReleasedInWindow).toBe(false);
    expect(p.brakeReleaseRate).toBe(0);
  });
});

describe('buildColdPrompt — B4 no-release rendering', () => {
  it('substitutes a "no release captured" line when window ends still on the brakes', () => {
    const prompt = buildColdPrompt(ctxFor(brakeNotReleasedFrames()));
    expect(prompt).toMatch(/no release captured/);
    expect(prompt).toMatch(/brake still applied at end of window/);
    // Critically, the misleading numeric form must NOT appear for this scenario.
    expect(prompt).not.toMatch(/Brake release rate \(d\(brake\)\/dt from peak\):\s*-?0\.0\s*%\/s/);
    expect(prompt).not.toMatch(/Brake release rate \(d\(brake\)\/dt from peak\):/);
  });

  it('keeps the numeric brake-release form when release IS captured', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames()));
    expect(prompt).toMatch(/Brake release rate \(d\(brake\)\/dt from peak\):\s*-?\d+\.\d\s*%\/s/);
    expect(prompt).not.toMatch(/no release captured/);
  });
});

describe('computePhysicsContext', () => {
  it('detects abrupt brake release in missed-apex scenario', () => {
    const p = computePhysicsContext(missedApexFrames());
    expect(p.brakeReleaseRate).toBeLessThan(-200);
  });
  it('reports positive throttle application rate when ramping in', () => {
    const p = computePhysicsContext(earlyThrottleFrames());
    expect(p.throttleApplicationRate).toBeGreaterThan(50);
  });
  it('flags atFrictionLimit when combined G crosses ~1.33', () => {
    const p = computePhysicsContext(lateBrakeFrames());
    expect(p.atFrictionLimit).toBe(true);
  });
  it('returns zeroed context for empty input (no NaN)', () => {
    const p = computePhysicsContext([]);
    expect(p.peakCombinedG).toBe(0);
    expect(Number.isFinite(p.brakeReleaseRate)).toBe(true);
  });
});

describe('buildColdPrompt — snapshot for canonical missed-apex scenario', () => {
  it('matches snapshot so future drift is reviewable', () => {
    const prompt = buildColdPrompt(ctxFor(missedApexFrames(), 'BEGINNER'));
    expect(prompt).toMatchSnapshot();
  });
});
