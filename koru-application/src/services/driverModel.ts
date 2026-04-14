import type { TelemetryFrame, SkillLevel, DriverState } from '../types';

const WINDOW_SIZE = 100;      // frames (~10 seconds at 10Hz)
const HYSTERESIS_FRAMES = 50; // require consistent classification before changing

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
 */
export class DriverModel {
  private throttleHistory: number[] = [];
  private brakeHistory: number[] = [];
  private coastingCount = 0;
  private totalFrames = 0;

  private prevThrottle: number | null = null;
  private prevBrake: number | null = null;

  private currentLevel: SkillLevel = 'BEGINNER';
  private candidateLevel: SkillLevel = 'BEGINNER';
  private candidateFrames = 0;

  update(frame: TelemetryFrame): void {
    // Compute rate-of-change for throttle and brake
    if (this.prevThrottle !== null && this.prevBrake !== null) {
      this.throttleHistory.push(Math.abs(frame.throttle - this.prevThrottle));
      this.brakeHistory.push(Math.abs(frame.brake - this.prevBrake));

      if (this.throttleHistory.length > WINDOW_SIZE) this.throttleHistory.shift();
      if (this.brakeHistory.length > WINDOW_SIZE) this.brakeHistory.shift();
    }

    this.prevThrottle = frame.throttle;
    this.prevBrake = frame.brake;

    // Track coasting (rolling window approximation)
    const isCoasting = frame.throttle < 10 && frame.brake < 10;
    this.totalFrames++;
    if (isCoasting) this.coastingCount++;

    // Keep coasting ratio within window
    if (this.totalFrames > WINDOW_SIZE) {
      // Approximate: decay toward current observation
      this.coastingCount = Math.round(this.coastingCount * (WINDOW_SIZE / this.totalFrames));
      this.totalFrames = WINDOW_SIZE;
    }

    // Classify every frame, apply hysteresis
    if (this.throttleHistory.length >= 20) {
      const classified = this.classify();
      if (classified === this.candidateLevel) {
        this.candidateFrames++;
      } else {
        this.candidateLevel = classified;
        this.candidateFrames = 1;
      }

      if (this.candidateFrames >= HYSTERESIS_FRAMES) {
        this.currentLevel = this.candidateLevel;
      }
    }
  }

  getSkillLevel(): SkillLevel {
    return this.currentLevel;
  }

  getState(): DriverState {
    const smoothness = this.computeSmoothness();
    const coastingRatio = this.totalFrames > 0 ? this.coastingCount / this.totalFrames : 0;

    return {
      skillLevel: this.currentLevel,
      cognitiveLoad: 1 - smoothness, // rough proxy
      inputSmoothness: smoothness,
      coastingRatio,
    };
  }

  private classify(): SkillLevel {
    const smoothness = this.computeSmoothness();
    const coastingRatio = this.totalFrames > 0 ? this.coastingCount / this.totalFrames : 0;

    if (smoothness < 0.4 || coastingRatio > 0.3) return 'BEGINNER';
    if (smoothness > 0.7 && coastingRatio < 0.1) return 'ADVANCED';
    return 'INTERMEDIATE';
  }

  private computeSmoothness(): number {
    const variance = (arr: number[]): number => {
      if (arr.length < 2) return 0;
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
      return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    };

    const tVar = Math.min(variance(this.throttleHistory) / 2500, 1);
    const bVar = Math.min(variance(this.brakeHistory) / 2500, 1);
    const combined = tVar * 0.5 + bVar * 0.5;

    return Math.max(0, Math.min(1, 1 - combined));
  }
}
