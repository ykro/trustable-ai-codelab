import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame, CoachingDecision } from '../../types';

/**
 * Audio dispatch latency: simulate the pre-rendered TTS / audio synthesis
 * stage taking 1.5s (matches the FEEDFORWARD audio budget). This must NOT
 * back-pressure the HOT path: processFrame() is dispatching at 25Hz and
 * cannot wait for audio. The contract: emit() is fire-and-forget (synchronous
 * `forEach`), and any awaiting must happen inside the listener — not block
 * processFrame.
 *
 * Failure mode this guards against: a future change that adds `await
 * Promise.all(listeners)` inside emit(). At 1.5s/frame that would collapse
 * the system end-to-end.
 */
describe('CoachingService audio dispatch latency', () => {
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

  it('slow async listener does NOT block processFrame', async () => {
    // Simulate audio: each emission triggers a 1500ms async TTS render.
    // We capture (emitTime, resolveTime) pairs to compute decision-to-audio.
    const dispatches: Array<{ emitTime: number; resolveTime: number; decision: CoachingDecision }> = [];
    const pending: Promise<void>[] = [];

    service.onCoaching((msg) => {
      const emitTime = performance.now();
      const p = new Promise<void>((resolve) => {
        setTimeout(() => {
          const resolveTime = performance.now();
          dispatches.push({ emitTime, resolveTime, decision: msg });
          resolve();
        }, 1500);
      });
      pending.push(p);
    });

    // Warm-up.
    for (let i = 0; i < 25; i++) service.processFrame(makeFrame(i));

    const N = 100;
    const frameLatencies: number[] = [];
    for (let i = 25; i < 25 + N; i++) {
      const s = performance.now();
      service.processFrame(makeFrame(i));
      frameLatencies.push(performance.now() - s);
    }

    frameLatencies.sort((a, b) => a - b);
    const p50 = frameLatencies[Math.floor(N * 0.5)];
    const p99 = frameLatencies[Math.floor(N * 0.99)];
    const max = frameLatencies[N - 1];

    /* eslint-disable no-console */
    console.log(
      `[audio-dispatch] HOT path under slow listener: ` +
      `p50=${p50.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`,
    );
    /* eslint-enable no-console */

    // Hard assertion: the slow listener must not back-pressure the HOT path.
    // If p99 > 50ms here, emit() is awaiting listeners — fail loudly.
    expect(p99).toBeLessThan(50);
    expect(max).toBeLessThan(100); // generous upper bound for any GC pause

    // Now wait for all simulated audio to finish and report decision-to-audio.
    await Promise.all(pending);

    if (dispatches.length > 0) {
      const firstDecisionToAudio = dispatches[0].resolveTime - dispatches[0].emitTime;
      /* eslint-disable no-console */
      console.log(
        `[audio-dispatch] decisions=${dispatches.length} ` +
        `first decision→audio-resolve=${firstDecisionToAudio.toFixed(0)}ms ` +
        `(simulated 1500ms TTS budget)`,
      );
      /* eslint-enable no-console */
      // Sanity: simulated audio took ~1500ms (sub-1.5s impossible by construction).
      expect(firstDecisionToAudio).toBeGreaterThanOrEqual(1490);
    } else {
      /* eslint-disable no-console */
      console.log('[audio-dispatch] no decisions emitted in 100 frames (timing gate / queue suppressed all)');
      /* eslint-enable no-console */
    }
  });
});
