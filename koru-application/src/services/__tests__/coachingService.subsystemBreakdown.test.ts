import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import { DriverModel } from '../driverModel';
import { CornerPhaseDetector } from '../cornerPhaseDetector';
import { CoachingQueue } from '../coachingQueue';
import { DECISION_MATRIX } from '../../utils/coachingKnowledge';
import type { TelemetryFrame } from '../../types';

/**
 * Subsystem latency breakdown for the HOT path.
 *
 * Goal: when overall processFrame() latency creeps up, this test points at
 * which subsystem to look at. We wrap the call sites OF the relevant
 * collaborators with vi.spyOn-style instrumentation that does NOT change
 * production code — we replace prototype methods with timing wrappers, run
 * 1000 frames, then restore. The decision-matrix scan is timed by replaying
 * the same rule loop externally (cannot wrap a private method without
 * touching production code).
 *
 * Per-subsystem p99 sum should not exceed 1.5x total processFrame p99,
 * otherwise our measurement overhead is dominating and the numbers are noise.
 */
describe('CoachingService HOT path subsystem breakdown', () => {
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

  function pct(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
  }

  it('breaks down per-subsystem p50/p99/max over 1000 frames', () => {
    const driverSamples: number[] = [];
    const cornerSamples: number[] = [];
    const decisionSamples: number[] = [];
    const queueSamples: number[] = [];
    const humanizeSamples: number[] = [];
    const totalSamples: number[] = [];

    // Wrap DriverModel.update on the prototype.
    const dmProto = DriverModel.prototype as unknown as {
      update: (f: TelemetryFrame) => void;
    };
    const origDmUpdate = dmProto.update;
    dmProto.update = function (frame: TelemetryFrame) {
      const s = performance.now();
      const r = origDmUpdate.call(this, frame);
      driverSamples.push(performance.now() - s);
      return r;
    };

    // Wrap CornerPhaseDetector.detect on the prototype.
    const cpdProto = CornerPhaseDetector.prototype as unknown as {
      detect: (f: TelemetryFrame) => unknown;
    };
    const origCpdDetect = cpdProto.detect;
    cpdProto.detect = function (frame: TelemetryFrame) {
      const s = performance.now();
      const r = origCpdDetect.call(this, frame);
      cornerSamples.push(performance.now() - s);
      return r;
    };

    // Wrap CoachingQueue.enqueue on the prototype (insertion + sort cost).
    const cqProto = CoachingQueue.prototype as unknown as {
      enqueue: (d: unknown) => unknown;
    };
    const origCqEnqueue = cqProto.enqueue;
    cqProto.enqueue = function (decision: unknown) {
      const s = performance.now();
      const r = origCqEnqueue.call(this, decision);
      queueSamples.push(performance.now() - s);
      return r;
    };

    try {
      // Warm-up to settle JIT.
      for (let i = 0; i < 50; i++) service.processFrame(makeFrame(i));
      // Reset arrays after warm-up so warm-up cost doesn't pollute the percentiles.
      driverSamples.length = 0;
      cornerSamples.length = 0;
      queueSamples.length = 0;

      const N = 1000;
      for (let i = 50; i < 50 + N; i++) {
        const frame = makeFrame(i);

        // Time the decision-matrix scan externally (cannot reach the private
        // method without changing production code; replay the same rule loop
        // contract here so the cost is representative — DECISION_MATRIX is
        // the same module-level array the production code iterates).
        const decStart = performance.now();
        for (const rule of DECISION_MATRIX) {
          rule.check(frame);
        }
        decisionSamples.push(performance.now() - decStart);

        // Time the humanizeAction call site externally via a probe action.
        // We can't reach the private method directly, so we measure the
        // closest analogue: the timing-gate / driver-model-derived persona
        // computation that humanize relies on. Use getCoach() + getDriverState()
        // as a cheap proxy — both are called inside humanize.
        const humStart = performance.now();
        service.getCoach();
        service.getDriverState();
        humanizeSamples.push(performance.now() - humStart);

        const totStart = performance.now();
        service.processFrame(frame);
        totalSamples.push(performance.now() - totStart);
      }
    } finally {
      dmProto.update = origDmUpdate;
      cpdProto.detect = origCpdDetect;
      cqProto.enqueue = origCqEnqueue;
    }

    const summary = (label: string, arr: number[]) => ({
      label,
      n: arr.length,
      p50: pct(arr, 0.5),
      p99: pct(arr, 0.99),
      max: arr.length ? Math.max(...arr) : 0,
    });

    const dm = summary('DriverModel.update', driverSamples);
    const cpd = summary('CornerPhaseDetector.detect', cornerSamples);
    const dec = summary('DecisionMatrix.scan', decisionSamples);
    const cq = summary('CoachingQueue.enqueue', queueSamples);
    const hum = summary('humanize-proxy', humanizeSamples);
    const tot = summary('processFrame.total', totalSamples);

    // Surface the breakdown so a regression has a fingerprint.
    /* eslint-disable no-console */
    console.log('[subsystem breakdown]');
    [dm, cpd, dec, cq, hum, tot].forEach(s => {
      console.log(
        `  ${s.label.padEnd(30)} n=${s.n} ` +
        `p50=${s.p50.toFixed(4)}ms p99=${s.p99.toFixed(4)}ms max=${s.max.toFixed(4)}ms`,
      );
    });
    /* eslint-enable no-console */

    const subsystemP99Sum = dm.p99 + cpd.p99 + dec.p99 + cq.p99;
    // Bound: subsystem-p99 sum vs total-p99. If wrapping overhead were huge,
    // the sum would balloon. 1.5x slack accounts for noise + GC jitter.
    expect(subsystemP99Sum).toBeLessThan(tot.p99 * 1.5 + 5); // +5ms absolute slack on tiny CIs

    // Sanity: nothing should be wildly slow.
    expect(dm.p99).toBeLessThan(15);
    expect(cpd.p99).toBeLessThan(15);
    expect(dec.p99).toBeLessThan(15);
    expect(cq.p99).toBeLessThan(15);
  });
});
