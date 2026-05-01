import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame } from '../../types';

/**
 * COLD-path recovery: after a network/fetch failure, the next frame must
 * retry rather than waiting out the full coldCooldownMs (15-20s by default).
 *
 * The contract is implemented in CoachingService.runColdPath: on `catch`
 * (network error) or `!res.ok` (HTTP 5xx), `this.lastColdTime = 0` is set
 * so the cooldown check on the NEXT frame allows another attempt. If that
 * reset ever regresses, an offline → back-online transition would burn
 * 15+ seconds of silence — exactly the kind of bug latency tests should catch.
 *
 * Strategy: fail the first fetch synchronously (throw), then resolve
 * subsequent fetches. Drive frames at 25Hz and assert that the second fetch
 * happens within 2 frames (≤80ms) of the first failure.
 */
describe('CoachingService COLD path recovery', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as { fetch?: unknown }).fetch;
    vi.restoreAllMocks();
  });

  function makeFrame(i: number): TelemetryFrame {
    const t = i * 0.04;
    return {
      time: t,
      latitude: 38.16 + i * 0.000001,
      longitude: -122.45 + i * 0.000001,
      speed: 75,
      throttle: 70,
      brake: 0,
      gLat: 0.1,
      gLong: 0.2,
    };
  }

  it('recovers within 2 frames after a fetch failure', async () => {
    let firstFailureAt = -1;
    let firstSuccessAt = -1;
    let frameCounter = 0;

    globalThis.fetch = vi.fn(async () => {
      const callIndex = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      if (callIndex === 1) {
        // First call: synchronous throw
        firstFailureAt = frameCounter;
        throw new Error('simulated network failure');
      }
      // Subsequent calls: succeed
      if (firstSuccessAt === -1) firstSuccessAt = frameCounter;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const service = new CoachingService();
    service.setApiKey('test-key');

    // Suppress unhandled console.error from the catch path so test output is clean.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Drive frames at 25Hz simulated (no real sleep — we just need to invoke
    // processFrame in sequence and let the microtask queue drain between).
    for (let i = 0; i < 25; i++) {
      frameCounter = i;
      service.processFrame(makeFrame(i));
      // Yield to microtasks so the await fetch() (and its catch) can run
      // before the next frame fires. This mimics the ~40ms inter-frame gap.
      await Promise.resolve();
      await Promise.resolve();
    }

    // eslint-disable-next-line no-console
    console.log(
      `[coldRecovery] firstFailureAt=frame${firstFailureAt} ` +
      `firstSuccessAt=frame${firstSuccessAt} ` +
      `gap=${firstSuccessAt - firstFailureAt} frames`,
    );

    expect(firstFailureAt).toBeGreaterThanOrEqual(0);
    expect(firstSuccessAt).toBeGreaterThan(firstFailureAt);
    // ≤ 2 frame gap = ≤ 80ms at 25Hz.
    expect(firstSuccessAt - firstFailureAt).toBeLessThanOrEqual(2);

    errSpy.mockRestore();
  });
});
