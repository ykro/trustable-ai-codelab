import type { Track } from '../../types';

/** Sonoma Raceway track data — TEST FIXTURE ONLY (not a production dependency) */
export const SONOMA_TEST_TRACK: Track = {
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
    { id: 1, name: 'Turn 1', entryDist: 100, apexDist: 150, exitDist: 200, lat: 38.16180, lon: -122.45550, advice: 'Hard brake, late apex', entryLat: 38.16200, entryLon: -122.45500, targetSpeed: 55 },
    { id: 2, name: 'Turn 2', entryDist: 350, apexDist: 420, exitDist: 480, lat: 38.16120, lon: -122.45680, advice: 'Carry speed, gentle arc', entryLat: 38.16150, entryLon: -122.45620, targetSpeed: 70 },
    { id: 3, name: 'Turn 3', entryDist: 600, apexDist: 650, exitDist: 700, lat: 38.16050, lon: -122.45750, advice: 'Downhill entry, threshold brake', entryLat: 38.16080, entryLon: -122.45720, targetSpeed: 45 },
    { id: 7, name: 'Turn 7', entryDist: 1800, apexDist: 1870, exitDist: 1930, lat: 38.15950, lon: -122.45400, advice: 'Fast sweeper, commit to throttle', entryLat: 38.15970, entryLon: -122.45430, targetSpeed: 85 },
    { id: 11, name: 'Turn 11', entryDist: 3200, apexDist: 3280, exitDist: 3350, lat: 38.16100, lon: -122.45300, advice: 'Final corner, strong exit onto straight', entryLat: 38.16120, entryLon: -122.45330, targetSpeed: 60 },
  ],
  mapPoints: [],
};
