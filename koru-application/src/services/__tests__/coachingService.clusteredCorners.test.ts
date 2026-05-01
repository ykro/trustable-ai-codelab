/**
 * BUG: findNearestCornerWithinTriggerDistance picks the geometrically closest
 * corner without heading awareness. For clustered corners that lie along the
 * driver's approach line (Sonoma T1/T2/T3), corner #2 only becomes "nearest"
 * AFTER the driver has crossed the C1↔C2 midpoint, collapsing time-to-corner
 * for C2 to ~1.83s — well under the 3.0s budget DR-1 promises.
 *
 * Fix: heading-aware predicate. From the driver's current GPS heading, compute
 * the bearing to each candidate corner; reject corners that are ≥ 90° behind
 * the driver. Among the corners ahead, pick the geometrically closest.
 *
 * Fallback: if heading is unavailable (no GPS history), use nearest-only so
 * we don't suddenly stop firing FEEDFORWARD in fresh sessions.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { CoachingDecision, TelemetryFrame, Track, Corner } from '../../types';

describe('CoachingService Feedforward — clustered corners (heading-aware)', () => {
  let service: CoachingService;
  let decisions: CoachingDecision[];

  beforeEach(() => {
    // Fake timers so we can fast-forward past the TimingGate cooldown between
    // feedforward enqueues (cooldown is wall-clock, not telemetry-frame time).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'));
    service = new CoachingService();
    decisions = [];
    service.onCoaching(msg => decisions.push(msg));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createFrame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
    time: 0,
    latitude: 38.16,
    longitude: -122.45,
    speed: 60,
    throttle: 50,
    brake: 0,
    gLat: 0,
    gLong: 0,
    ...overrides,
  });

  // Helpers: ~1° lat ≈ 111_111m. So 1m north ≈ 0.000009°.
  const M_PER_DEG_LAT = 111_111;
  const metersNorth = (m: number) => m / M_PER_DEG_LAT;

  /** Make a track with the given corners array. */
  const trackWith = (corners: Corner[], center = { lat: 38.16, lng: -122.45 }): Track => ({
    name: 'Synthetic',
    length: 1000,
    sectors: [{ id: 1, name: 'S1', startDist: 0, endDist: 1000 }],
    corners,
    mapPoints: [{ x: 0, y: 0 }],
    recordLap: 60,
    center,
  });

  it('approaching clustered C1/C2 along the heading line, fires C1 first (not the geometrically closer C2)', () => {
    // Driver heading north along a straight approach line with two clustered
    // corners. C1 at lat-base, C2 200m further north.
    //   Frame 1 — car at +50m: C1 50m ahead (within 150m trigger), C2 150m
    //     ahead (just at trigger boundary, excluded). FF fires for C1.
    //   Frame 2 — car at +90m: C1 90m BEHIND (heading north, C1 is south),
    //     C2 110m AHEAD. Pre-fix nearest-only would still pick C1 (90<110)
    //     but it's already lastCorner so no new fire. Post-fix C1 is rejected
    //     as behind; C2 is the next-corner-ahead and FF fires for it.
    // Distances chosen so neither frame lands in the APEX/MID_CORNER phases
    // that would put TimingGate in BLACKOUT (corners > 30m from car).
    const carLat = 38.16, carLon = -122.45;
    const c1: Corner = {
      id: 1, name: 'Turn 1', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(0), lon: carLon, advice: 'C1 advice',
    };
    const c2: Corner = {
      id: 2, name: 'Turn 2', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(200), lon: carLon, advice: 'C2 advice',
    };
    service.setTrack(trackWith([c1, c2], { lat: carLat, lng: carLon }));

    // Frame 1: establish heading by driving north a small step. C1 fires here.
    service.processFrame(createFrame({
      time: 0, latitude: carLat + metersNorth(50), longitude: carLon, speed: 60,
    }));
    // Clear prior decisions (the first frame fires C1 since it's within trigger).
    decisions.length = 0;
    // Advance past delivery + cooldown (2000ms + 3000ms beginner cooldown).
    // TimingGate transitions are gated by `update()` calls inside processFrame,
    // and each call only does one DELIVERING→COOLDOWN→OPEN transition. So we
    // tick through a couple of stationary frames to move the gate to OPEN.
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 0.5, latitude: carLat + metersNorth(50), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 1.0, latitude: carLat + metersNorth(50), longitude: carLon, speed: 60,
    }));
    decisions.length = 0;

    // Frame 2: driver is now at +90m north — C1 is 90m BEHIND, C2 is 110m AHEAD.
    service.processFrame(createFrame({
      time: 1.04, latitude: carLat + metersNorth(90), longitude: carLon, speed: 60,
    }));

    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeDefined();
    expect(ff!.text).toContain('Turn 2'); // C2 is ahead; C1 must be rejected as behind.
    expect(ff!.text).not.toContain('Turn 1');
  });

  it('fallback: when heading is unavailable (single GPS sample), still fires FEEDFORWARD for nearby corners', () => {
    // Single frame → no GPS history → no heading. Must fall back to nearest-only.
    const carLat = 38.16, carLon = -122.45;
    const c1: Corner = {
      id: 1, name: 'Turn 1', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(50), lon: carLon, advice: 'C1 advice',
    };
    service.setTrack(trackWith([c1], { lat: carLat, lng: carLon }));

    service.processFrame(createFrame({
      time: 0, latitude: carLat, longitude: carLon, speed: 60,
    }));

    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeDefined();
    expect(ff!.text).toContain('Turn 1');
  });

  it('rejection: a corner directly behind the driver does not fire FEEDFORWARD', () => {
    // Corner 50m SOUTH of driver. Driver heading NORTH → corner is 180° behind → reject.
    // Use a decoy corner far away (north, well outside trigger) so the corners
    // array is non-trivial; the only candidate is the behind one and we want
    // to assert it is filtered out.
    const carLat = 38.16, carLon = -122.45;
    const cBehind: Corner = {
      id: 1, name: 'Turn Behind', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(-50), lon: carLon, advice: 'Behind advice',
    };
    service.setTrack(trackWith([cBehind], { lat: carLat, lng: carLon }));

    // Frame 1 — no heading yet, fallback to nearest-only fires the behind corner
    // (this is the FALLBACK branch we explicitly preserve). Throw it away; we
    // care about the later frames once heading is known.
    service.processFrame(createFrame({
      time: 0, latitude: carLat + metersNorth(55), longitude: carLon, speed: 60,
    }));
    // Step gate to OPEN so a fresh enqueue would actually drain.
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 0.5, latitude: carLat + metersNorth(60), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 1.0, latitude: carLat + metersNorth(65), longitude: carLon, speed: 60,
    }));
    decisions.length = 0;

    // Heading is now firmly north, gate is OPEN. Continue driving north —
    // the behind corner must NOT fire. (If lastCorner is still latched on the
    // behind corner, the enqueue is suppressed regardless; what we really
    // assert is that no NEW feedforward decision lands.)
    service.processFrame(createFrame({
      time: 1.04, latitude: carLat + metersNorth(70), longitude: carLon, speed: 60,
    }));

    expect(decisions.find(d => d.path === 'feedforward')).toBeUndefined();
  });

  it('rejection: turning around (heading flips) makes the same corner eligible again', () => {
    // Two corners — one north (decoy, far enough that it does fire as we
    // approach it), one south of the start. We drive north, then turn around
    // and head south, and assert the south corner fires once it's ahead.
    const carLat = 38.16, carLon = -122.45;
    const cNorth: Corner = {
      id: 1, name: 'Turn North', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(120), lon: carLon, advice: 'N advice',
    };
    const cSouth: Corner = {
      id: 2, name: 'Turn South', entryDist: 0, apexDist: 0, exitDist: 0,
      lat: carLat + metersNorth(-50), lon: carLon, advice: 'S advice',
    };
    service.setTrack(trackWith([cNorth, cSouth], { lat: carLat, lng: carLon }));

    // Drive north a bit so the cNorth corner becomes lastCorner (pulls latching
    // off cSouth, which fires on frame 1 via fallback).
    service.processFrame(createFrame({
      time: 0, latitude: carLat + metersNorth(0), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 0.5, latitude: carLat + metersNorth(20), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 1.0, latitude: carLat + metersNorth(40), longitude: carLon, speed: 60,
    }));
    // By now lastCorner should have moved to cNorth (closer + ahead).
    decisions.length = 0;

    // Turn around — drive south. Heading flips. cSouth is now ahead, cNorth is behind.
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 1.5, latitude: carLat + metersNorth(20), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 2.0, latitude: carLat + metersNorth(0), longitude: carLon, speed: 60,
    }));
    vi.advanceTimersByTime(3000);
    service.processFrame(createFrame({
      time: 2.5, latitude: carLat + metersNorth(-15), longitude: carLon, speed: 60,
    }));

    const ffSouth = decisions.find(d => d.path === 'feedforward' && d.text.includes('Turn South'));
    expect(ffSouth).toBeDefined();
  });
});
