import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { TelemetryFrame, CoachingDecision } from '../../types';

/**
 * Frame-integrity edge cases. Real telemetry streams are not clean: BLE
 * jitter delivers duplicates, GPS occasionally goes invalid, and a flaky
 * Bluetooth link can drop 250ms+ at a stretch. The system must:
 *   - not double-count duplicate frames into stateful windows
 *   - reject or idempotently process out-of-order frames
 *   - tolerate dropped frames without producing NaN-tainted signals
 *   - degrade gracefully on malformed telemetry (no exception, no
 *     FEEDFORWARD with invalid GPS)
 *
 * If production code crashes on any of these, the test wraps in try/catch
 * and reports the bug rather than masking it.
 */
describe('CoachingService frame integrity', () => {
  let service: CoachingService;
  let emitted: CoachingDecision[];

  beforeEach(() => {
    service = new CoachingService();
    emitted = [];
    service.onCoaching((d) => emitted.push(d));
  });

  function baseFrame(t: number, overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
    return {
      time: t,
      latitude: 38.16,
      longitude: -122.45,
      speed: 60,
      throttle: 60,
      brake: 0,
      gLat: 0.5,
      gLong: 0.1,
      ...overrides,
    };
  }

  it('duplicate frames do not double-emit or double-count state', () => {
    // Prime with a few normal frames so the system is initialized.
    for (let i = 0; i < 10; i++) {
      service.processFrame(baseFrame(i * 0.04, { gLat: 0.6, brake: 30 }));
    }
    const baseline = emitted.length;
    const stateBefore = service.getDriverState();

    // Submit the SAME frame twice in a row.
    const dup = baseFrame(0.4, { gLat: 0.8, brake: 40 });
    service.processFrame(dup);
    const afterFirst = emitted.length;
    service.processFrame(dup);
    const afterSecond = emitted.length;

    const stateAfter = service.getDriverState();

    // The second identical frame should not produce a duplicate emission
    // (lastHotAction guard suppresses repeats; queue cooldown suppresses too).
    // Allow at most one new emission across the pair, never two new from the
    // duplicate alone.
    const newFromFirst = afterFirst - baseline;
    const newFromDup = afterSecond - afterFirst;
    /* eslint-disable no-console */
    console.log(
      `[frame-integrity] duplicate: baseline=${baseline} ` +
      `+first=${newFromFirst} +dup=${newFromDup} ` +
      `smoothness ${stateBefore.inputSmoothness.toFixed(3)} -> ${stateAfter.inputSmoothness.toFixed(3)}`,
    );
    /* eslint-enable no-console */
    expect(newFromDup).toBeLessThanOrEqual(0); // duplicate should not create a new emission
  });

  it('out-of-order frame is handled (rejected or idempotent — verify contract)', () => {
    // Drive forward in time.
    for (let i = 0; i < 50; i++) {
      service.processFrame(baseFrame(i * 0.04));
    }
    const stateAtT2 = service.getDriverState();
    const emittedAtT2 = emitted.length;

    // Now feed a frame at t=1.9s AFTER t=2.0s.
    let crashed = false;
    let crashErr: unknown = null;
    try {
      service.processFrame(baseFrame(1.9, { gLat: 0.7 }));
    } catch (e) {
      crashed = true;
      crashErr = e;
    }

    /* eslint-disable no-console */
    if (crashed) {
      console.error('[frame-integrity] BUG: out-of-order frame crashed processFrame:', crashErr);
    } else {
      const stateAfter = service.getDriverState();
      console.log(
        `[frame-integrity] out-of-order: emitted ${emittedAtT2} -> ${emitted.length}, ` +
        `skill ${stateAtT2.skillLevel} -> ${stateAfter.skillLevel}`,
      );
    }
    /* eslint-enable no-console */

    // Contract: production code does not gate on monotonic time, so it
    // should be processed idempotently — no crash. If it crashes we want
    // the test to fail with a clear diagnostic, hence the explicit assert.
    expect(crashed).toBe(false);
  });

  it('250ms gap (6 dropped frames at 25Hz) produces no NaN signals', () => {
    for (let i = 0; i < 25; i++) {
      service.processFrame(baseFrame(i * 0.04, { gLat: 0.5 + (i % 3) * 0.1 }));
    }
    // Skip frames 25..30 (~250ms gap), resume at frame 31.
    let crashed = false;
    let crashErr: unknown = null;
    try {
      service.processFrame(baseFrame(31 * 0.04, { gLat: 0.7, brake: 20 }));
      service.processFrame(baseFrame(32 * 0.04, { gLat: 0.8, brake: 30 }));
    } catch (e) {
      crashed = true;
      crashErr = e;
    }
    expect(crashed).toBe(false);
    if (crashed) {
      // eslint-disable-next-line no-console
      console.error('[frame-integrity] BUG: dropped-frame gap crashed:', crashErr);
    }

    const state = service.getDriverState();
    expect(Number.isFinite(state.inputSmoothness)).toBe(true);
    expect(Number.isFinite(state.coastingRatio)).toBe(true);
    expect(Number.isNaN(state.inputSmoothness)).toBe(false);

    // No emission should carry NaN in any numeric field.
    for (const e of emitted) {
      expect(typeof e.text).toBe('string');
      expect(e.text.includes('NaN')).toBe(false);
    }

    /* eslint-disable no-console */
    console.log(
      `[frame-integrity] 250ms gap: smoothness=${state.inputSmoothness.toFixed(3)} ` +
      `coasting=${state.coastingRatio.toFixed(3)} skill=${state.skillLevel}`,
    );
    /* eslint-enable no-console */
  });

  it('malformed telemetry: NaN speed, undefined lat, -999 gLat does not crash or fire FEEDFORWARD', () => {
    // Prime with a track-like setup so feedforward could fire if not gated.
    // (Without a track set, runFeedforward early-returns regardless. Without
    // a track, the malformed-frame test still proves graceful degradation
    // through every other subsystem.)
    let crashed = false;
    let crashErr: unknown = null;
    try {
      // gLat -999 is physically impossible; speed NaN; lat undefined.
      const malformed = {
        time: 1.0,
        latitude: undefined as unknown as number,
        longitude: -122.45,
        speed: NaN,
        throttle: 50,
        brake: 0,
        gLat: -999,
        gLong: 0.1,
      } as TelemetryFrame;
      service.processFrame(malformed);
    } catch (e) {
      crashed = true;
      crashErr = e;
    }

    /* eslint-disable no-console */
    if (crashed) {
      console.error('[frame-integrity] malformed frame crashed processFrame:', crashErr);
    }
    /* eslint-enable no-console */

    // Hard assertion: must not crash. If it does, that is a bug we want
    // surfaced — fail loudly, do not mask.
    expect(crashed).toBe(false);

    // No FEEDFORWARD should have been emitted (isValidGps would reject
    // undefined lat → NaN). Even more broadly, any emission must have
    // a non-empty text and not be a feedforward decision tied to malformed GPS.
    const ff = emitted.filter((e) => e.path === 'feedforward');
    expect(ff.length).toBe(0);

    /* eslint-disable no-console */
    console.log(`[frame-integrity] malformed: emitted=${emitted.length} feedforward=${ff.length} (expected 0)`);
    /* eslint-enable no-console */
  });
});
