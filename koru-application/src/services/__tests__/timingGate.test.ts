import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TimingGate } from '../timingGate';

describe('TimingGate', () => {
  let gate: TimingGate;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    gate = new TimingGate();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start in OPEN state', () => {
    expect(gate.getState()).toBe('OPEN');
    expect(gate.canDeliver(3)).toBe(true);
  });

  it('should transition to BLACKOUT during MID_CORNER or APEX', () => {
    gate.update('MID_CORNER');
    expect(gate.getState()).toBe('BLACKOUT');
    expect(gate.canDeliver(3)).toBe(false);

    gate.update('APEX');
    expect(gate.getState()).toBe('BLACKOUT');
    expect(gate.canDeliver(3)).toBe(false);
  });

  it('should recover from BLACKOUT to OPEN in straightaways', () => {
    // Trigger blackout
    gate.update('MID_CORNER');
    expect(gate.getState()).toBe('BLACKOUT');

    // Update with STRAIGHT phase immediately
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('OPEN');
    expect(gate.canDeliver(3)).toBe(true);
  });

  it('should transition to DELIVERING, then COOLDOWN, then OPEN based on time', () => {
    gate.startDelivery();
    expect(gate.getState()).toBe('DELIVERING');

    // Advance past delivery duration (default 2000ms)
    vi.setSystemTime(3000);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('COOLDOWN');
    expect(gate.canDeliver(3)).toBe(false);

    // Advance past cooldown duration (default 1500ms -> total 3500ms since start)
    vi.setSystemTime(4500);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('OPEN');
  });

  it('should resume COOLDOWN (not OPEN) after a BLACKOUT interrupts cooldown', () => {
    // Start delivery at t=1000
    gate.startDelivery();
    // Finish delivery → COOLDOWN at t=3000 (default deliveryMs=2000)
    vi.setSystemTime(3000);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('COOLDOWN');

    // Driver enters apex at t=3500 — still inside cooldown (ends at 4500).
    vi.setSystemTime(3500);
    gate.update('APEX');
    expect(gate.getState()).toBe('BLACKOUT');

    // Exits apex at t=3800 — cooldown hasn't elapsed yet, must NOT snap to OPEN.
    vi.setSystemTime(3800);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('COOLDOWN');
    expect(gate.canDeliver(3)).toBe(false);

    // Once real cooldown window elapses (t=4500+), gate reopens.
    vi.setSystemTime(4500);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('OPEN');
    expect(gate.canDeliver(3)).toBe(true);
  });

  it('should restore to OPEN after BLACKOUT interrupts OPEN', () => {
    expect(gate.getState()).toBe('OPEN');
    gate.update('MID_CORNER');
    expect(gate.getState()).toBe('BLACKOUT');
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('OPEN');
  });

  it('P0 safety messages bypass BLACKOUT and COOLDOWN', () => {
    gate.update('APEX');
    expect(gate.getState()).toBe('BLACKOUT');
    expect(gate.canDeliver(0)).toBe(true);
    expect(gate.canDeliver(1)).toBe(false);
  });

  it('P0 re-entry during DELIVERING anchors the cooldown to the new message', () => {
    // First P0 starts delivering at t=1000.
    gate.startDelivery();
    expect(gate.getState()).toBe('DELIVERING');

    // 500ms later a second P0 preempts (e.g., OVERSTEER while BRAKE is speaking).
    vi.setSystemTime(1500);
    gate.startDelivery();
    expect(gate.getState()).toBe('DELIVERING');

    // The original deliveryMs window from t=1000 ends at t=3000 — but
    // because the new message reset the anchor, the gate must remain
    // DELIVERING until t=3500 (1500 + 2000), not reopen at t=3000.
    vi.setSystemTime(3000);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('DELIVERING');

    vi.setSystemTime(3500);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('COOLDOWN');

    // And cooldown ends 1500ms after that, anchored to the second message.
    vi.setSystemTime(5000);
    gate.update('STRAIGHT');
    expect(gate.getState()).toBe('OPEN');
  });
});