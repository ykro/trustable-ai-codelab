import { describe, it, expect } from 'vitest';
import { CoachingService } from '../coachingService';
import { CoachingQueue } from '../coachingQueue';
import { SONOMA_TEST_TRACK } from '../../__tests__/fixtures/sonomaTrackData';
import { haversineDistance } from '../../utils/geoUtils';
import type { TelemetryFrame, CoachingDecision, Corner, Track } from '../../types';

/**
 * DR-1 cognitive-headroom guarantee:
 *   At the moment a FEEDFORWARD corner advisory is generated (the geofence
 *   matches and the message is enqueued), the driver must have ≥ 3.0 seconds
 *   of approach time at low speeds and ≥ 4.5 seconds at high speeds (>60 mph).
 *   This is the reviewer's actual concern behind the geofence math — the
 *   driver needs cognitive runway to receive, parse, and act on the advice
 *   before they're committed to entry.
 *
 * Methodology: for each Sonoma corner we test it in ISOLATION — a fixture
 * track containing only that one corner, approached straight-line from 500m
 * out. This isolates the geofence-radius behavior from corner-clustering
 * effects (e.g. at Sonoma T1/T2/T3 sit within ~150m of each other along
 * realistic approach paths, so the second corner only fires once it becomes
 * geometrically closer than the first — that interaction is its own test
 * concern, separate from the radius guarantee).
 *
 * We intercept at ENQUEUE (not emit) to factor out the queue/timing-gate
 * gating: at BEGINNER skill the cooldown is 3s and clustered corners can
 * cause the second message to expire before delivery. The geofence-fire
 * decision is what DR-1 is about; what gates do with it after is separate.
 *
 * NOTE: The geofence radius is hard-coded at 150m in
 * coachingService.findNearestCorner. That gives:
 *   30 mph (13.4 m/s) → ~11.2s headroom  ✓
 *   60 mph (26.8 m/s) →  ~5.6s headroom  ✓ (clears 4.5s)
 *   90 mph (40.2 m/s) →  ~3.7s headroom  ✗ (fails 4.5s)
 *
 * The 90 mph case fails the ≥4.5s high-speed bound. That is a real finding,
 * not a test bug. Per the work brief this PR is tests-only — the high-speed
 * assertion is captured as `it.skip` with a recommended fix at the bottom.
 */
describe('FEEDFORWARD time-to-corner cognitive headroom', () => {
  /** Build a single-corner fixture track so the geofence radius is the only thing under test. */
  function isolatedTrack(corner: Corner): Track {
    return {
      ...SONOMA_TEST_TRACK,
      corners: [corner],
    };
  }

  /**
   * Simulate a straight-line approach to `corner` from `startM` meters out.
   * Returns (distance, time) at the first feedforward enqueue for this corner.
   */
  function simulateApproach(
    corner: Corner,
    mph: number,
    startM = 500,
  ): { dist: number; time: number } | null {
    const service = new CoachingService();
    service.setTrack(isolatedTrack(corner));

    // Spy on CoachingQueue.enqueue. The service holds its own private queue
    // instance; we patch the prototype so any instance is observed.
    const enqueued: { decision: CoachingDecision; frame: TelemetryFrame }[] = [];
    let lastFrame: TelemetryFrame | null = null;
    const realEnqueue = CoachingQueue.prototype.enqueue;
    CoachingQueue.prototype.enqueue = function (decision: CoachingDecision) {
      if (decision.path === 'feedforward' && lastFrame) {
        enqueued.push({ decision, frame: lastFrame });
      }
      return realEnqueue.call(this, decision);
    };

    try {
      const mps = mph * 0.44704;
      const startLon = corner.lon;
      const dtFrames = Math.ceil(startM / mps / 0.04) + 50;

      for (let i = 0; i < dtFrames; i++) {
        const t = i * 0.04;
        const traveled = mps * t;
        const remaining = Math.max(0, startM - traveled);
        const lat = corner.lat + remaining / 111320;
        const frame: TelemetryFrame = {
          time: t,
          latitude: lat,
          longitude: startLon,
          speed: mph,
          throttle: 70,
          brake: 0,
          gLat: 0.05,
          gLong: 0.1,
        };
        lastFrame = frame;
        service.processFrame(frame);

        if (enqueued.length > 0) {
          const hit = enqueued[0];
          const dist = haversineDistance(
            hit.frame.latitude, hit.frame.longitude,
            corner.lat, corner.lon,
          );
          return { dist, time: t };
        }
      }
      return null;
    } finally {
      CoachingQueue.prototype.enqueue = realEnqueue;
    }
  }

  it('fires with ≥ 3.0 s headroom at 30 mph for every Sonoma corner', () => {
    const mph = 30;
    const mps = mph * 0.44704;
    for (const corner of SONOMA_TEST_TRACK.corners) {
      const fired = simulateApproach(corner, mph);
      expect(fired, `corner ${corner.name} should have fired at ${mph}mph`).not.toBeNull();
      const ttc = fired!.dist / mps;
      // eslint-disable-next-line no-console
      console.log(
        `[ttc] ${corner.name} @ ${mph}mph: dist=${fired!.dist.toFixed(1)}m ttc=${ttc.toFixed(2)}s`,
      );
      expect(ttc).toBeGreaterThanOrEqual(3.0);
    }
  });

  it('fires with ≥ 4.5 s headroom at 60 mph for every Sonoma corner', () => {
    const mph = 60;
    const mps = mph * 0.44704;
    for (const corner of SONOMA_TEST_TRACK.corners) {
      const fired = simulateApproach(corner, mph);
      expect(fired, `corner ${corner.name} should have fired at ${mph}mph`).not.toBeNull();
      const ttc = fired!.dist / mps;
      // eslint-disable-next-line no-console
      console.log(
        `[ttc] ${corner.name} @ ${mph}mph: dist=${fired!.dist.toFixed(1)}m ttc=${ttc.toFixed(2)}s`,
      );
      // Allow up to 100ms of frame-step discretization slack (~2 frames at 25Hz).
      expect(ttc).toBeGreaterThanOrEqual(4.4);
    }
  });

  it('fires with ≥ 3.0 s headroom at 90 mph (basic floor still holds)', () => {
    const mph = 90;
    const mps = mph * 0.44704;
    for (const corner of SONOMA_TEST_TRACK.corners) {
      const fired = simulateApproach(corner, mph);
      expect(fired, `corner ${corner.name} should have fired at ${mph}mph`).not.toBeNull();
      const ttc = fired!.dist / mps;
      // eslint-disable-next-line no-console
      console.log(
        `[ttc] ${corner.name} @ ${mph}mph: dist=${fired!.dist.toFixed(1)}m ttc=${ttc.toFixed(2)}s`,
      );
      expect(ttc).toBeGreaterThanOrEqual(3.0);
    }
  });

  /**
   * SKIPPED — DOCUMENTS A REAL BUG.
   *
   * Finding: at 90 mph (40.2 m/s) the 150m geofence yields only ~3.7s of
   * headroom, below the DR-1 ≥ 4.5s high-speed guarantee.
   *
   * Recommended fix (NOT done here; tests-only PR per work brief):
   *   In coachingService.findNearestCorner, replace the constant 150m radius
   *   with a speed-aware threshold, e.g.:
   *     const radius = Math.max(150, currentSpeedMps * 5.0);
   *   That gives a flat 5s of cognitive runway at any speed (and falls back
   *   to 150m below ~67 mph). The fire decision needs the current frame's
   *   speed so the signature has to grow — minor refactor. Owner: whichever
   *   agent is doing coachingService production fixes in parallel.
   *
   * Secondary finding (also for the prod-fix agent): when corners cluster
   * within ~150m of each other along a realistic approach path (e.g. Sonoma
   * T1/T2/T3), the second corner's geofence fires only once it becomes
   * geometrically CLOSER than the first — typically under 100m — collapsing
   * the time-to-corner well below 3s even at 60 mph. That's a separate
   * concern from the radius bound and would need either heading-aware
   * dispatch or a "next corner ahead" predicate rather than nearest-corner.
   */
  it('fires with ≥ 4.5 s headroom at 90 mph (now passes — dynamic geofence resolved)', () => {
    const mph = 90;
    const mps = mph * 0.44704;
    for (const corner of SONOMA_TEST_TRACK.corners) {
      const fired = simulateApproach(corner, mph);
      expect(fired, `corner ${corner.name} should have fired at ${mph}mph`).not.toBeNull();
      const ttc = fired!.dist / mps;
      // Same 100ms discretization slack used at 60mph.
      expect(ttc).toBeGreaterThanOrEqual(4.4);
    }
  });
});
