import { describe, it, expect } from 'vitest';
import { DECISION_MATRIX } from '../../utils/coachingKnowledge';

describe('DECISION_MATRIX', () => {
  it('should have OVERSTEER_RECOVERY as the first rule (safety priority)', () => {
    expect(DECISION_MATRIX[0].action).toBe('OVERSTEER_RECOVERY');
  });

  it('OVERSTEER_RECOVERY fires on high lateral G with decel and no throttle', () => {
    const rule = DECISION_MATRIX.find((r) => r.action === 'OVERSTEER_RECOVERY')!;
    expect(rule.check({ gLat: 0.8, gLong: -0.4, throttle: 3, speed: 50, brake: 0 })).toBe(true);
  });

  it('THRESHOLD fires on heavy braking with strong decel', () => {
    const rule = DECISION_MATRIX.find((r) => r.action === 'THRESHOLD')!;
    expect(rule.check({ brake: 60, gLong: -0.9, throttle: 0, gLat: 0, speed: 80 })).toBe(true);
  });

  it('TRAIL_BRAKE fires on light braking while cornering', () => {
    const rule = DECISION_MATRIX.find((r) => r.action === 'TRAIL_BRAKE')!;
    expect(rule.check({ brake: 20, gLat: 0.5, throttle: 0, gLong: -0.3, speed: 60 })).toBe(true);
  });

  it('COAST fires when no throttle and no brake at speed', () => {
    const rule = DECISION_MATRIX.find((r) => r.action === 'COAST')!;
    expect(rule.check({ throttle: 5, brake: 5, speed: 70, gLat: 0, gLong: 0 })).toBe(true);
  });

  it('DONT_BE_A_WUSS fires on heavy braking at low speed', () => {
    const rule = DECISION_MATRIX.find((r) => r.action === 'DONT_BE_A_WUSS')!;
    expect(rule.check({ brake: 50, speed: 40, throttle: 0, gLat: 0, gLong: -0.5 })).toBe(true);
  });

  it('each rule check returns a boolean', () => {
    const frame = { brake: 30, throttle: 30, gLat: 0.3, gLong: -0.2, speed: 60 };
    for (const rule of DECISION_MATRIX) {
      expect(typeof rule.check(frame)).toBe('boolean');
    }
  });
});
