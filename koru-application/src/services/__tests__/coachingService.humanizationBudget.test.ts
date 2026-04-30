import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { CoachingDecision, TelemetryFrame } from '../../types';

/**
 * DR-3: Humanization budget with raw-action-label fallback.
 *
 * The HOT path measures each humanizeAction call with performance.now().
 * If a call exceeds humanizationBudgetMs (default 50ms), the NEXT emission
 * falls back to the raw action label (e.g. "BRAKE") instead of a humanized
 * phrase. The fallback is sticky for one emission, then resets — this gives
 * us one "cheap" frame to recover without abandoning humanization permanently.
 *
 * Latency assertion: real performance.now(), generous slack to avoid CI flake.
 */
describe('CoachingService DR-3 humanization budget', () => {
  let service: CoachingService;
  let decisions: CoachingDecision[];

  beforeEach(() => {
    service = new CoachingService();
    decisions = [];
    service.onCoaching(msg => decisions.push(msg));
  });

  const frame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
    time: 0, latitude: 0, longitude: 0,
    speed: 60, throttle: 50, brake: 0, gLat: 0, gLong: 0,
    ...overrides,
  });

  it('humanization p99 < 50ms across 1000 frames', () => {
    // Warm-up
    for (let i = 0; i < 50; i++) {
      service.processFrame(frame({
        time: i * 0.04,
        speed: 50 + (i % 10),
        throttle: 30 + (i % 30),
        brake: (i % 7) * 5,
        gLat: 0.4 + (i % 5) * 0.1,
        gLong: -0.2 - (i % 3) * 0.1,
      }));
    }

    const samples = service.getHumanizationLatencySamples();
    samples.length = 0; // reset

    for (let i = 50; i < 1050; i++) {
      service.processFrame(frame({
        time: i * 0.04,
        speed: 50 + (i % 10),
        throttle: 30 + (i % 30),
        brake: (i % 7) * 5,
        gLat: 0.4 + (i % 5) * 0.1,
        gLong: -0.2 - (i % 3) * 0.1,
      }));
    }

    expect(samples.length).toBeGreaterThan(0);
    const sorted = [...samples].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    // eslint-disable-next-line no-console
    console.log(`[humanize] N=${samples.length} p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`);
    expect(p99).toBeLessThan(50);
  });

  it('falls back to raw action label on the next call after a budget breach', () => {
    // Test the humanizeOrFallback unit directly — the queue/cooldown machinery
    // around it is exercised by other tests, and using P0 actions here would
    // collide with the DR-6 safety override. Direct unit call is the cleanest
    // way to verify the budget-breach → raw-label state machine in isolation.
    const f = frame({ speed: 60, throttle: 70, brake: 0, gLat: 0.5, gLong: 0 });

    let nextCallSlow = false;
    const original = (service as any).humanizeAction.bind(service);
    (service as any).humanizeAction = (action: string, frm: TelemetryFrame) => {
      if (nextCallSlow) {
        nextCallSlow = false;
        const start = performance.now();
        while (performance.now() - start < 60) { /* spin > 50ms */ }
      }
      return original(action, frm);
    };

    // 1) Normal call — humanized text.
    const r1 = (service as any).humanizeOrFallback('THROTTLE', f) as string;
    expect(r1.length).toBeGreaterThan(0);
    expect(r1).not.toBe('THROTTLE');

    // 2) Slow call — humanized this time, but arms fallback for next.
    nextCallSlow = true;
    const r2 = (service as any).humanizeOrFallback('TRAIL_BRAKE', f) as string;
    expect(r2.length).toBeGreaterThan(0); // still humanized — fallback arms for NEXT call
    expect(r2).not.toBe('TRAIL_BRAKE');

    // 3) Next call — fallback is armed, should return raw action label.
    const r3 = (service as any).humanizeOrFallback('COMMIT', f) as string;
    expect(r3).toBe('COMMIT');

    // 4) Subsequent call — fallback disarmed, humanization restored.
    const r4 = (service as any).humanizeOrFallback('THROTTLE', f) as string;
    expect(r4).not.toBe('THROTTLE');
    expect(r4.length).toBeGreaterThan(0);
  });
});
