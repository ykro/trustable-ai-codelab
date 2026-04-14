import type { CoachingDecision, CornerPhase } from '../types';
import type { TimingGate } from './timingGate';

const MAX_QUEUE_SIZE = 5;
const STALE_MS = 3000;

/**
 * Priority queue for coaching messages.
 *
 * Messages are sorted by priority (0=safety first) then timestamp (oldest first).
 * P0 (safety) messages use preempt() to bypass the queue entirely.
 * Stale messages (>3s old) are automatically dropped.
 */
export class CoachingQueue {
  private queue: CoachingDecision[] = [];

  /** Enqueue a coaching decision. Drops lowest-priority stale messages if full. */
  enqueue(decision: CoachingDecision): void {
    this.expireStale();

    // If queue is full, drop the lowest-priority (highest number) message
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Find the index of the lowest-priority message
      let worstIdx = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority > this.queue[worstIdx].priority ||
          (this.queue[i].priority === this.queue[worstIdx].priority &&
            this.queue[i].timestamp < this.queue[worstIdx].timestamp)) {
          worstIdx = i;
        }
      }
      // Only drop if the new message is higher priority (lower number)
      if (decision.priority < this.queue[worstIdx].priority) {
        this.queue.splice(worstIdx, 1);
      } else {
        return; // Queue full, new message is lower priority — drop it
      }
    }

    this.queue.push(decision);
    // Sort: lowest priority number first, then oldest first
    this.queue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
  }

  /** Dequeue the highest-priority message that the timing gate allows. */
  dequeue(timingGate: TimingGate, currentPhase: CornerPhase): CoachingDecision | null {
    this.expireStale();

    for (let i = 0; i < this.queue.length; i++) {
      if (timingGate.canDeliver(this.queue[i].priority)) {
        return this.queue.splice(i, 1)[0];
      }
    }
    return null;
  }

  /** P0 safety preempt: immediately return the decision and clear lower-priority messages. */
  preempt(decision: CoachingDecision): CoachingDecision {
    // Clear all non-safety messages from the queue
    this.queue = this.queue.filter(d => d.priority === 0);
    return decision;
  }

  /** Get current queue size (for debugging/display) */
  size(): number {
    return this.queue.length;
  }

  /** Remove messages older than STALE_MS */
  private expireStale(): void {
    const now = Date.now();
    this.queue = this.queue.filter(d => now - d.timestamp < STALE_MS);
  }
}
