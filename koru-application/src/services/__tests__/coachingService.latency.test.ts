import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * Latency benchmark for the HOT path on the data reasoning side.
 *
 * Budget per system design: <50ms HOT path. The Pixel 10 PWA runs at 25Hz —
 * a frame is delivered every 40ms, so processFrame() must comfortably finish
 * within that window with margin for the audio service and Gemini calls
 * happening in parallel. We target a much tighter 5ms mean / 15ms p99 here
 * because everything in this test runs in-process with no network and no DOM.
 *
 * NOTE: This is a wall-clock test. Numbers will vary by host. Thresholds are
 * chosen with ~5x slack so CI on a slow runner still passes; if this test
 * starts failing on real hardware, the right response is to investigate
 * regressions, not to relax the bound. The April 29 gate cares about the
 * shape of the distribution, not the absolute number on a laptop.
 */
describe('CoachingService HOT path latency', () => {
  let service: CoachingService;

  beforeEach(() => {
    service = new CoachingService();
  });

  function makeFrame(i: number): TelemetryFrame {
    // Vary signals frame-to-frame so DECISION_MATRIX rules and DriverModel
    // both exercise their branches — flat data would cache-warm artificially.
    const t = i * 0.04; // 25Hz
    const corneringPhase = (i % 50) < 20; // alternates straights and corners
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

  it('processFrame mean < 5ms, p99 < 15ms over 1000 frames', () => {
    // Warm-up: JIT, V8 inline caches.
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));

    const samples: number[] = [];
    const N = 1000;
    for (let i = 50; i < 50 + N; i++) {
      const start = performance.now();
      service.processFrame(makeFrame(i));
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const max = samples[samples.length - 1];

    // Surface the distribution so a regression shows up in test output.
    // eslint-disable-next-line no-console
    console.log(
      `[latency] N=${N} mean=${mean.toFixed(3)}ms p50=${p50.toFixed(3)}ms ` +
      `p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`,
    );

    expect(mean).toBeLessThan(5);
    expect(p99).toBeLessThan(15);
  });

  it('no single frame exceeds the 25Hz inter-frame budget (40ms)', () => {
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));
    let max = 0;
    for (let i = 50; i < 1050; i++) {
      const start = performance.now();
      service.processFrame(makeFrame(i));
      max = Math.max(max, performance.now() - start);
    }
    // If a single processFrame exceeds 40ms we'd drop frames at 25Hz.
    // Generous 30ms bound to absorb GC pauses on noisy CI machines.
    expect(max).toBeLessThan(30);
  });
});
