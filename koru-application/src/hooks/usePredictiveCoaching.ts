import { useRef, useCallback } from 'react';
import type { TelemetryFrame, Corner } from '../types';
import { THUNDERHILL_EAST } from '../data/trackData';

interface MistakeZone {
  distance: number;
  speedDelta: number;
  cornerName: string;
  advice: string;
}

/**
 * Predictive coaching: compares recent completed lap vs ideal lap
 * to find "Mistake Zones" and alert the driver before they arrive.
 */
export const usePredictiveCoaching = () => {
  const mistakeZonesRef = useRef<MistakeZone[]>([]);
  const lastTriggeredRef = useRef<string | null>(null);

  /** Analyze a completed lap against the ideal lap to find mistake zones */
  const analyzeLap = useCallback((
    recentLap: TelemetryFrame[],
    idealLap: TelemetryFrame[],
  ) => {
    const zones: MistakeZone[] = [];

    // Build distance-aligned speed profiles
    const recentByDist = alignByDistance(recentLap);
    const idealByDist = alignByDistance(idealLap);

    // Compare at each 5m step
    for (const [dist, recentSpeed] of recentByDist) {
      const idealSpeed = idealByDist.get(dist);
      if (idealSpeed === undefined) continue;

      const delta = recentSpeed - idealSpeed;
      if (delta < -15) { // Lost 15+ mph vs ideal
        const corner = findNearestCorner(dist);
        zones.push({
          distance: dist,
          speedDelta: delta,
          cornerName: corner?.name || `${dist}m`,
          advice: corner?.advice || `Lost ${Math.abs(delta).toFixed(0)} mph here`,
        });
      }
    }

    // Deduplicate: keep the worst delta per corner
    const byCorner = new Map<string, MistakeZone>();
    for (const zone of zones) {
      const existing = byCorner.get(zone.cornerName);
      if (!existing || zone.speedDelta < existing.speedDelta) {
        byCorner.set(zone.cornerName, zone);
      }
    }

    mistakeZonesRef.current = Array.from(byCorner.values());
    lastTriggeredRef.current = null;
    return mistakeZonesRef.current;
  }, []);

  /** Check if the current position is approaching a mistake zone */
  const checkLookahead = useCallback((currentFrame: TelemetryFrame): MistakeZone | null => {
    if (mistakeZonesRef.current.length === 0) return null;

    // Lookahead distance: 8 seconds at current speed
    const lookaheadM = (currentFrame.speed / 3.6) * 8;
    const currentDist = currentFrame.distance || 0;

    for (const zone of mistakeZonesRef.current) {
      const distToZone = zone.distance - currentDist;

      // Zone is ahead and within lookahead range
      if (distToZone > 0 && distToZone < lookaheadM) {
        // Don't re-trigger same zone
        if (lastTriggeredRef.current === zone.cornerName) continue;

        lastTriggeredRef.current = zone.cornerName;
        return zone;
      }
    }

    return null;
  }, []);

  return { analyzeLap, checkLookahead, getMistakeZones: () => mistakeZonesRef.current };
};

// ── Helpers ─────────────────────────────────────────────────

function alignByDistance(frames: TelemetryFrame[]): Map<number, number> {
  const map = new Map<number, number>();
  let cumDist = 0;
  let prevFrame: TelemetryFrame | null = null;

  for (const frame of frames) {
    if (prevFrame) {
      const d = haversine(prevFrame.latitude, prevFrame.longitude, frame.latitude, frame.longitude);
      cumDist += d;
    }
    // Round to nearest 5m
    const key = Math.round(cumDist / 5) * 5;
    map.set(key, frame.speed);
    prevFrame = frame;
  }

  return map;
}

function findNearestCorner(distance: number): Corner | null {
  const track = THUNDERHILL_EAST;
  for (const c of track.corners) {
    if (Math.abs(distance - c.apexDist) < 150) return c;
  }
  return null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
