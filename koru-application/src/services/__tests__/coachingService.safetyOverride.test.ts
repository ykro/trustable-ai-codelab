import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { CoachingDecision, TelemetryFrame } from '../../types';

/**
 * DR-6: Safety-override of humanization.
 *
 * Reviewer: under high-slip or high-speed-braking conditions the AI must
 * drop conversational pleasantries. A spin at 90 mph requires a sharp,
 * authoritative "Both feet in!"—not a polite suggestion.
 *
 * Override fires when:
 *  (a) Action is OVERSTEER_RECOVERY (always), OR
 *  (b) speed > 70 mph AND action is BRAKE-class (BRAKE, THRESHOLD,
 *      SPIKE_BRAKE, TRAIL_BRAKE).
 * In both cases the emitted text is the terse imperative from
 * SAFETY_OVERRIDE_TEXT, NOT the persona-inflected version.
 */
describe('CoachingService DR-6 safety-override of humanization', () => {
  let service: CoachingService;
  let decisions: CoachingDecision[];

  beforeEach(() => {
    service = new CoachingService();
    decisions = [];
    service.onCoaching(msg => decisions.push(msg));
  });

  const frame = (overrides: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
    time: 0, latitude: 0, longitude: 0,
    speed: 60, throttle: 50, brake: 0, gLat: 0, gLong: 0,
    ...overrides,
  });

  it('OVERSTEER_RECOVERY emits raw imperative regardless of speed', () => {
    // Trigger OVERSTEER_RECOVERY: |gLat|>0.7, gLong<-0.3, throttle<5, speed>40
    service.processFrame(frame({
      time: 0, speed: 50, throttle: 0, brake: 0, gLat: 0.9, gLong: -0.5,
    }));
    const d = decisions.find(x => x.action === 'OVERSTEER_RECOVERY');
    expect(d).toBeDefined();
    expect(d!.text).toBe('Both feet in!');
  });

  it('BRAKE-class action at >70mph emits raw imperative', () => {
    // THRESHOLD fires at brake>50 and gLong<-0.8 (BRAKE-class).
    service.processFrame(frame({
      time: 0, speed: 90, throttle: 0, brake: 80, gLat: 0.1, gLong: -1.0,
    }));
    const d = decisions.find(x => x.action === 'THRESHOLD');
    expect(d).toBeDefined();
    expect(d!.text).toBe('Brake hard!');
  });

  it('BRAKE-class action at <=70mph keeps humanization (control)', () => {
    // Same THRESHOLD condition, but at 40 mph.
    service.processFrame(frame({
      time: 0, speed: 40, throttle: 0, brake: 80, gLat: 0.1, gLong: -1.0,
    }));
    const d = decisions.find(x => x.action === 'THRESHOLD');
    expect(d).toBeDefined();
    // Default coach is super_aj; THRESHOLD humanization is non-empty and not the override text.
    expect(d!.text).not.toBe('Brake hard!');
    expect(d!.text.length).toBeGreaterThan(0);
  });

  it('non-safety action (PUSH) is humanized normally even at high speed', () => {
    // PUSH: throttle>80, |gLat|<0.3 — not BRAKE-class, override should not fire.
    service.processFrame(frame({
      time: 0, speed: 95, throttle: 90, brake: 0, gLat: 0.1, gLong: 0.05,
    }));
    const d = decisions.find(x => x.action === 'PUSH');
    expect(d).toBeDefined();
    expect(d!.text).not.toBe('Brake hard!');
    expect(d!.text).not.toBe('Both feet in!');
    expect(d!.text.length).toBeGreaterThan(0);
  });
});
