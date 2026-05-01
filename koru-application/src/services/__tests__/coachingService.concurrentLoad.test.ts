import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * Concurrent load: HOT path must not slow down while a COLD path call is
 * in-flight. The COLD path is `await fetch(...)` — Promise plumbing only —
 * so the synchronous HOT branch should be unaffected. We mock fetch with a
 * 5-second-resolving promise (held open for the whole run) and compare
 * HOT-path p99 to a control run with no API key (COLD never fires).
 *
 * If a measurable slowdown shows up while COLD is pending, fail loudly —
 * that would mean the COLD branch is doing real work synchronously and
 * starving the HOT path.
 */
describe('CoachingService HOT path vs in-flight COLD', () => {
  let originalFetch: typeof globalThis.fetch | undefined;
  let pendingResolves: Array<() => void> = [];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    pendingResolves = [];
  });

  afterEach(() => {
    // Drain any pending promises so vitest can exit.
    pendingResolves.forEach((r) => r());
    pendingResolves = [];
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as { fetch?: unknown }).fetch;
    vi.restoreAllMocks();
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

  function measure(service: CoachingService, frames: number): number[] {
    // Warm-up
    for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));
    const samples: number[] = [];
    for (let i = 50; i < 50 + frames; i++) {
      const start = performance.now();
      service.processFrame(makeFrame(i));
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return samples;
  }

  it('HOT p99 with COLD in-flight is not materially worse than control', () => {
    // ── Control: no API key, COLD path early-returns ──
    const control = new CoachingService();
    const controlSamples = measure(control, 100);
    const controlP99 = controlSamples[Math.floor(controlSamples.length * 0.99)];

    // ── Loaded: API key set, COLD path pending forever ──
    // Mock fetch so EVERY call returns a promise that never resolves during
    // the test, simulating a 5+ second cloud round-trip.
    globalThis.fetch = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        // We never resolve — afterEach will release on cleanup.
        pendingResolves.push(() => resolve(new Response('{}')));
      });
    }) as unknown as typeof globalThis.fetch;

    const loaded = new CoachingService();
    loaded.setApiKey('test-key');
    const loadedSamples = measure(loaded, 100);
    const loadedP99 = loadedSamples[Math.floor(loadedSamples.length * 0.99)];

    // eslint-disable-next-line no-console
    console.log(
      `[concurrent] controlP99=${controlP99.toFixed(3)}ms ` +
      `loadedP99=${loadedP99.toFixed(3)}ms ` +
      `delta=${(loadedP99 - controlP99).toFixed(3)}ms ` +
      `fetchCalls=${(globalThis.fetch as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0}`,
    );

    // Loaded p99 should be within 2x of control AND under 25ms absolute.
    // 25ms is half the 40ms inter-frame budget — well clear of the danger zone.
    expect(loadedP99).toBeLessThan(25);
    expect(loadedP99).toBeLessThan(controlP99 * 2 + 5);
  });
});
