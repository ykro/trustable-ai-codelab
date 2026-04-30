import { describe, it, expect, beforeEach } from 'vitest';
import {
  CoachingService,
  FEEDFORWARD_LEAD_S,
  TTS_BUDGET_S,
  MIN_TRIGGER_M,
  MPH_TO_MPS,
  getTriggerDistance,
} from '../coachingService';
import type { CoachingDecision, TelemetryFrame, Corner, Track } from '../../types';

// ── Helpers ────────────────────────────────────────────────

const createFrame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  time: 0,
  latitude: 38.16,
  longitude: -122.45,
  speed: 0,
  throttle: 0,
  brake: 0,
  gLat: 0,
  gLong: 0,
  ...overrides,
});

/** Place a corner exactly `metresNorth` metres north of (carLat, carLon). */
function cornerNorthOfCar(
  metresNorth: number,
  carLat: number,
  carLon: number,
  base: Partial<Corner> = {},
): Corner {
  // 1 deg lat ≈ 111_320 m
  const dLat = metresNorth / 111_320;
  return {
    id: 1,
    name: 'Turn X',
    entryDist: 0,
    apexDist: 0,
    exitDist: 0,
    lat: carLat + dLat,
    lon: carLon,
    advice: 'commit to the line',
    ...base,
  };
}

function trackWithCorners(corners: Corner[], center = { lat: 38.16, lng: -122.45 }): Track {
  return {
    name: 'Synthetic',
    length: 1000,
    sectors: [{ id: 1, name: 'S1', startDist: 0, endDist: 1000 }],
    corners,
    mapPoints: [{ x: 0, y: 0 }],
    recordLap: 60,
    center,
  };
}

// ── DR-1: velocity-scaled geofence ─────────────────────────

describe('DR-1 getTriggerDistance', () => {
  it('returns 0 when stationary so FEEDFORWARD does not fire at idle', () => {
    expect(getTriggerDistance(0)).toBe(0);
    expect(getTriggerDistance(-5)).toBe(0);
    expect(getTriggerDistance(NaN)).toBe(0);
  });

  it('clamps to MIN_TRIGGER_M floor at very low (non-zero) speed', () => {
    // 5 mph * 0.44704 * 4.5 ≈ 10m — well below the 40m floor.
    expect(getTriggerDistance(5)).toBe(MIN_TRIGGER_M);
  });

  it('scales linearly with velocity at speed', () => {
    const total = FEEDFORWARD_LEAD_S + TTS_BUDGET_S; // 4.5s
    // 30 mph ≈ 60.4m, 60 mph ≈ 120.7m, 100 mph ≈ 201.2m
    const expected30 = 30 * MPH_TO_MPS * total;
    const expected60 = 60 * MPH_TO_MPS * total;
    const expected100 = 100 * MPH_TO_MPS * total;
    expect(getTriggerDistance(30)).toBeCloseTo(expected30, 4);
    expect(getTriggerDistance(60)).toBeCloseTo(expected60, 4);
    expect(getTriggerDistance(100)).toBeCloseTo(expected100, 4);
    // Sanity: ±10% of the lecture-style numbers in the DR-1 spec.
    expect(getTriggerDistance(30)).toBeGreaterThan(60 * 0.9);
    expect(getTriggerDistance(30)).toBeLessThan(60 * 1.1);
    expect(getTriggerDistance(60)).toBeGreaterThan(120 * 0.9);
    expect(getTriggerDistance(60)).toBeLessThan(120 * 1.1);
    expect(getTriggerDistance(100)).toBeGreaterThan(200 * 0.9);
    expect(getTriggerDistance(100)).toBeLessThan(200 * 1.1);
  });
});

describe('DR-1 FEEDFORWARD geofence — fires only inside scaled radius', () => {
  let service: CoachingService;
  let decisions: CoachingDecision[];
  const carLat = 38.16;
  const carLon = -122.45;

  beforeEach(() => {
    service = new CoachingService();
    decisions = [];
    service.onCoaching(msg => decisions.push(msg));
  });

  it('does NOT fire when stationary, even with a corner 100m away', () => {
    const corner = cornerNorthOfCar(100, carLat, carLon, { name: 'Turn Idle' });
    service.setTrack(trackWithCorners([corner]));
    service.processFrame(createFrame({ speed: 0, latitude: carLat, longitude: carLon }));
    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeUndefined();
  });

  it('30 mph fires for a corner ~55m ahead but not for one ~100m ahead', () => {
    // At 30 mph trigger ≈ 60m (±10%): 55m inside, 100m outside.
    const inside = cornerNorthOfCar(55, carLat, carLon, { id: 1, name: 'Turn Inside' });
    const outside = cornerNorthOfCar(100, carLat, carLon, { id: 2, name: 'Turn Outside' });

    service.setTrack(trackWithCorners([outside, inside]));
    service.processFrame(createFrame({
      speed: 30, latitude: carLat, longitude: carLon,
    }));

    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeDefined();
    expect(ff!.text).toContain('Turn Inside');
    expect(ff!.text).not.toContain('Turn Outside');
  });

  it('60 mph fires for a corner ~110m ahead (was outside the legacy 150m too, but inside the velocity-scaled 121m)', () => {
    const corner = cornerNorthOfCar(110, carLat, carLon, { name: 'Turn 60' });
    service.setTrack(trackWithCorners([corner]));
    service.processFrame(createFrame({
      speed: 60, latitude: carLat, longitude: carLon,
    }));
    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeDefined();
    expect(ff!.text).toContain('Turn 60');
  });

  it('100 mph fires for a corner ~190m ahead (would have been outside the legacy 150m fence)', () => {
    const corner = cornerNorthOfCar(190, carLat, carLon, { name: 'Turn 100' });
    service.setTrack(trackWithCorners([corner]));
    service.processFrame(createFrame({
      speed: 100, latitude: carLat, longitude: carLon,
    }));
    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeDefined();
    expect(ff!.text).toContain('Turn 100');
  });

  it('100 mph does NOT fire for a corner ~250m ahead (still outside scaled radius)', () => {
    const corner = cornerNorthOfCar(250, carLat, carLon, { name: 'Turn Far' });
    service.setTrack(trackWithCorners([corner]));
    service.processFrame(createFrame({
      speed: 100, latitude: carLat, longitude: carLon,
    }));
    const ff = decisions.find(d => d.path === 'feedforward');
    expect(ff).toBeUndefined();
  });

  // MIN_TRIGGER_M floor coverage:
  // The pure helper test above (getTriggerDistance(5) === MIN_TRIGGER_M) already
  // verifies the floor in isolation. An integration test at very low speed is
  // tricky because the CornerPhaseDetector classifies a corner ~30m away as
  // MID_CORNER → TimingGate BLACKOUT for a BEGINNER, suppressing emission for
  // unrelated reasons. So we assert the floor at the helper boundary instead,
  // and verify here that *without* the floor the trigger would collapse to 0:
  it('without the MIN_TRIGGER_M floor, 5 mph would yield <40m of geofence', () => {
    const unscaledMetres = 5 * MPH_TO_MPS * (FEEDFORWARD_LEAD_S + TTS_BUDGET_S);
    expect(unscaledMetres).toBeLessThan(MIN_TRIGGER_M);
    expect(getTriggerDistance(5)).toBe(MIN_TRIGGER_M);
  });
});
