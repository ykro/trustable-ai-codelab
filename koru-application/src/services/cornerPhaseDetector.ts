import type { TelemetryFrame, Track, Corner, CornerPhase } from '../types';
import { haversineDistance } from '../utils/geoUtils';

export interface CornerDetection {
  phase: CornerPhase;
  cornerId: number | null;
  cornerName: string | null;
}

/**
 * Detects the current corner phase from telemetry.
 *
 * Primary: GPS proximity to known corners (when a Track is provided).
 * Fallback: G-force heuristic (works on any track without predefined data).
 */
export class CornerPhaseDetector {
  private track: Track | null = null;

  setTrack(track: Track | null): void {
    this.track = track;
  }

  detect(frame: TelemetryFrame): CornerDetection {
    // Primary: GPS-based detection when track data is available
    if (this.track) {
      const gpsResult = this.detectFromGps(frame, this.track);
      if (gpsResult) return gpsResult;
    }

    // Fallback: G-force heuristic (track-agnostic)
    return this.detectFromGForces(frame);
  }

  private detectFromGps(frame: TelemetryFrame, track: Track): CornerDetection | null {
    for (const corner of track.corners) {
      // Use entry point if available, otherwise use apex
      const refLat = corner.entryLat ?? corner.lat;
      const refLon = corner.entryLon ?? corner.lon;

      const distToEntry = haversineDistance(frame.latitude, frame.longitude, refLat, refLon);
      const distToApex = haversineDistance(frame.latitude, frame.longitude, corner.lat, corner.lon);

      // Within 200m of a corner — determine phase
      if (distToEntry < 200 || distToApex < 150) {
        const phase = this.classifyPhaseByDistance(distToEntry, distToApex, corner);
        return {
          phase,
          cornerId: corner.id,
          cornerName: corner.name,
        };
      }
    }
    return null;
  }

  private classifyPhaseByDistance(
    distToEntry: number,
    distToApex: number,
    _corner: Corner,
  ): CornerPhase {
    // Approaching entry — brake zone
    if (distToEntry < 100 && distToApex > 80) return 'BRAKE_ZONE';
    // Close to entry — turn-in
    if (distToEntry < 50 && distToApex > 40) return 'TURN_IN';
    // Near apex
    if (distToApex < 30) return 'APEX';
    // Between entry and apex
    if (distToEntry < 30 && distToApex < 80) return 'MID_CORNER';
    // Past apex, moving away
    if (distToApex < 100 && distToApex > 30) return 'EXIT';
    // Far approach
    if (distToEntry < 200 && distToApex > 100) return 'BRAKE_ZONE';

    return 'STRAIGHT';
  }

  private detectFromGForces(frame: TelemetryFrame): CornerDetection {
    const absGLat = Math.abs(frame.gLat);

    let phase: CornerPhase = 'STRAIGHT';

    if (absGLat > 0.5 && frame.brake < 10 && frame.throttle > 30) {
      phase = 'EXIT';
    } else if (absGLat > 0.5) {
      phase = 'MID_CORNER';
    } else if (frame.brake > 30 && absGLat < 0.3) {
      phase = 'BRAKE_ZONE';
    } else if (frame.brake > 10 && absGLat > 0.3) {
      phase = 'TURN_IN';
    } else if (frame.throttle > 60 && absGLat < 0.2 && frame.gLong > 0.1) {
      phase = 'ACCELERATION';
    }

    return { phase, cornerId: null, cornerName: null };
  }
}
