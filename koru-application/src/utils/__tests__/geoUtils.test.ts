import { describe, it, expect } from 'vitest';
import { haversineDistance, calculateHeading, isValidGps } from '../../utils/geoUtils';

describe('haversineDistance', () => {
  it('should return 0 for the same point', () => {
    expect(haversineDistance(38.161, -122.455, 38.161, -122.455)).toBe(0);
  });

  it('should calculate a known distance between two Sonoma Raceway points', () => {
    const dist = haversineDistance(38.161, -122.455, 38.163, -122.457);
    expect(dist).toBeGreaterThan(250);
    expect(dist).toBeLessThan(300);
  });

  it('should be symmetric', () => {
    const ab = haversineDistance(38.161, -122.455, 38.163, -122.457);
    const ba = haversineDistance(38.163, -122.457, 38.161, -122.455);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

describe('calculateHeading', () => {
  it('should return ~0° for due North', () => {
    const heading = calculateHeading(38.0, -122.0, 39.0, -122.0);
    expect(heading).toBeCloseTo(0, 0);
  });

  it('should return ~90° for due East', () => {
    const heading = calculateHeading(38.0, -122.0, 38.0, -121.0);
    expect(heading).toBeCloseTo(90, 0);
  });

  it('should return ~180° for due South', () => {
    const heading = calculateHeading(39.0, -122.0, 38.0, -122.0);
    expect(heading).toBeCloseTo(180, 0);
  });

  it('should return ~270° for due West', () => {
    const heading = calculateHeading(38.0, -121.0, 38.0, -122.0);
    expect(heading).toBeCloseTo(270, 0);
  });
});

describe('isValidGps', () => {
  it('should reject NaN coordinates', () => {
    expect(isValidGps(NaN, -122.455)).toBe(false);
    expect(isValidGps(38.161, NaN)).toBe(false);
  });

  it('should reject null island (0, 0)', () => {
    expect(isValidGps(0, 0)).toBe(false);
  });

  it('should reject latitude > 90', () => {
    expect(isValidGps(91, -122.455)).toBe(false);
  });

  it('should reject longitude > 180', () => {
    expect(isValidGps(38.161, 181)).toBe(false);
  });

  it('should accept valid Sonoma Raceway coordinates', () => {
    expect(isValidGps(38.161, -122.455)).toBe(true);
  });
});
