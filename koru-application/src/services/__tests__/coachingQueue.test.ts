import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CoachingQueue } from '../coachingQueue';
import type { CoachingDecision } from '../../types';
import { TimingGate } from '../timingGate';

describe('CoachingQueue', () => {
  let queue: CoachingQueue;
  let mockGate: TimingGate;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    queue = new CoachingQueue();
    mockGate = new TimingGate();
    // mock gate to always allow delivery
    mockGate.canDeliver = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createDecision = (priority: 0|1|2|3, text: string): CoachingDecision => ({
    path: 'hot',
    action: 'BRAKE' as const,
    text,
    priority,
    cornerPhase: 'STRAIGHT',
    timestamp: Date.now()
  });

  it('should enqueue and dequeue a message', () => {
    queue.enqueue(createDecision(2, 'test1'));
    
    expect(queue.size()).toBe(1);
    
    const dequeued = queue.dequeue(mockGate, 'STRAIGHT');
    expect(dequeued?.text).toBe('test1');
    expect(queue.size()).toBe(0);
  });

  it('should sort messages by priority (P0 first)', () => {
    queue.enqueue(createDecision(3, 'low'));
    vi.setSystemTime(1010);
    queue.enqueue(createDecision(1, 'high'));
    vi.setSystemTime(1020);
    queue.enqueue(createDecision(0, 'critical'));

    expect(queue.dequeue(mockGate, 'STRAIGHT')?.text).toBe('critical');
    expect(queue.dequeue(mockGate, 'STRAIGHT')?.text).toBe('high');
    expect(queue.dequeue(mockGate, 'STRAIGHT')?.text).toBe('low');
  });

  it('should discard stale messages on dequeue', () => {
    queue.enqueue(createDecision(2, 'stale1'));
    vi.setSystemTime(2000);
    queue.enqueue(createDecision(2, 'stale2'));
    
    // Jump time so first two become stale (>3000ms)
    vi.setSystemTime(6000);
    queue.enqueue(createDecision(2, 'fresh'));

    const dequeued = queue.dequeue(mockGate, 'STRAIGHT');
    expect(dequeued?.text).toBe('fresh');
    expect(queue.size()).toBe(0);
  });

  it('should clear queue completely via preempt', () => {
    queue.enqueue(createDecision(1, 't1'));
    queue.enqueue(createDecision(1, 't2'));
    expect(queue.size()).toBe(2);
    
    queue.preempt(createDecision(0, 'p0'));
    // Queue should now only have P0 elements (none were in queue, the passed one is returned)
    expect(queue.size()).toBe(0);
  });
});