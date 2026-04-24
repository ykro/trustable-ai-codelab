import type { TelemetryFrame, CornerPhase, CoachingDecision } from '../types';

/**
 * Phase 6.4 — In-Session Improvement Tracking
 *
 * Tracks per-corner metrics within a single session (no persistence layer needed).
 * Compares lap-over-lap performance and emits P3 encouragement when driver improves.
 *
 * Focus: BEGINNER drivers. Ross Bentley: "Drivers want to see improvements."
 *
 * Cross-session tracking requires the persistence layer (AGY Pipeline).
 * This service handles in-memory, single-session tracking only.
 */

interface CornerSnapshot {
  cornerId: number;
  cornerName: string;
  lapNumber: number;
  minSpeed: number;
  maxBrake: number;
  maxThrottle: number;
  entrySpeed: number;
  exitSpeed: number;
}

interface CornerHistory {
  cornerId: number;
  cornerName: string;
  snapshots: CornerSnapshot[];
}

export class PerformanceTracker {
  private cornerHistories = new Map<number, CornerHistory>();
  private currentLap = 1;
  private currentCornerId: number | null = null;
  private currentCornerName = '';

  // Accumulating metrics for current corner pass
  private currentMinSpeed = Infinity;
  private currentMaxBrake = 0;
  private currentMaxThrottle = 0;
  private currentEntrySpeed = 0;
  private currentExitSpeed = 0;
  private inCorner = false;

  /** Call when a new lap starts */
  newLap(): void {
    this.flushCorner();
    this.currentLap++;
  }

  /**
   * Update with each frame + corner phase.
   * Returns a P3 encouragement CoachingDecision if improvement detected, else null.
   */
  update(
    frame: TelemetryFrame,
    phase: CornerPhase,
    cornerId: number | null,
    cornerName: string | null,
  ): CoachingDecision | null {
    // Entered a new corner
    if (cornerId !== null && cornerId !== this.currentCornerId) {
      this.flushCorner();
      this.currentCornerId = cornerId;
      this.currentCornerName = cornerName ?? '';
      this.currentMinSpeed = frame.speed;
      this.currentMaxBrake = frame.brake;
      this.currentMaxThrottle = frame.throttle;
      this.currentEntrySpeed = frame.speed;
      this.currentExitSpeed = frame.speed;
      this.inCorner = true;
    }

    // Accumulate metrics while in corner
    if (this.inCorner && cornerId === this.currentCornerId) {
      if (frame.speed < this.currentMinSpeed) this.currentMinSpeed = frame.speed;
      if (frame.brake > this.currentMaxBrake) this.currentMaxBrake = frame.brake;
      if (frame.throttle > this.currentMaxThrottle) this.currentMaxThrottle = frame.throttle;
      this.currentExitSpeed = frame.speed;
    }

    // Exiting corner — flush and check for improvement
    if (this.inCorner && cornerId === null && phase === 'STRAIGHT') {
      return this.flushCorner();
    }

    return null;
  }

  /** Flush current corner metrics and compare to previous lap */
  private flushCorner(): CoachingDecision | null {
    if (!this.inCorner || this.currentCornerId === null) {
      this.resetCurrent();
      return null;
    }

    const snapshot: CornerSnapshot = {
      cornerId: this.currentCornerId,
      cornerName: this.currentCornerName,
      lapNumber: this.currentLap,
      minSpeed: this.currentMinSpeed,
      maxBrake: this.currentMaxBrake,
      maxThrottle: this.currentMaxThrottle,
      entrySpeed: this.currentEntrySpeed,
      exitSpeed: this.currentExitSpeed,
    };

    let history = this.cornerHistories.get(this.currentCornerId);
    if (!history) {
      history = {
        cornerId: this.currentCornerId,
        cornerName: this.currentCornerName,
        snapshots: [],
      };
      this.cornerHistories.set(this.currentCornerId, history);
    }

    // Check improvement vs previous lap's same corner
    const prevSnap = history.snapshots.find(s => s.lapNumber === this.currentLap - 1);
    let decision: CoachingDecision | null = null;

    if (prevSnap && this.currentLap > 1) {
      const exitImproved = snapshot.exitSpeed - prevSnap.exitSpeed;
      const minSpeedImproved = snapshot.minSpeed - prevSnap.minSpeed;

      // Exit speed improved by 2+ mph or min speed improved by 1+ mph
      if (exitImproved >= 2 || minSpeedImproved >= 1) {
        const detail = exitImproved >= 2
          ? `Exit speed up ${exitImproved.toFixed(0)} mph!`
          : `Carrying ${minSpeedImproved.toFixed(0)} mph more through the corner!`;
        decision = {
          path: 'hot',
          action: 'PUSH',
          text: `Nice improvement! ${detail}`,
          priority: 3,
          cornerPhase: 'STRAIGHT',
          timestamp: Date.now(),
        };
      }
    }

    history.snapshots.push(snapshot);
    this.resetCurrent();
    return decision;
  }

  private resetCurrent(): void {
    this.inCorner = false;
    this.currentCornerId = null;
    this.currentCornerName = '';
    this.currentMinSpeed = Infinity;
    this.currentMaxBrake = 0;
    this.currentMaxThrottle = 0;
    this.currentEntrySpeed = 0;
    this.currentExitSpeed = 0;
  }

  /** Get all corner histories for post-session summary */
  getCornerHistories(): Map<number, CornerHistory> {
    return this.cornerHistories;
  }

  /** Get improvement summary for a specific corner */
  getCornerTrend(cornerId: number): { improving: boolean; deltaMph: number } | null {
    const history = this.cornerHistories.get(cornerId);
    if (!history || history.snapshots.length < 2) return null;

    const sorted = [...history.snapshots].sort((a, b) => a.lapNumber - b.lapNumber);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const deltaMph = last.exitSpeed - first.exitSpeed;

    return { improving: deltaMph > 0, deltaMph };
  }
}
