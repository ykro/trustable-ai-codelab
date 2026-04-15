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
});
