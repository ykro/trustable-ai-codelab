import { describe, it, expect, beforeEach } from 'vitest';
import { CornerPhaseDetector } from '../cornerPhaseDetector';
import type { TelemetryFrame, Track } from '../../types';

function makeFrame(overrides: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    time: 0,
    latitude: 0,
    longitude: 0,
    speed: 60,
    throttle: 0,
    brake: 0,
    gLat: 0,
    gLong: 0,
    ...overrides,
  };
}

describe('CornerPhaseDetector', () => {
  let detector: CornerPhaseDetector;

  beforeEach(() => {
    detector = new CornerPhaseDetector();
  });

  describe('G-force fallback (no track set)', () => {
    it('should return STRAIGHT for low G, no brake, no throttle', () => {
      const result = detector.detect(makeFrame({ gLat: 0, brake: 0, throttle: 0, speed: 30 }));
      expect(result.phase).toBe('STRAIGHT');
      expect(result.cornerId).toBeNull();
    });

    it('should return MID_CORNER for high lateral G', () => {
      const result = detector.detect(makeFrame({ gLat: 0.8, brake: 5, throttle: 20 }));
      expect(result.phase).toBe('MID_CORNER');
    });

    it('should return BRAKE_ZONE for heavy braking with low lateral G', () => {
      const result = detector.detect(makeFrame({ brake: 50, gLat: 0.1 }));
      expect(result.phase).toBe('BRAKE_ZONE');
    });

    it('should return TURN_IN for moderate brake with moderate lateral G', () => {
      const result = detector.detect(makeFrame({ brake: 20, gLat: 0.4 }));
      expect(result.phase).toBe('TURN_IN');
    });

    it('should return EXIT for high lateral G with throttle and no brake', () => {
      const result = detector.detect(makeFrame({ gLat: 0.7, brake: 0, throttle: 50 }));
      expect(result.phase).toBe('EXIT');
    });

    it('should return ACCELERATION for high throttle, low lateral G, positive gLong', () => {
      const result = detector.detect(makeFrame({ throttle: 80, gLat: 0.1, gLong: 0.3 }));
      expect(result.phase).toBe('ACCELERATION');
    });
  });

  describe('GPS-based detection (with track)', () => {
    const minimalTrack: Track = {
      name: 'Test Track',
      length: 3000,
      sectors: [{ id: 1, name: 'S1', startDist: 0, endDist: 3000 }],
      corners: [
        {
          id: 1,
          name: 'Turn 1',
          entryDist: 100,
          apexDist: 200,
          exitDist: 300,
          lat: 38.161,
          lon: -122.455,
          advice: 'Brake before entry',
          entryLat: 38.1615,
          entryLon: -122.4555,
        },
      ],
      mapPoints: [{ x: 0, y: 0 }],
      recordLap: 90,
    };

    it('should detect BRAKE_ZONE or TURN_IN near corner entry', () => {
      detector.setTrack(minimalTrack);
      const result = detector.detect(makeFrame({
        latitude: 38.1615,
        longitude: -122.4555,
      }));
      expect(result.cornerId).toBe(1);
      expect(result.cornerName).toBe('Turn 1');
      expect(['BRAKE_ZONE', 'TURN_IN', 'MID_CORNER']).toContain(result.phase);
    });

    it('should return cornerId=null when no track is set', () => {
      const result = detector.detect(makeFrame({ gLat: 0.8 }));
      expect(result.cornerId).toBeNull();
    });
  });

  describe('GPS phase classification coverage (regression: each phase must be reachable)', () => {
    // Entry at (0,0), apex 55m north at (0.0005, 0). 0.0001 deg lat ≈ 11.13m.
    const track: Track = {
      name: 'Synthetic',
      length: 1000,
      sectors: [{ id: 1, name: 'S1', startDist: 0, endDist: 1000 }],
      corners: [
        {
          id: 42,
          name: 'Synth',
          entryDist: 100, apexDist: 200, exitDist: 300,
          entryLat: 0, entryLon: 0,
          lat: 0.0005, lon: 0,
          advice: '',
        },
      ],
      mapPoints: [{ x: 0, y: 0 }],
      recordLap: 60,
      center: { lat: 0, lng: 0 },
    };

    beforeEach(() => detector.setTrack(track));

    it('detects APEX at the apex point', () => {
      // Right on apex → distToApex ≈ 0.
      expect(detector.detect(makeFrame({ latitude: 0.0005, longitude: 0 })).phase).toBe('APEX');
    });

    it('detects MID_CORNER between entry and apex', () => {
      // Midway: distToEntry ≈ 27.8m, distToApex ≈ 27.8m → both <30 and <60.
      expect(detector.detect(makeFrame({ latitude: 0.00025, longitude: 0 })).phase).toBe('MID_CORNER');
    });

    it('detects TURN_IN near entry but far from apex', () => {
      // Just before entry (opposite side from apex): distToEntry ≈ 33m, distToApex ≈ 88m.
      expect(detector.detect(makeFrame({ latitude: -0.0003, longitude: 0 })).phase).toBe('TURN_IN');
    });

    it('detects EXIT past the apex', () => {
      // Just past apex: distToApex ≈ 22m (>15, <100), distToEntry ≈ 77m.
      expect(detector.detect(makeFrame({ latitude: 0.0007, longitude: 0 })).phase).toBe('EXIT');
    });

    it('detects BRAKE_ZONE well before entry', () => {
      // Approach: distToEntry ≈ 89m, distToApex ≈ 145m. Within detection window via distToEntry<200.
      expect(detector.detect(makeFrame({ latitude: -0.0008, longitude: 0 })).phase).toBe('BRAKE_ZONE');
    });
  });
});
