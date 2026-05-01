/**
 * FEEDFORWARD path — clustered-corner geometry test.
 *
 * BUG SURFACING: The previous audit noted that `findNearestCorner` in
 *   koru-application/src/services/coachingService.ts:658
 * picks the geometrically closest corner within 150m, with NO awareness of
 * heading or "is this corner ahead of me." For Sonoma's T1/T2/T3 cluster
 * (corners ~100m apart along the racing line) this collapses time-to-corner
 * (TTC) for the second and third corner: their feedforward only fires once
 * they become geometrically closer than the previous corner — i.e. roughly
 * the midpoint between them. At 60mph (~26.8 m/s) that midpoint is only
 * ~1.9s ahead, well below the 3.0s TTC budget for actionable advice.
 *
 * The fix would be a heading-aware "next corner ahead" predicate (project
 * each corner onto the driver's heading vector; reject corners behind).
 * That fix is NOT in scope for this PR. This test captures the bug as a
 * failing assertion.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoachingService } from '../coachingService';
import { CoachingQueue } from '../coachingQueue';
import type { TelemetryFrame, Track, CoachingDecision } from '../../types';

// Place a synthetic track at a benign lat so degree↔meter math is simple.
// At lat 0 (equator) and along a meridian, 1 deg latitude ≈ 110_540 m and
// longitude is constant => perfect straight-line approach.
const REF_LAT = 0;
const REF_LON = 0;
const M_PER_DEG_LAT = 110_540;

/** Convert a north-of-reference offset in meters to a latitude. */
function metersToLat(m: number): number {
  return REF_LAT + m / M_PER_DEG_LAT;
}

const C1_M = 0;
const C2_M = 100;
const C3_M = 200;

const SYNTH_TRACK: Track = {
  name: 'synthetic-cluster',
  length: 1000,
  sectors: [{ id: 1, name: 'S1', startDist: 0, endDist: 1000 }],
  corners: [
    {
      id: 1, name: 'C1', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: metersToLat(C1_M), lon: REF_LON, advice: 'C1 advice',
    },
    {
      id: 2, name: 'C2', entryDist: 100, apexDist: 100, exitDist: 100,
      lat: metersToLat(C2_M), lon: REF_LON, advice: 'C2 advice',
    },
    {
      id: 3, name: 'C3', entryDist: 200, apexDist: 200, exitDist: 200,
      lat: metersToLat(C3_M), lon: REF_LON, advice: 'C3 advice',
    },
  ],
  mapPoints: [],
  recordLap: 60,
};

const MPH_TO_MS = 0.44704;

describe('CoachingService clustered-corner FEEDFORWARD geometry', () => {
  let service: CoachingService;
  const fired: { corner: string; positionM: number; ttcSec: { c1: number; c2: number; c3: number } }[] = [];

  beforeEach(() => {
    service = new CoachingService();
    service.setTrack(SYNTH_TRACK);
    fired.length = 0;
  });

  it('each of C1/C2/C3 emits feedforward while still ahead, and at TTC >= 3.0s', () => {
    const speedMph = 60;
    const speedMs = speedMph * MPH_TO_MS;

    // Approach from -300m (south of C1) at 60mph along the meridian.
    // 25Hz => 0.04s per frame => speedMs * 0.04 ≈ 1.07m per frame.
    const STEP_M = speedMs * 0.04;
    const START_M = -300;
    const END_M = 250; // Drive past C3.

    // Capture per-feedforward fire: position when fired and per-corner TTC.
    type Fire = { corner: string; positionM: number; ttcC1: number; ttcC2: number; ttcC3: number };
    const fires: Fire[] = [];

    let currentPosM = START_M;
    // Spy on the queue's enqueue method — captures every feedforward decision
    // independent of whether the TimingGate lets it through to delivery.
    // The bug we're testing is geometric (which corner gets enqueued when),
    // not delivery throttling — so we observe at the enqueue layer.
    const enqueueSpy = vi.spyOn(CoachingQueue.prototype, 'enqueue');
    enqueueSpy.mockImplementation(function (this: CoachingQueue, msg: CoachingDecision) {
      if (msg.path === 'feedforward') {
        const cornerName = msg.text.split(':')[0];
        fires.push({
          corner: cornerName,
          positionM: currentPosM,
          ttcC1: (C1_M - currentPosM) / speedMs,
          ttcC2: (C2_M - currentPosM) / speedMs,
          ttcC3: (C3_M - currentPosM) / speedMs,
        });
      }
      // No-op: don't actually enqueue, to keep the test focused on
      // feedforward geometry without queue/timing-gate side effects.
    });

    let i = 0;
    const trace: { pos: number; nearestApprox: string }[] = [];
    for (let posM = START_M; posM <= END_M; posM += STEP_M, i++) {
      currentPosM = posM;
      const frame: TelemetryFrame = {
        time: i * 0.04,
        latitude: metersToLat(posM),
        longitude: REF_LON,
        speed: speedMph,
        throttle: 80,
        brake: 0,
        gLat: 0.05,
        gLong: 0.1,
      };
      service.processFrame(frame);
      // Record what *should* be nearest by raw geometry (ignoring 150m gate).
      const dC1 = Math.abs(posM - C1_M);
      const dC2 = Math.abs(posM - C2_M);
      const dC3 = Math.abs(posM - C3_M);
      const minD = Math.min(dC1, dC2, dC3);
      const nearestApprox = minD <= 150
        ? (minD === dC1 ? 'C1' : minD === dC2 ? 'C2' : 'C3')
        : 'none';
      if (i % 25 === 0) trace.push({ pos: posM, nearestApprox });
    }
    // eslint-disable-next-line no-console
    console.log(`[clustered] geometric-nearest trace:`, trace);

    // eslint-disable-next-line no-console
    console.log(
      `[clustered] feedforward fires (${fires.length}):`,
      fires.map(f =>
        `${f.corner}@pos=${f.positionM.toFixed(1)}m ` +
        `ttcC1=${f.ttcC1.toFixed(2)}s ttcC2=${f.ttcC2.toFixed(2)}s ttcC3=${f.ttcC3.toFixed(2)}s`,
      ),
    );

    const cornersFired = new Set(fires.map(f => f.corner));

    // Assertion 1: each corner emits at least once.
    expect(cornersFired.has('C1')).toBe(true);
    expect(cornersFired.has('C2')).toBe(true);
    expect(cornersFired.has('C3')).toBe(true);

    // Assertion 2: each fire happens while that corner is still AHEAD
    // (positionM <= corner's metric position).
    const cornerM: Record<string, number> = { C1: C1_M, C2: C2_M, C3: C3_M };
    for (const f of fires) {
      expect(f.positionM).toBeLessThanOrEqual(cornerM[f.corner] + 1); // 1m slack
    }

    // Assertion 3: TIME-TO-CORNER at fire moment must be >= 3.0s.
    // EXPECTED TO FAIL on C2 and C3 — see file header.
    // Bug location: koru-application/src/services/coachingService.ts:658
    //   `findNearestCorner` chooses geometrically closest with no heading
    //   awareness, so C2 only fires when driver crosses the C1–C2 midpoint
    //   (~50m past C1 ⇒ TTC to C2 is 50m / 26.8m·s⁻¹ ≈ 1.86s).
    // Recommended fix: a heading-aware "next corner ahead" predicate that
    //   projects (corner - position) onto the driver's heading vector and
    //   filters out corners behind.
    for (const f of fires) {
      const ttcOwn = (cornerM[f.corner] - f.positionM) / speedMs;
      // eslint-disable-next-line no-console
      if (ttcOwn < 3.0) {
        console.log(
          `[clustered] BUG: ${f.corner} fired with TTC=${ttcOwn.toFixed(2)}s ` +
          `(< 3.0s budget). See findNearestCorner in coachingService.ts.`,
        );
      }
      expect(ttcOwn).toBeGreaterThanOrEqual(3.0);
    }
  });
});
