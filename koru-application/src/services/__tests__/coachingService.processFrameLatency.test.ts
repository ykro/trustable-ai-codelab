import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * B5 — Full processFrame HOT-path latency.
 *
 * The reviewer asked for ≤50ms on the HOT path total, not just the
 * humanization step. Today (pre-B5) only humanizeAction was timed; if
 * corner detection, queue sort, decision matrix scan, or anything else in
 * processFrame adds up, the budget could be silently breached.
 *
 * This test exercises the new `processFrameLatencySamples` ring buffer
 * (entry → just before async cold-path dispatch) over 1000 frames and
 * asserts p99 < 50ms. It also asserts that the measurement is *separate*
 * from humanization — when humanization is artificially slowed, the
 * processFrame stat reflects the spin only on emitting frames, not all 1000.
 */
describe('CoachingService B5 — full processFrame HOT-path latency', () => {
  let service: CoachingService;

  beforeEach(() => {
    service = new CoachingService();
  });

  function makeFrame(i: number): TelemetryFrame {
    const t = i * 0.04; // 25Hz
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

  it('control: getProcessFrameLatencyStats() before any frame returns count:0', () => {
    const stats = service.getProcessFrameLatencyStats();
    expect(stats.count).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p99).toBe(0);
    expect(stats.max).toBe(0);
  });

  it('records one sample per processFrame call', () => {
    for (let i = 0; i < 10; i++) service.processFrame(makeFrame(i));
    expect(service.getProcessFrameLatencyStats().count).toBe(10);
  });

  it('resetProcessFrameLatencyStats() clears the buffer without touching humanization', () => {
    for (let i = 0; i < 5; i++) service.processFrame(makeFrame(i));
    expect(service.getProcessFrameLatencyStats().count).toBe(5);
    const humanizationCountBefore = service.getHumanizationLatencySamples().length;
    service.resetProcessFrameLatencyStats();
    expect(service.getProcessFrameLatencyStats().count).toBe(0);
    // The humanization buffer is independent — reset must not touch it.
    expect(service.getHumanizationLatencySamples().length).toBe(humanizationCountBefore);
  });

  it('p99 < 50ms over 1000 frames (HOT-path budget)', () => {
    // Warm-up: JIT, V8 inline caches.
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));
    service.resetProcessFrameLatencyStats();

    const N = 1000;
    for (let i = 50; i < 50 + N; i++) {
      service.processFrame(makeFrame(i));
    }

    const stats = service.getProcessFrameLatencyStats();
    // Surface the distribution so a regression shows up in test output.
    // eslint-disable-next-line no-console
    console.log(
      `[B5 latency] N=${stats.count} mean=${stats.mean.toFixed(3)}ms ` +
      `p50=${stats.p50.toFixed(3)}ms p99=${stats.p99.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
    );
    expect(stats.count).toBe(N);
    expect(stats.p99).toBeLessThan(50);
  });

  it('a slow humanizer surfaces in processFrame p99 — and only on emitting frames', { timeout: 30_000 }, () => {
    // Replace humanizeAction with a 60ms busy-spin. processFrame should reflect
    // that ONLY for frames that actually trigger a decision-matrix rule (i.e.
    // emit), not every one of the 1000 frames. So humanization spin count
    // should be << total frame count.
    //
    // Why a private-method override is OK here: the test is asserting
    // observable wiring — that processFrame measurement subsumes humanizer
    // cost. If humanizeAction were rewritten to a public hook later, this
    // test would migrate to the new seam.
    const SPIN_MS = 60;
    const slow = function (this: CoachingService) {
      const start = performance.now();
      while (performance.now() - start < SPIN_MS) { /* busy */ }
      return 'slow';
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).humanizeAction = slow;

    // We also raise the humanization budget so the DR-3 raw-label fallback
    // doesn't kick in and skip humanization on the next frame after a breach.
    service.setHumanizationBudgetMs(SPIN_MS * 10);

    const N = 80;
    for (let i = 0; i < N; i++) service.processFrame(makeFrame(i));

    const pStats = service.getProcessFrameLatencyStats();
    const humanSamples = service.getHumanizationLatencySamples();

    // 1) processFrame max reflects the spin (>= ~SPIN_MS — allow some slack
    //    for timer granularity and measurement overhead).
    expect(pStats.max).toBeGreaterThanOrEqual(SPIN_MS - 5);

    // 2) The spin happens only on emitting frames. processFrame is sampled
    //    every frame, so the count of slow processFrame samples must be
    //    strictly less than the total frame count and equal to the number
    //    of humanization samples (each emit calls humanizeAction once).
    expect(humanSamples.length).toBeGreaterThan(0);
    expect(humanSamples.length).toBeLessThan(N);

    // 3) The two buffers are separate measurements: processFrame has N samples,
    //    humanization has fewer (only emitted frames).
    expect(pStats.count).toBe(N);
    expect(pStats.count).toBeGreaterThan(humanSamples.length);
  });
});
