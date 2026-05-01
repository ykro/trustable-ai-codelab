import { describe, it, expect } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * Memory-pressure latency test (Wave 2A).
 *
 * Goal: verify the HOT path stays under budget when the V8 nursery is being
 * churned by other allocations. Real PWA workloads on a Pixel 10 share the
 * heap with React rendering, audio buffers, and SSE callbacks; we approximate
 * that by allocating ~100 KB of throwaway data between every processFrame()
 * call and asserting that p99 stays below the 50 ms HOT-path budget and that
 * max latency is no worse than 3x the control case.
 *
 * NOTE: `getProcessFrameLatencyStats()` (the planned "B5" stats method) does
 * not exist on CoachingService yet. We measure with `performance.now()`
 * directly around `processFrame()` per the task instructions.
 */
describe('CoachingService HOT path under memory pressure', () => {
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

  function distribution(samples: number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      n: sorted.length,
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      max: sorted[sorted.length - 1],
    };
  }

  function fmt(d: ReturnType<typeof distribution>): string {
    return `n=${d.n} mean=${d.mean.toFixed(3)}ms p50=${d.p50.toFixed(3)}ms p95=${d.p95.toFixed(3)}ms p99=${d.p99.toFixed(3)}ms max=${d.max.toFixed(3)}ms`;
  }

  /**
   * Shared frame-loop. Returns latency samples in milliseconds.
   * If `provokeGC` is true, allocates ~100 KB of throwaway state between
   * every frame to push the nursery into more frequent minor GCs.
   */
  function driveFrames(N: number, provokeGC: boolean): number[] {
    const service = new CoachingService();
    // warm-up
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));

    const samples: number[] = new Array(N);
    // Sink reference to prevent the optimizer from eliminating the allocation.
    let sink: unknown = null;

    for (let i = 0; i < N; i++) {
      if (provokeGC) {
        // 100 KB churn: 25k Float64 entries (~200 KB) is too much; a
        // 12500-element Float64Array is ~100 KB. Plus a small Object
        // graph to feed the old-gen path occasionally.
        const big = new Float64Array(12500);
        for (let j = 0; j < big.length; j += 256) big[j] = i + j;
        const obj = { i, t: Date.now(), payload: new Array(64).fill(i) };
        sink = big[i % big.length] + (obj.payload[i % obj.payload.length] as number);
      }

      const start = performance.now();
      service.processFrame(makeFrame(50 + i));
      samples[i] = performance.now() - start;
    }

    // Touch the sink so V8 can't dead-code-eliminate the allocation loop.
    if (typeof sink === 'number' && Number.isNaN(sink)) {
      throw new Error('sink should never be NaN');
    }
    return samples;
  }

  it('p99 < 50ms and max < 3x control under 100 KB/frame allocation churn over 5000 frames', () => {
    const N = 5000;

    // Control first (cold cache for the service, but JIT shared across runs).
    const control = distribution(driveFrames(N, false));
    const pressure = distribution(driveFrames(N, true));

    // eslint-disable-next-line no-console
    console.log(`[memoryPressure] control:  ${fmt(control)}`);
    // eslint-disable-next-line no-console
    console.log(`[memoryPressure] pressure: ${fmt(pressure)}`);

    // Absolute HOT-path budget per system design.
    expect(pressure.p99).toBeLessThan(50);

    // Ratio bound. A small floor (0.5 ms) prevents division-by-near-zero from
    // producing a flaky failure when the control max is sub-millisecond.
    const controlMaxFloor = Math.max(control.max, 0.5);
    expect(pressure.max).toBeLessThan(controlMaxFloor * 3);
  });
});
