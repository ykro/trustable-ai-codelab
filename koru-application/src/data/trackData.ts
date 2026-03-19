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
