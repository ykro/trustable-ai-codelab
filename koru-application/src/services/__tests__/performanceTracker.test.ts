import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceTracker } from '../performanceTracker';
import type { TelemetryFrame } from '../../types';

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;

  beforeEach(() => {
    tracker = new PerformanceTracker();
  });

  const createFrame = (speed: number, brake = 0, throttle = 0): TelemetryFrame => ({
    time: 0, latitude: 0, longitude: 0,
    speed, brake, throttle, gLat: 0, gLong: 0,
  });

  it('should record corner metrics on first pass', () => {
    // Enter corner 1
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(55, 20, 30), 'MID_CORNER', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    // EXIT phase still has cornerId (detector still sees the corner)
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    // Now leave corner
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    const histories = tracker.getCornerHistories();
    expect(histories.has(1)).toBe(true);
    const snapshots = histories.get(1)!.snapshots;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].minSpeed).toBe(50);
    expect(snapshots[0].maxBrake).toBe(60);
    expect(snapshots[0].entrySpeed).toBe(80);
    expect(snapshots[0].exitSpeed).toBe(65);
  });

  it('should NOT emit improvement on first lap', () => {
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    const result = tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);
    expect(result).toBeNull();
  });

  it('should emit improvement when exit speed improves by 2+ mph on lap 2', () => {
    // Lap 1: exit at 65 mph
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    tracker.newLap();

    // Lap 2: exit at 68 mph (+3)
    tracker.update(createFrame(82, 55, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(52, 0, 85), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(68, 0, 100), 'EXIT', 1, 'Turn 1');
    const result = tracker.update(createFrame(72, 0, 100), 'STRAIGHT', null, null);

    expect(result).not.toBeNull();
    expect(result!.priority).toBe(3);
    expect(result!.text).toContain('improvement');
    expect(result!.text).toContain('Exit speed up 3 mph');
  });

  it('should NOT emit improvement when exit speed is unchanged', () => {
    // Lap 1
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    tracker.newLap();

    // Lap 2: same exit speed
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    const result = tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    expect(result).toBeNull();
  });

  it('should emit improvement when min speed improves by 1+ mph', () => {
    // Lap 1: min speed 50, exit speed 65
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    tracker.newLap();

    // Lap 2: min speed 52 (+2), exit speed 66 (+1, below 2 threshold)
    tracker.update(createFrame(80, 55, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(52, 0, 85), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(66, 0, 100), 'EXIT', 1, 'Turn 1');
    const result = tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    expect(result).not.toBeNull();
    expect(result!.text).toContain('Carrying 2 mph more');
  });

  it('should track multiple corners independently', () => {
    // Corner 1
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    // Corner 3
    tracker.update(createFrame(90, 70, 10), 'BRAKE_ZONE', 3, 'Turn 3');
    tracker.update(createFrame(60, 0, 70), 'APEX', 3, 'Turn 3');
    tracker.update(createFrame(75, 0, 100), 'EXIT', 3, 'Turn 3');
    tracker.update(createFrame(80, 0, 100), 'STRAIGHT', null, null);

    const histories = tracker.getCornerHistories();
    expect(histories.size).toBe(2);
    expect(histories.has(1)).toBe(true);
    expect(histories.has(3)).toBe(true);
  });

  it('should return null for getCornerTrend with insufficient data', () => {
    expect(tracker.getCornerTrend(1)).toBeNull();

    // Add one snapshot
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    expect(tracker.getCornerTrend(1)).toBeNull(); // need 2+ snapshots
  });

  it('stores the cornerName on both the snapshot and history (regression)', () => {
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 7, 'Turn 7');
    tracker.update(createFrame(50, 0, 80), 'APEX', 7, 'Turn 7');
    tracker.update(createFrame(65, 0, 100), 'EXIT', 7, 'Turn 7');
    tracker.update(createFrame(70, 0, 100), 'STRAIGHT', null, null);

    const history = tracker.getCornerHistories().get(7)!;
    expect(history.cornerName).toBe('Turn 7');
    expect(history.snapshots[0].cornerName).toBe('Turn 7');
  });

  it('should return correct trend with multiple laps', () => {
    // Lap 1: exit 60
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(60, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(65, 0, 100), 'STRAIGHT', null, null);

    tracker.newLap();

    // Lap 2: exit 68 (+8)
    tracker.update(createFrame(80, 60, 10), 'BRAKE_ZONE', 1, 'Turn 1');
    tracker.update(createFrame(50, 0, 80), 'APEX', 1, 'Turn 1');
    tracker.update(createFrame(68, 0, 100), 'EXIT', 1, 'Turn 1');
    tracker.update(createFrame(72, 0, 100), 'STRAIGHT', null, null);

    const trend = tracker.getCornerTrend(1);
    expect(trend).not.toBeNull();
    expect(trend!.improving).toBe(true);
    expect(trend!.deltaMph).toBe(8);
  });
});
