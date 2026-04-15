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
});
