import type { TelemetryFrame, SkillLevel, DriverState } from '../types';

const WINDOW_DURATION_S = 10;    // seconds of history to consider
const HYSTERESIS_DURATION_S = 5; // seconds of consistent classification before changing
const MIN_SAMPLES = 20;          // minimum samples before classifying

/**
 * Minimal driver model that classifies skill from telemetry signals.
 *
 * Uses two signals:
 * - Input smoothness: 1 - normalized variance of throttle/brake rate-of-change
 * - Coasting ratio: fraction of recent frames with throttle < 10 && brake < 10
 *
 * Classification:
 * - BEGINNER: smoothness < 0.4 OR coasting > 30%
 * - ADVANCED: smoothness > 0.7 AND coasting < 10%
 * - INTERMEDIATE: everything else
 *
 * Window is time-based (~10 seconds) so it works correctly regardless of
 * telemetry sample rate (8Hz OBD, 10Hz GPS, 25Hz RaceBox).
 */
export class DriverModel {
  private throttleDeltas: { time: number; value: number }[] = [];
  private brakeDeltas: { time: number; value: number }[] = [];
  private coastingFrames: { time: number; coasting: boolean }[] = [];

  private prevThrottle: number | null = null;
  private prevBrake: number | null = null;

  private currentLevel: SkillLevel = 'BEGINNER';
  private candidateLevel: SkillLevel = 'BEGINNER';
  private candidateStartTime = 0;

  update(frame: TelemetryFrame): void {
    const time = frame.time;

    // Compute rate-of-change for throttle and brake
    if (this.prevThrottle !== null && this.prevBrake !== null) {
      this.throttleDeltas.push({ time, value: Math.abs(frame.throttle - this.prevThrottle) });
      this.brakeDeltas.push({ time, value: Math.abs(frame.brake - this.prevBrake) });
    }

    this.prevThrottle = frame.throttle;
    this.prevBrake = frame.brake;

    // Track coasting
    const isCoasting = frame.throttle < 10 && frame.brake < 10;
    this.coastingFrames.push({ time, coasting: isCoasting });

    // Trim to window duration
    const cutoff = time - WINDOW_DURATION_S;
    this.throttleDeltas = this.throttleDeltas.filter(d => d.time > cutoff);
    this.brakeDeltas = this.brakeDeltas.filter(d => d.time > cutoff);
    this.coastingFrames = this.coastingFrames.filter(d => d.time > cutoff);

    // Classify with hysteresis
    if (this.throttleDeltas.length >= MIN_SAMPLES) {
      const classified = this.classify();
      if (classified === this.candidateLevel) {
        // Check if enough time has passed
        if (time - this.candidateStartTime >= HYSTERESIS_DURATION_S) {
          this.currentLevel = this.candidateLevel;
        }
      } else {
        this.candidateLevel = classified;
        this.candidateStartTime = time;
      }
    }
  }

  getSkillLevel(): SkillLevel {
    return this.currentLevel;
  }

  getState(): DriverState {
    const smoothness = this.computeSmoothness();
    const coastingRatio = this.computeCoastingRatio();

    return {
      skillLevel: this.currentLevel,
      cognitiveLoad: 1 - smoothness,
      inputSmoothness: smoothness,
      coastingRatio,
    };
  }

  private classify(): SkillLevel {
    const smoothness = this.computeSmoothness();
    const coastingRatio = this.computeCoastingRatio();

    if (smoothness < 0.4 || coastingRatio > 0.3) return 'BEGINNER';
    if (smoothness > 0.7 && coastingRatio < 0.1) return 'ADVANCED';
    return 'INTERMEDIATE';
  }

  private computeCoastingRatio(): number {
    if (this.coastingFrames.length === 0) return 0;
    const coastCount = this.coastingFrames.filter(f => f.coasting).length;
    return coastCount / this.coastingFrames.length;
  }

  private computeSmoothness(): number {
    const variance = (arr: { time: number; value: number }[]): number => {
      if (arr.length < 2) return 0;
      const values = arr.map(d => d.value);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    };

    const tVar = Math.min(variance(this.throttleDeltas) / 2500, 1);
    const bVar = Math.min(variance(this.brakeDeltas) / 2500, 1);
    const combined = tVar * 0.5 + bVar * 0.5;

    return Math.max(0, Math.min(1, 1 - combined));
  }
}
