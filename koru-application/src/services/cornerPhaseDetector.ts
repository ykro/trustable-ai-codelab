import type { TelemetryFrame, Track, Corner, CornerPhase } from '../types';
import { haversineDistance, isValidGps } from '../utils/geoUtils';

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
  private cosLat = Math.cos(38.16 * Math.PI / 180); // approximate, updated on setTrack

  setTrack(track: Track | null): void {
    this.track = track;
    if (track?.center) {
      this.cosLat = Math.cos(track.center.lat * Math.PI / 180);
    }
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
    if (!isValidGps(frame.latitude, frame.longitude)) return null;
    for (const corner of track.corners) {
      // Use entry point if available, otherwise use apex
      const refLat = corner.entryLat ?? corner.lat;
      const refLon = corner.entryLon ?? corner.lon;

      // Fast equirectangular pre-filter (skip expensive haversine for distant corners)
      const dLat = (frame.latitude - refLat) * 111320;
      const dLon = (frame.longitude - refLon) * 111320 * this.cosLat;
      const fastDist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (fastDist > 300) continue; // Skip corners more than 300m away

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
    // Ordered most-specific → least-specific so inner phases (APEX, MID_CORNER,
    // TURN_IN) aren't swallowed by outer ranges. Previous ordering left TURN_IN
    // and MID_CORNER unreachable, which disabled GPS-driven blackout.
    if (distToApex < 15) return 'APEX';
    if (distToEntry < 30 && distToApex < 60) return 'MID_CORNER';
    if (distToEntry < 60 && distToApex > 40) return 'TURN_IN';
    if (distToEntry < 150 && distToApex > 80) return 'BRAKE_ZONE';
    // EXIT requires being past turn-in (distToEntry ≥ 60) so a far approach
    // with apex 80–99m away can't be misclassified as exiting.
    if (distToApex > 15 && distToApex < 100 && distToEntry >= 60) return 'EXIT';
    if (distToEntry < 200) return 'BRAKE_ZONE';
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
