import { describe, it, expect, beforeEach } from 'vitest';
import { DriverModel } from '../driverModel';
import { TelemetryFrame } from '../../types';

describe('DriverModel', () => {
  let model: DriverModel;

  beforeEach(() => {
    model = new DriverModel();
  });

  const createFrame = (speed: number, throttle: number, brake: number): TelemetryFrame => ({
    timestamp: Date.now(),
    lat: 0,
    lon: 0,
    speed,
    heading: 0,
    throttle,
    brake,
    gLat: 0,
    gLon: 0
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
    model.update(createFrame(50, 100, 0));
    model.update(createFrame(50, 100, 0));
    const state = model.getState();
    expect(state.coastingRatio).toBeGreaterThanOrEqual(0);
  });
});