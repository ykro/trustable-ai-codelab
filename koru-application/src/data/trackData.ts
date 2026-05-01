import type { Track } from '../types';

export const THUNDERHILL_EAST: Track = {
  name: 'Thunderhill Raceway (East)',
  length: 4612,
  zoom: 16,
  center: { lat: 39.540473, lng: -122.331475 },
  recordLap: 118.5,
  sectors: [
    { id: 1, name: 'Sector 1', startDist: 0, endDist: 1500 },
    { id: 2, name: 'Sector 2', startDist: 1500, endDist: 3000 },
    { id: 3, name: 'Sector 3', startDist: 3000, endDist: 4612 },
  ],
  corners: [
    { id: 1, name: 'Turn 1', entryDist: 200, apexDist: 350, exitDist: 500, lat: 39.539283, lon: -122.331360, advice: 'Brake early, long left' },
    { id: 2, name: 'Turn 2', entryDist: 850, apexDist: 1000, exitDist: 1150, lat: 39.535989, lon: -122.327133, advice: 'Patient throttle, open up' },
    { id: 3, name: 'Turn 3', entryDist: 1400, apexDist: 1550, exitDist: 1700, lat: 39.539355, lon: -122.328895, advice: 'Off-camber, stay tight' },
    { id: 4, name: 'The Cyclone', entryDist: 2200, apexDist: 2350, exitDist: 2500, lat: 39.544945, lon: -122.330655, advice: 'Blind crest, aim left' },
    { id: 5, name: 'Turn 10', entryDist: 3500, apexDist: 3650, exitDist: 3800, lat: 39.538279, lon: -122.333442, advice: 'Fast exit, use track' },
  ],
  mapPoints: [
    { x: -31.9, y: -34.5 }, { x: 8.1, y: 72.7 }, { x: 20.3, y: 380.7 },
    { x: 308.4, y: 511.7 }, { x: 283.2, y: 306.3 }, { x: 239.8, y: 82 },
    { x: 127.5, y: -131.7 }, { x: 193.1, y: -408.1 }, { x: -230.2, y: -452.2 },
    { x: -373.9, y: -122 }, { x: -283.3, y: 274.8 }, { x: -113.3, y: 77.2 },
    { x: -115.3, y: -372.4 }, { x: 21.7, y: -140.4 }, { x: 25.8, y: 379.5 },
    { x: 394.4, y: 476.8 }, { x: 174.3, y: 243.4 }, { x: 197.8, y: -47.8 },
    { x: 231.6, y: -263 }, { x: -27.1, y: -510 }, { x: -406.8, y: -262 },
    { x: -348.1, y: 180.2 }, { x: -161.7, y: 205.3 }, { x: -117.8, y: -268.7 },
    { x: 26.0, y: -275.7 }, { x: 17.5, y: 253.5 }, { x: 250.2, y: 499.4 },
    { x: 302.8, y: 311.1 }, { x: 241.4, y: 72.6 }, { x: 137.1, y: -172.8 },
    { x: 136.7, y: -459.9 }, { x: -305.4, y: -373.9 }, { x: -355.9, y: -9.6 },
    { x: -197.4, y: 279.9 }, { x: -114.1, y: -94.9 }, { x: -19.7, y: -375.5 },
  ],
};

/**
 * Sonoma Raceway — production track data for the May 23 field test.
 * Vision cues (`visualReference`) on T1, T7, T10, T11 reflect the reviewer's
 * Apr 29 feedback: beginner drivers brake to landmarks, not numbers.
 * T10's "bridge" cue was specifically called out by the reviewer.
 *
 * Lat/lon for T2, T3, T7, T11 are taken from the test fixture; T1 and T10
 * use the same approximate coordinates pending a survey lap with RaceBox
 * data (see TODOs).
 */
export const SONOMA_RACEWAY: Track = {
  name: 'Sonoma Raceway',
  length: 3700,
  recordLap: 97.5,
  center: { lat: 38.161, lng: -122.455 },
  zoom: 15,
  sectors: [
    { id: 1, name: 'Sector 1', startDist: 0, endDist: 1200 },
    { id: 2, name: 'Sector 2', startDist: 1200, endDist: 2400 },
    { id: 3, name: 'Sector 3', startDist: 2400, endDist: 3700 },
  ],
  corners: [
    { id: 1, name: 'Turn 1', entryDist: 100, apexDist: 150, exitDist: 200,
      lat: 38.16180, lon: -122.45550, advice: 'Hard brake, late apex',
      entryLat: 38.16200, entryLon: -122.45500, targetSpeed: 55,
      visualReference: 'Brake at the 3 board, turn in at the cone on the right.' },
    { id: 2, name: 'Turn 2', entryDist: 350, apexDist: 420, exitDist: 480,
      lat: 38.16120, lon: -122.45680, advice: 'Carry speed, gentle arc',
      entryLat: 38.16150, entryLon: -122.45620, targetSpeed: 70 },
    { id: 3, name: 'Turn 3', entryDist: 600, apexDist: 650, exitDist: 700,
      lat: 38.16050, lon: -122.45750, advice: 'Downhill entry, threshold brake',
      entryLat: 38.16080, entryLon: -122.45720, targetSpeed: 45 },
    // TODO: add lat/lon for T4, T5, T6 from a Sonoma survey lap.
    { id: 7, name: 'Turn 7', entryDist: 1800, apexDist: 1870, exitDist: 1930,
      lat: 38.15950, lon: -122.45400, advice: 'Fast sweeper, commit to throttle',
      entryLat: 38.15970, entryLon: -122.45430, targetSpeed: 85,
      visualReference: 'Sight the exit kerb early — feet stay planted through the sweeper.' },
    // TODO: add lat/lon for T8, T9 from a Sonoma survey lap.
    { id: 10, name: 'Turn 10', entryDist: 2800, apexDist: 2870, exitDist: 2950,
      // TODO: replace with surveyed lat/lon — current values are approximate.
      lat: 38.16020, lon: -122.45350, advice: 'Late apex, set up for the carousel',
      targetSpeed: 50,
      visualReference: 'Brake when the bridge fills your windshield.' },
    { id: 11, name: 'Turn 11', entryDist: 3200, apexDist: 3280, exitDist: 3350,
      lat: 38.16100, lon: -122.45300, advice: 'Final corner, strong exit onto straight',
      entryLat: 38.16120, entryLon: -122.45330, targetSpeed: 60,
      visualReference: 'Aim at the start/finish tower — straighten the wheel as it grows.' },
  ],
  mapPoints: [],
};
