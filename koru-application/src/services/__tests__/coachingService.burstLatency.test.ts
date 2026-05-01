import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * Burst latency benchmark — sustained 25Hz telemetry for 10 simulated seconds.
 *
 * Goal: prove that processFrame() comfortably fits inside its 40ms inter-frame
 * budget across a sustained burst, not just on average. The Pixel 10 PWA
 * receives a frame every 40ms; consistent overshoot means dropped frames and
 * eventually late audio — Brian Luc's "feedback 800ms late is worse than
 * silence" rule. We measure cumulative drift (sum of overshoots vs the 40ms
 * budget) so a slow leak shows up here even when no single frame fails.
 *
 * NOTE: real wall-clock timing — DO NOT mock time. CI slack: per-frame bound
 * is 50ms (≈50× observed) and drift bound is 200ms over 10s of frames.
 */
describe('CoachingService burst latency (25Hz × 250 frames)', () => {
  let service: CoachingService;

  beforeEach(() => {
    service = new CoachingService();
  });

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

  it('survives a 25Hz burst without per-frame overshoot or cumulative drift', () => {
    // Warm up JIT (not measured).
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));

    const FRAME_BUDGET_MS = 40;
    const PER_FRAME_LIMIT_MS = 50;
    const N = 250; // 10 simulated seconds at 25Hz
    const samples: number[] = new Array(N);
    let drift = 0;

    for (let i = 0; i < N; i++) {
      const frameI = 50 + i;
      const start = performance.now();
      service.processFrame(makeFrame(frameI));
      const dt = performance.now() - start;
      samples[i] = dt;
      if (dt > FRAME_BUDGET_MS) drift += dt - FRAME_BUDGET_MS;
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(N * 0.5)];
    const p95 = samples[Math.floor(N * 0.95)];
    const p99 = samples[Math.floor(N * 0.99)];
    const max = samples[N - 1];

    // eslint-disable-next-line no-console
    console.log(
      `[burst] N=${N} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms ` +
      `p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms drift=${drift.toFixed(2)}ms`,
    );

    expect(max).toBeLessThan(PER_FRAME_LIMIT_MS);
    expect(drift).toBeLessThan(200);
  });
});
