import type { TimingState, CornerPhase } from '../types';

export interface TimingGateConfig {
  cooldownMs: number;
  deliveryMs: number;
  blackoutPhases: CornerPhase[];
}

const DEFAULT_CONFIG: TimingGateConfig = {
  cooldownMs: 1500,
  deliveryMs: 2000,
  blackoutPhases: ['MID_CORNER', 'APEX'],
};

/**
 * Timing state machine that controls when coaching messages can be delivered.
 *
 * States:
 *   OPEN      — ready to deliver a message
 *   DELIVERING — a message is being spoken/shown
 *   COOLDOWN  — waiting after delivery before allowing the next message
 *   BLACKOUT  — in a corner phase where coaching is dangerous (mid-corner/apex)
 *
 * P0 (safety) messages bypass COOLDOWN and BLACKOUT.
 */
export class TimingGate {
  private state: TimingState = 'OPEN';
  private lastDeliveryTime = 0;
  private config: TimingGateConfig;
  private inBlackoutPhase = false;
  private blackoutSet: Set<CornerPhase>;

  constructor(config?: Partial<TimingGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.blackoutSet = new Set(this.config.blackoutPhases);
  }

  getState(): TimingState {
    return this.state;
  }

  /** Update config dynamically (e.g., when driver model changes skill level) */
  updateConfig(partial: Partial<TimingGateConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.blackoutPhases) {
      this.blackoutSet = new Set(this.config.blackoutPhases);
    }
  }

  /** Called each frame to update blackout state based on corner phase */
  update(cornerPhase: CornerPhase): void {
    this.inBlackoutPhase = this.blackoutSet.has(cornerPhase);

    const now = Date.now();

    if (this.inBlackoutPhase) {
      // Enter blackout regardless of current state (unless delivering)
      if (this.state !== 'DELIVERING') {
        this.state = 'BLACKOUT';
      }
    } else if (this.state === 'BLACKOUT') {
      // Exiting blackout phase — go to OPEN
      this.state = 'OPEN';
    } else if (this.state === 'DELIVERING') {
      // Check if delivery duration has elapsed
      if (now - this.lastDeliveryTime >= this.config.deliveryMs) {
        this.state = 'COOLDOWN';
      }
    } else if (this.state === 'COOLDOWN') {
      // Check if cooldown has elapsed
      if (now - this.lastDeliveryTime >= this.config.deliveryMs + this.config.cooldownMs) {
        this.state = 'OPEN';
      }
    }
  }

  /** Check if a message with the given priority can be delivered now */
  canDeliver(priority: 0 | 1 | 2 | 3): boolean {
    // P0 (safety) always passes
    if (priority === 0) return true;

    return this.state === 'OPEN';
  }

  /** Mark that a message delivery has started */
  startDelivery(): void {
    this.lastDeliveryTime = Date.now();
    this.state = 'DELIVERING';
  }
}
