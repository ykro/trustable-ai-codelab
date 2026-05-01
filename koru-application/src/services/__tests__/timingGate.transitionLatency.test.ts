import { describe, it, expect } from 'vitest';
import { TimingGate } from '../timingGate';
import type { CornerPhase } from '../../types';

/**
 * TimingGate state-machine cost must be negligible. It runs every frame at
 * 25Hz and is also called inside the queue's dequeue path, so any quadratic
 * or allocation-heavy behavior would show up here as a >µs-per-call slip.
 *
 * We cycle the full state machine (OPEN → DELIVERING → COOLDOWN → OPEN →
 * BLACKOUT → OPEN) over 10000 iterations using REAL wall-clock timing.
 * Bound: < 100µs per update() average — i.e. < 10ms total.
 */
describe('TimingGate transition latency', () => {
  it('10000 update() cycles complete in well under 1ms each', () => {
    const gate = new TimingGate({
      cooldownMs: 0,
      deliveryMs: 0,
    });

    // Cycle: STRAIGHT (OPEN) → startDelivery → STRAIGHT (DELIVERING/COOLDOWN drain) → MID_CORNER (BLACKOUT) → STRAIGHT (restore)
    const phases: CornerPhase[] = ['STRAIGHT', 'BRAKE_ZONE', 'TURN_IN', 'MID_CORNER', 'APEX', 'EXIT', 'ACCELERATION'];

    // Warm up.
    for (let i = 0; i < 1000; i++) {
      gate.update(phases[i % phases.length]);
      if (i % 5 === 0) gate.startDelivery();
      gate.canDeliver(3);
    }

    const N = 10000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      gate.update(phases[i % phases.length]);
      if (i % 5 === 0) gate.startDelivery();
      gate.canDeliver((i % 4) as 0 | 1 | 2 | 3);
    }
    const elapsed = performance.now() - start;
    const perCallMicros = (elapsed * 1000) / N;

    // eslint-disable-next-line no-console
    console.log(
      `[transition] N=${N} total=${elapsed.toFixed(3)}ms ` +
      `perCall=${perCallMicros.toFixed(2)}µs`,
    );

    // 100µs per call → 1ms for 10 calls. Generous on slow CI (×10 of typical).
    expect(perCallMicros).toBeLessThan(100);
  });
});
