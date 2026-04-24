import { describe, it, expect, beforeEach } from 'vitest';
import { DriverModel } from '../driverModel';
import type { TelemetryFrame } from '../../types';

describe('DriverModel', () => {
  let model: DriverModel;

  beforeEach(() => {
    model = new DriverModel();
  });

  const createFrame = (time: number, speed: number, throttle: number, brake: number): TelemetryFrame => ({
    time,
    latitude: 0,
    longitude: 0,
    speed,
    throttle,
    brake,
    gLat: 0,
    gLong: 0,
  });

  it('should start as BEGINNER', () => {
    expect(model.getState().skillLevel).toBe('BEGINNER');
  });

  it('should adapt based on skill via external components, but correctly report state', () => {
    const beginnerState = model.getState();
    expect(beginnerState.skillLevel).toBe('BEGINNER');
    expect(beginnerState.inputSmoothness).toBeGreaterThan(0);
  });

  it('should record frames and calculate smoothness', () => {
    // Just a basic test to ensure update works without throwing
    model.update(createFrame(0.0, 50, 100, 0));
    model.update(createFrame(0.1, 50, 100, 0));
    const state = model.getState();
    expect(state.coastingRatio).toBeGreaterThanOrEqual(0);
  });

  // ── Classification ─────────────────────────────────────

  // Smooth driver: throttle alternates 50/55 → all deltas = 5 → variance = 0 → smoothness = 1.
  // No coasting (throttle always >= 50, brake = 0 means brake < 10 but throttle < 10 is false).
  const smoothFrame = (t: number) => createFrame(t, 60, t % 0.4 < 0.2 ? 50 : 55, 0);

  // Erratic driver: throttle AND brake both swing 10↔90, producing delta variance in both
  // channels. With only one channel varying, smoothness tops out around 0.68 (see the
  // variance math in driverModel.computeSmoothness). Making both channels noisy pushes
  // smoothness below the 0.4 BEGINNER threshold. Not coasting (throttle ≥ 10).
  const erraticFrame = (t: number, i: number) =>
    createFrame(t, 60, i % 4 < 2 ? 10 : 90, i % 4 < 2 ? 90 : 10);

  it('classifies a smooth-input driver with no coasting as ADVANCED', () => {
    // Classification starts once throttleDeltas ≥ 20 (frame 21, t ≈ 4.0s). Hysteresis is 5s,
    // so the earliest promotion is t ≈ 9.0s. Feed 60 frames @ 0.2s → t = 0..11.8s.
    for (let i = 0; i < 60; i++) model.update(smoothFrame(i * 0.2));
    expect(model.getState().inputSmoothness).toBeGreaterThan(0.9);
    expect(model.getState().coastingRatio).toBe(0);
    expect(model.getSkillLevel()).toBe('ADVANCED');
  });

  it('stays BEGINNER when inputs are erratic (delta variance high)', () => {
    for (let i = 0; i < 60; i++) model.update(erraticFrame(i * 0.2, i));
    expect(model.getState().inputSmoothness).toBeLessThan(0.5);
    expect(model.getSkillLevel()).toBe('BEGINNER');
  });

  it('classifies as BEGINNER when coasting ratio > 30%', () => {
    // Alternate coasting frames (throttle=5, brake=0) with driving frames.
    for (let i = 0; i < 60; i++) {
      model.update(createFrame(i * 0.2, 60, i % 2 === 0 ? 5 : 50, 0));
    }
    expect(model.getState().coastingRatio).toBeGreaterThan(0.3);
    expect(model.getSkillLevel()).toBe('BEGINNER');
  });

  // ── Hysteresis ─────────────────────────────────────────

  it('does not promote until HYSTERESIS_DURATION_S (5s) of consistent classification', () => {
    // Feed ADVANCED-worthy input for just under (MIN_SAMPLES/5Hz + 5s) — should stay BEGINNER.
    // Frames through i=40 → t = 0..8.0s. First classification at t≈4.0, so candidate has only
    // ~4 seconds of consistency — below the 5s threshold.
    for (let i = 0; i < 40; i++) model.update(smoothFrame(i * 0.2));
    expect(model.getSkillLevel()).toBe('BEGINNER');

    // Keep feeding — now t crosses 9s, hysteresis elapsed → ADVANCED.
    for (let i = 40; i < 55; i++) model.update(smoothFrame(i * 0.2));
    expect(model.getSkillLevel()).toBe('ADVANCED');
  });

  it('does not promote a candidate that matches the already-current level (no spurious re-promotion)', () => {
    // Promote to ADVANCED.
    for (let i = 0; i < 60; i++) model.update(smoothFrame(i * 0.2));
    expect(model.getSkillLevel()).toBe('ADVANCED');

    // Inject a brief erratic burst — candidate flips to BEGINNER.
    for (let i = 60; i < 63; i++) model.update(erraticFrame(i * 0.2, i));
    // Then back to smooth — candidate returns to ADVANCED (matching currentLevel).
    // Without the guard, stale candidateStartTime from the first ADVANCED run would allow
    // instant re-promotion into BEGINNER on next erratic burst. Guard prevents that.
    for (let i = 63; i < 70; i++) model.update(smoothFrame(i * 0.2));
    expect(model.getSkillLevel()).toBe('ADVANCED');
  });
});
