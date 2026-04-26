import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseTelemetryCSV } from '../utils/telemetryParser';
import { CornerPhaseDetector } from '../services/cornerPhaseDetector';
import { CoachingService } from '../services/coachingService';
import { SONOMA_TEST_TRACK } from './fixtures/sonomaTrackData';
import type { CoachingDecision } from '../types';

describe('Sonoma CSV Replay Integration', () => {
  const csvPath = resolve(__dirname, 'fixtures/sonoma-excerpt.csv');
  const csvText = readFileSync(csvPath, 'utf-8');

  it('should parse the Sonoma CSV without errors', () => {
    const frames = parseTelemetryCSV(csvText);
    expect(frames.length).toBeGreaterThanOrEqual(25);
    // Verify key fields are parsed
    expect(frames[0].speed).toBeGreaterThan(0);
    expect(frames[0].latitude).toBeCloseTo(38.162, 2);
    expect(frames[0].longitude).toBeCloseTo(-122.455, 2);
  });

  it('should detect corner phases from G-forces in the CSV', () => {
    const frames = parseTelemetryCSV(csvText);
    const detector = new CornerPhaseDetector();
    // No track set — uses G-force fallback

    const phases = frames.map(f => detector.detect(f).phase);

    // Early frames are straight/acceleration (high throttle, low gLat)
    expect(phases[0]).toBe('STRAIGHT');

    // Mid frames should detect braking or cornering
    const hasBraking = phases.some(p => p === 'BRAKE_ZONE');
    const hasCornering = phases.some(p => p === 'MID_CORNER' || p === 'TURN_IN');
    expect(hasBraking || hasCornering).toBe(true);
  });

  it('should fire at least one coaching action during replay', () => {
    const frames = parseTelemetryCSV(csvText);
    const service = new CoachingService();
    const decisions: CoachingDecision[] = [];

    service.onCoaching(msg => decisions.push(msg));

    for (const frame of frames) {
      service.processFrame(frame);
    }

    expect(decisions.length).toBeGreaterThan(0);
    // All decisions should have required fields
    for (const d of decisions) {
      expect(d.text).toBeTruthy();
      expect(d.path).toBeTruthy();
      expect(typeof d.priority).toBe('number');
    }
  });

  it('should detect corner phases when track data is provided', () => {
    const frames = parseTelemetryCSV(csvText);
    const detector = new CornerPhaseDetector();
    detector.setTrack(SONOMA_TEST_TRACK);

    const detections = frames.map(f => detector.detect(f));

    // With Sonoma track data and GPS coords near Turn 1, should identify the corner
    const withCorner = detections.filter(d => d.cornerId !== null);
    expect(withCorner.length).toBeGreaterThan(0);
    // Should identify Turn 1 (lat ~38.1618, lon ~-122.4555)
    const turn1 = withCorner.find(d => d.cornerId === 1);
    expect(turn1).toBeDefined();
  });
});
