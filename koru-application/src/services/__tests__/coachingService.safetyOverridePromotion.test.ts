import { describe, it, expect, beforeEach } from 'vitest';
import { CoachingService } from '../coachingService';
import type { CoachingDecision, TelemetryFrame } from '../../types';

/**
 * Audit B2: BRAKE-class actions under DR-6 safety override must be promoted
 * to P0 so they bypass the TimingGate MID_CORNER blackout.
 *
 * The DR-6 override produces the right *text* ("Brake hard!") for THRESHOLD
 * and SPIKE_BRAKE at high speed, but ACTION_PRIORITY keeps them at P1.
 * In the BEGINNER timing config MID_CORNER and APEX are blackout phases,
 * so a P1 message in those phases is silenced — the driver gets nothing
 * while over-braking at 90 mph mid-corner. We promote the priority to 0
 * exactly when the override fires, so the override message reaches the
 * listener via preempt() instead of being silenced.
 *
 * Also covered: TRAIL_BRAKE is NOT a BRAKE-class action — trail braking is
 * a deliberate technique. The override must not engage for it, so the
 * persona-inflected text is preserved.
 */
describe('Audit B2 — safety override priority promotion', () => {
  let service: CoachingService;
  let decisions: CoachingDecision[];

  beforeEach(() => {
    service = new CoachingService();
    decisions = [];
    service.onCoaching(msg => decisions.push(msg));
  });

  /** Drive the CornerPhaseDetector into MID_CORNER (G-force fallback path).
   *  At |gLat| > 0.5 with throttle ≤ 30, the detector returns MID_CORNER and
   *  the TimingGate (BEGINNER config) enters BLACKOUT.  We feed several frames
   *  with no GPS movement so there is no track-based override path. */
  function drivePastIntoMidCorner(): void {
    for (let i = 0; i < 5; i++) {
      // gLat triggers MID_CORNER via the G-force fallback, but throttle=10
      // keeps OVERSTEER_RECOVERY from matching (it requires throttle < 5).
      // brake stays 0 here so DECISION_MATRIX rules don't fire and steal P0.
      service.processFrame({
        time: i * 0.04,
        latitude: 38.16,
        longitude: -122.45,
        speed: 60,
        throttle: 10,
        brake: 0,
        gLat: 0.9,
        gLong: 0,
      });
    }
    decisions.length = 0;
  }

  it('THRESHOLD at 90 mph during MID_CORNER blackout is promoted to P0 and reaches the listener', () => {
    drivePastIntoMidCorner();

    // THRESHOLD rule: brake > 50 && gLong < -0.8.
    // Speed 90 mph > 70 mph high-speed threshold → safety override engaged.
    // throttle = 10 keeps OVERSTEER from matching first.
    // gLat = 0.9 keeps the detector in MID_CORNER → BLACKOUT.
    service.processFrame({
      time: 1.0,
      latitude: 38.16,
      longitude: -122.45,
      speed: 90,
      throttle: 10,
      brake: 80,
      gLat: 0.9,
      gLong: -1.0,
    });

    const threshold = decisions.find(d => d.action === 'THRESHOLD');
    expect(threshold).toBeDefined();
    expect(threshold!.priority).toBe(0);
    expect(threshold!.text).toBe('Brake hard!');
  });

  it('THRESHOLD at 50 mph during MID_CORNER blackout stays P1 and IS silenced', () => {
    drivePastIntoMidCorner();

    // Same THRESHOLD condition but speed 50 mph < 70 mph threshold —
    // safety override does NOT engage, priority stays at P1, blackout silences it.
    service.processFrame({
      time: 1.0,
      latitude: 38.16,
      longitude: -122.45,
      speed: 50,
      throttle: 10,
      brake: 80,
      gLat: 0.9,
      gLong: -1.0,
    });

    const threshold = decisions.find(d => d.action === 'THRESHOLD');
    expect(threshold).toBeUndefined();
  });

  it('TRAIL_BRAKE at 90 mph does NOT bypass humanization (persona text preserved)', () => {
    // BEGINNER suppresses TRAIL_BRAKE in session phase 1, so we wait past 60s
    // to enter session phase 2 where TRAIL_BRAKE is allowed.
    // We also want NO blackout for this test so the message can be observed
    // via the listener — keep gLat low enough that the detector returns
    // BRAKE_ZONE rather than MID_CORNER.
    const f = (overrides: Partial<TelemetryFrame>): TelemetryFrame => ({
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

    // Warm up past session phase 1 (>60s) so TRAIL_BRAKE is not suppressed.
    service.processFrame(f({ time: 61, speed: 60 }));

    // TRAIL_BRAKE rule: brake > 10 && |gLat| > 0.4.
    // Speed 90 mph > 70 mph threshold — would hit safety override IF
    // TRAIL_BRAKE were in BRAKE_CLASS_ACTIONS. Audit B2 says it is NOT.
    service.processFrame(f({
      time: 62,
      speed: 90,
      throttle: 0,
      brake: 30,
      gLat: 0.5,
      gLong: -0.2,
    }));

    const trail = decisions.find(d => d.action === 'TRAIL_BRAKE');
    expect(trail).toBeDefined();
    // Persona-inflected text — NOT the override imperative.
    expect(trail!.text).not.toBe('Brake hard!');
    expect(trail!.text.length).toBeGreaterThan(0);
    // Priority should remain P1 (not promoted to P0).
    expect(trail!.priority).toBe(1);
  });

  it('shouldBypassHumanization returns false for TRAIL_BRAKE at any speed', () => {
    const frame: TelemetryFrame = {
      time: 0, latitude: 0, longitude: 0,
      speed: 120, throttle: 0, brake: 50,
      gLat: 0.5, gLong: -0.5,
    };
    expect(service.shouldBypassHumanization('TRAIL_BRAKE', frame)).toBe(false);
  });

  it('shouldBypassHumanization remains true for BRAKE/THRESHOLD/SPIKE_BRAKE above the threshold', () => {
    const frame: TelemetryFrame = {
      time: 0, latitude: 0, longitude: 0,
      speed: 90, throttle: 0, brake: 50,
      gLat: 0, gLong: -0.5,
    };
    expect(service.shouldBypassHumanization('BRAIL' as never, frame)).toBe(false); // sanity: unknown is false
    expect(service.shouldBypassHumanization('BRAKE', frame)).toBe(true);
    expect(service.shouldBypassHumanization('THRESHOLD', frame)).toBe(true);
    expect(service.shouldBypassHumanization('SPIKE_BRAKE', frame)).toBe(true);
  });
});
