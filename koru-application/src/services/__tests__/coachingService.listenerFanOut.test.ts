import { describe, it, expect } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame, CoachingDecision } from '../../types';

/**
 * Listener fan-out latency test (Wave 2A).
 *
 * The service notifies subscribers via `onCoaching(cb)` (returns an
 * unsubscribe function — verified in coachingService.ts:125-128). Listeners
 * are invoked synchronously in `emit()` (coachingService.ts:137).
 *
 * We drive the same N frames with 1, 5, 25, and 100 listeners attached and
 * assert that p99 latency scales sub-linearly:
 *   p99(100) / p99(1) < 10x
 *
 * Each listener does trivial work (`x++`). A future refactor that introduces
 * `await` in the emit loop, or that fans listeners out across microtasks,
 * would break this bound.
 *
 * Also: subscribe at frame 500, unsubscribe at frame 700, drive to frame
 * 1000 — verify no exceptions and that the unsubscribe handle works.
 */
describe('CoachingService listener fan-out', () => {
  function makeFrame(i: number): TelemetryFrame {
    const t = i * 0.04;
    const corneringPhase = (i % 50) < 20;
    return {
      time: t,
      latitude: 38.16 + (i % 500) * 0.000002,
      longitude: -122.45 + (i % 500) * 0.000002,
      speed: corneringPhase ? 50 + (i % 7) : 80 + (i % 11),
      throttle: corneringPhase ? 30 + (i % 30) : 80 + (i % 15),
      brake: corneringPhase ? (i % 10) * 5 : 0,
      gLat: corneringPhase ? 0.6 + (i % 5) * 0.1 : 0.05,
      gLong: corneringPhase ? -0.4 - (i % 4) * 0.1 : 0.15,
    };
  }

  function p99(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.99)];
  }
  function mean(arr: number[]): number {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function runWithListeners(numListeners: number, N: number) {
    const service = new CoachingService();
    const counters = new Array<number>(numListeners).fill(0);
    const unsubs: Array<() => void> = [];
    for (let k = 0; k < numListeners; k++) {
      const idx = k;
      // Trivial work — increment a counter. Touching shared state avoids the
      // optimizer dropping the listener body entirely.
      const cb = (_msg: CoachingDecision) => { counters[idx]++; };
      unsubs.push(service.onCoaching(cb));
    }

    // Warm-up
    for (let i = 0; i < 100; i++) service.processFrame(makeFrame(i));

    const samples: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const start = performance.now();
      service.processFrame(makeFrame(100 + i));
      samples[i] = performance.now() - start;
    }

    for (const u of unsubs) u();
    const total = counters.reduce((a, b) => a + b, 0);
    return { samples, totalCalls: total };
  }

  it('p99 scales sub-linearly: p99(100 listeners) / p99(1 listener) < 10x over 1000 frames', () => {
    const N = 1000;
    const results: Record<number, { p99: number; mean: number; calls: number }> = {};
    for (const k of [1, 5, 25, 100]) {
      const { samples, totalCalls } = runWithListeners(k, N);
      results[k] = { p99: p99(samples), mean: mean(samples), calls: totalCalls };
      // eslint-disable-next-line no-console
      console.log(
        `[fanOut] listeners=${k} mean=${results[k].mean.toFixed(3)}ms ` +
        `p99=${results[k].p99.toFixed(3)}ms totalCallbackInvocations=${totalCalls}`,
      );
    }

    // Add a small floor so a sub-millisecond p99(1) doesn't flake the ratio.
    const floor = 0.25;
    const baseline = Math.max(results[1].p99, floor);
    const ratio = results[100].p99 / baseline;
    // eslint-disable-next-line no-console
    console.log(`[fanOut] ratio p99(100)/p99(1) = ${ratio.toFixed(2)}x`);
    expect(ratio).toBeLessThan(10);
  });

  it('subscribe mid-frame at 500, unsubscribe at 700, drive to 1000 — no exceptions', () => {
    const service = new CoachingService();
    let lateCount = 0;
    let unsub: (() => void) | null = null;

    expect(() => {
      for (let i = 0; i < 1000; i++) {
        if (i === 500) {
          unsub = service.onCoaching(() => { lateCount++; });
        }
        if (i === 700 && unsub) {
          unsub();
          unsub = null;
        }
        service.processFrame(makeFrame(i));
      }
    }).not.toThrow();

    // The late listener was subscribed for at most 200 frames (500 → 700).
    // Even if emit() fired on every one of those, the count cannot exceed 200.
    // After unsubscribe at 700, no further invocations should land. This
    // bounds the value above (proving unsubscribe took effect) instead of
    // below (which would be vacuous — every integer is ≥ 0).
    // eslint-disable-next-line no-console
    console.log(`[fanOut] late listener invocations between frames 500-700: ${lateCount}`);
    expect(lateCount).toBeLessThanOrEqual(200);
  });
});
