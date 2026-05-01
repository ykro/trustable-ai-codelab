import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoachingQueue } from '../coachingQueue';
import { TimingGate } from '../timingGate';
import type { CoachingDecision } from '../../types';

/**
 * Stale-message expiry — boundary precision.
 *
 * Contract: messages expire after 3000ms. The implementation uses
 *   `now - timestamp < STALE_MS`
 * so at exactly 3000ms a message IS stale (boundary excluded).
 *
 * We use vi.useFakeTimers + vi.setSystemTime to control Date.now() at
 * millisecond precision — this is the one place in the latency suite where
 * mocked time is appropriate, because we are testing the time-arithmetic
 * itself (sleeping 3000ms in real wall-clock would flake on CI). All other
 * latency tests in this directory use real `performance.now()`.
 */
describe('CoachingQueue stale-message expiry boundary', () => {
  let queue: CoachingQueue;
  let gate: TimingGate;

  function makeMsg(timestamp: number): CoachingDecision {
    return {
      path: 'hot',
      action: 'BRAKE',
      text: 'Brake',
      priority: 2,
      cornerPhase: 'STRAIGHT',
      timestamp,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    queue = new CoachingQueue();
    // cooldownMs/deliveryMs=0 so the gate stays OPEN for non-P0 messages.
    gate = new TimingGate({ cooldownMs: 0, deliveryMs: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a message dequeued at t=2999ms (just inside the 3s window)', () => {
    queue.enqueue(makeMsg(0));
    vi.setSystemTime(2999);
    const msg = queue.dequeue(gate, 'STRAIGHT');
    expect(msg).not.toBeNull();
    expect(msg?.action).toBe('BRAKE');
  });

  it('rejects a message dequeued at t=3000ms (boundary is exclusive in the impl)', () => {
    queue.enqueue(makeMsg(0));
    vi.setSystemTime(3000);
    const msg = queue.dequeue(gate, 'STRAIGHT');
    // Implementation: `now - timestamp < STALE_MS` ⇒ 3000 < 3000 is false ⇒ dropped.
    expect(msg).toBeNull();
  });

  it('rejects a message dequeued at t=3001ms (well past the 3s window)', () => {
    queue.enqueue(makeMsg(0));
    vi.setSystemTime(3001);
    const msg = queue.dequeue(gate, 'STRAIGHT');
    expect(msg).toBeNull();
  });

  it('keeps a message at t=2500ms but drops it at t=3500ms when checked twice', () => {
    queue.enqueue(makeMsg(0));
    vi.setSystemTime(2500);
    expect(queue.size()).toBe(1);

    // Re-enqueue forces an expireStale() pass without consuming the message.
    vi.setSystemTime(3500);
    queue.enqueue(makeMsg(3500));
    // Original is gone, only the just-enqueued one remains.
    expect(queue.size()).toBe(1);
    const msg = queue.dequeue(gate, 'STRAIGHT');
    expect(msg?.timestamp).toBe(3500);
  });
});
