// T-Rod (Tony Rodriguez) Coaching Data - Extracted from real coaching session at Sonoma Raceway
// Source: "T-Rod Tony Rodriguez Coach Advice Sonoma Oct 12 25.docx" (3,291 words)
// Session: Beginner group coaching, 2019 Audi RS3, Sonoma Raceway

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightCategory = 'throttle' | 'braking' | 'line' | 'mental' | 'general';
export type Severity = 'safety' | 'technique' | 'optimization';
export type ApplicableLaps = 'early' | 'mid' | 'late' | 'all';
export type SonomaCornerId = 'turn2' | 'turn3' | 'turn3a' | 'turn6' | 'turn7' | 'turn9_10';

export interface TRodInsight {
  /** Unique identifier for this insight */
  id: string;
  /** High-level category */
  category: InsightCategory;
  /** Which Sonoma corners this applies to (empty = all corners / general) */
  cornerIds: SonomaCornerId[];
  /** Full insight text explaining the concept */
  insight: string;
  /** Short phrase the coach should say to the driver (< 15 words) */
  coachingPhrase: string;
  /** How critical this insight is */
  severity: Severity;
  /** When in a session this advice is most relevant */
  applicableLaps: ApplicableLaps;
}

// ---------------------------------------------------------------------------
// Core Insights (12 key patterns from T-Rod's session)
// ---------------------------------------------------------------------------

export const TROD_INSIGHTS: TRodInsight[] = [
  {
    id: 'trod-01-throttle-commitment',
    category: 'throttle',
    cornerIds: [],
    insight:
      'Throttle commitment is the #1 beginner problem. When you think 60% throttle, go 100%. ' +
      'The torque difference is only ~20 ft-lbs between 60% and 100% in a rental car. ' +
      'The car will not kill you — commit to full throttle at the apex.',
    coachingPhrase: 'Commit! Full throttle now. The car can take it.',
    severity: 'technique',
    applicableLaps: 'mid',
  },
  {
    id: 'trod-02-dont-be-a-wuss',
    category: 'throttle',
    cornerIds: [],
    insight:
      '"Don\'t be a wuss." The driver needs to commit to throttle at the apex. ' +
      'The rental car is forgiving — it does not have enough power to spin itself. ' +
      'Half-throttle through a corner is slower AND less stable than full commitment.',
    coachingPhrase: 'Be bold! Squeeze it all the way.',
    severity: 'technique',
    applicableLaps: 'mid',
  },
  {
    id: 'trod-03-brake-trace-analysis',
    category: 'braking',
    cornerIds: [],
    insight:
      'Look at brake PRESSURE (not the on/off switch) for modulation quality. ' +
      'A smooth taper from peak pressure down to zero is the goal. ' +
      'Spike-and-release braking means the driver is scared and stabbing. ' +
      'The trace should look like a ski slope, not a cliff.',
    coachingPhrase: 'Smoother on the brakes. Squeeze, then slowly release.',
    severity: 'technique',
    applicableLaps: 'all',
  },
  {
    id: 'trod-04-trail-braking',
    category: 'braking',
    cornerIds: [],
    insight:
      'Trail braking: hold light brake as you turn in. Keep nose weight on the front tires. ' +
      'Off brake by mid-corner. This is where the real speed lives. ' +
      'Front tires with extra weight turn better — the car rotates for free.',
    coachingPhrase: 'Hold a little brake into the turn. Off by mid-corner.',
    severity: 'technique',
    applicableLaps: 'late',
  },
  {
    id: 'trod-05-delay-early-throttle',
    category: 'throttle',
    cornerIds: [],
    insight:
      'Delay early throttle. Anytime the driver thinks "it\'s throttle time" — wait. ' +
      'Not until the apex. Then commit HARD. ' +
      'Early throttle pushes the front wide (understeer) and wastes the corner.',
    coachingPhrase: 'Wait for it... wait... NOW! Full throttle.',
    severity: 'technique',
    applicableLaps: 'mid',
  },
  {
    id: 'trod-06-distance-is-king',
    category: 'line',
    cornerIds: ['turn6', 'turn7'],
    insight:
      'In sweeping corners (Turns 6, 7, 11), cutting distance is king. ' +
      'Stay close to the apex curb rather than opening up for speed. ' +
      'Shorter distance beats 2 mph faster every time. ' +
      'The math: 10 ft shorter path at 60 mph saves more than 2 mph extra speed on a longer path.',
    coachingPhrase: 'Hug the inside. Shorter distance wins here.',
    severity: 'optimization',
    applicableLaps: 'mid',
  },
  {
    id: 'trod-07-turn7-double-apex',
    category: 'line',
    cornerIds: ['turn7'],
    insight:
      'Turn 7 strategy: double apex. Cut distance on entry to the first apex, ' +
      'let the car rotate in the center section, then track to the second apex. ' +
      'Do not try to carry one arc through the whole corner — it is too long.',
    coachingPhrase: 'Double apex here. First apex, rotate, second apex.',
    severity: 'optimization',
    applicableLaps: 'late',
  },
  {
    id: 'trod-08-turns9-10-open-t9',
    category: 'line',
    cornerIds: ['turn9_10'],
    insight:
      'Turns 9-10: open up Turn 9 to get a straight shot into Turn 10. ' +
      'Do not carry steering angle from Turn 9 into the Turn 10 approach. ' +
      'Straighten the car between them so you can brake in a straight line for T10. ' +
      'T10 exit speed carries all the way down the front straight.',
    coachingPhrase: 'Open up Turn 9. Straighten before Turn 10.',
    severity: 'technique',
    applicableLaps: 'mid',
  },
  {
    id: 'trod-09-cooldown-laps',
    category: 'general',
    cornerIds: [],
    insight:
      'Cool down laps matter. Do not relax your lines on the cool down. ' +
      'Drive the same lines, hit the same marks, use the same references. ' +
      'Extra reps at lower speed become muscle memory. The cool down is free practice.',
    coachingPhrase: 'Same lines on cool down. Build the muscle memory.',
    severity: 'technique',
    applicableLaps: 'late',
  },
  {
    id: 'trod-10-session-progression',
    category: 'mental',
    cornerIds: [],
    insight:
      'Session progression: start with lines and marks. Then add shifts. ' +
      'Then add trail braking. Then add throttle commitment. ' +
      'One new thing at a time. Stacking too many changes causes overload and regression.',
    coachingPhrase: 'One thing at a time. Lock in this before adding more.',
    severity: 'technique',
    applicableLaps: 'all',
  },
  {
    id: 'trod-11-mental-capacity',
    category: 'mental',
    cornerIds: [],
    insight:
      'Mental capacity awareness: "Knowing your mental capacity is part of the game." ' +
      'When the driver feels overwhelmed, go back to basics — just hit the marks. ' +
      'Do not add new techniques when cognitive load is high. ' +
      'A good coach reads the driver, not just the telemetry.',
    coachingPhrase: 'Feeling busy? Just focus on your marks this lap.',
    severity: 'safety',
    applicableLaps: 'all',
  },
  {
    id: 'trod-12-curbs-are-friends',
    category: 'line',
    cornerIds: ['turn2', 'turn3', 'turn6', 'turn7'],
    insight:
      'The curbs are your friends. Serrated berms at Sonoma are raised and banked — ' +
      'they catch the car, they do not upset it. Use them as extensions of the track. ' +
      'Beginners leave a full car width between themselves and the curbs, wasting track.',
    coachingPhrase: 'Use the curbs! They are your friends here.',
    severity: 'optimization',
    applicableLaps: 'mid',
  },
];

// ---------------------------------------------------------------------------
// Corner-Specific Advice (mapped by Sonoma corner ID)
// ---------------------------------------------------------------------------

export interface CornerAdvice {
  /** T-Rod's specific advice for this corner */
  trodAdvice: string;
  /** Key coaching phrases for this corner */
  keyPhrases: string[];
  /** Common beginner mistakes T-Rod observed at this corner */
  beginnerMistakes: string[];
  /** Priority: what to fix first at this corner */
  priority: 'line' | 'braking' | 'throttle' | 'vision';
}

export const TROD_CORNER_ADVICE: Record<SonomaCornerId, CornerAdvice> = {
  turn2: {
    trodAdvice:
      'Stay wide on entry, use all the track. Trail brake to the apex curb. ' +
      'Use the curbs — they are banked and will catch you. Commit to throttle at apex.',
    keyPhrases: [
      'Stay wide, trail brake in.',
      'Use the apex curb.',
      'Throttle at the curb, not before.',
    ],
    beginnerMistakes: [
      'Turning in too early',
      'Lifting off throttle mid-corner instead of committing',
      'Leaving a car width between the car and the curb',
    ],
    priority: 'line',
  },
  turn3: {
    trodAdvice:
      'This is where beginners lose the most time. Slow in, FAST out. ' +
      'Late apex is critical here — the exit feeds the back straight. ' +
      'Wait for the apex, then commit to full throttle. Use the exit curbs.',
    keyPhrases: [
      'Wait... wait... NOW throttle!',
      'Slow in, fast out. Exit speed is everything.',
      'Late apex. Later than you think.',
    ],
    beginnerMistakes: [
      'Early turn-in leading to early apex and wide exit',
      'Half-throttle on exit — commit fully',
      'Looking at the inside curb instead of the exit',
    ],
    priority: 'throttle',
  },
  turn3a: {
    trodAdvice:
      'Tightest corner on the track. Brake hard in a straight line before turn-in. ' +
      'Be patient — let the car rotate. Do not rush the exit. Progressive throttle only.',
    keyPhrases: [
      'Patience. Let it rotate.',
      'Straight-line braking first.',
      'Progressive throttle out.',
    ],
    beginnerMistakes: [
      'Braking while turning (car pushes wide)',
      'Rushing the exit and getting on throttle before the car rotates',
      'Panic braking because they entered too fast',
    ],
    priority: 'braking',
  },
  turn6: {
    trodAdvice:
      'Carousel: distance is king. Stay close to the inside, cut distance. ' +
      'Do NOT open up the line for speed — shorter path beats higher speed here. ' +
      'Steady throttle throughout. Use the curbs. Never lift mid-corner.',
    keyPhrases: [
      'Hug the inside. Distance is king.',
      'Steady throttle. Do not lift.',
      'Use the curbs — they catch you.',
    ],
    beginnerMistakes: [
      'Running a wide arc trying to carry more speed (longer path loses more)',
      'Lifting mid-corner causing snap oversteer',
      'Avoiding the curbs and wasting track width',
    ],
    priority: 'line',
  },
  turn7: {
    trodAdvice:
      'Double apex corner. Cut distance on entry to first apex, let the car rotate ' +
      'in the center, then track to second apex. Distance is king here too — ' +
      'stay tight. Use the curbs on both apexes.',
    keyPhrases: [
      'Double apex. First apex, rotate, second apex.',
      'Cut the distance — stay tight.',
      'Use both apex curbs.',
    ],
    beginnerMistakes: [
      'Trying to carry one single arc through the whole corner',
      'Running too wide in the center section',
      'Not using the curbs at either apex',
    ],
    priority: 'line',
  },
  turn9_10: {
    trodAdvice:
      'Open up Turn 9 to straighten the car before Turn 10. Do not carry steering ' +
      'angle from T9 into the T10 approach. Straighten, then brake for T10. ' +
      'T10 exit speed is the most important speed on the entire track — ' +
      'it carries down the full front straight.',
    keyPhrases: [
      'Open up T9. Straighten before T10.',
      'T10 exit is everything.',
      'Sacrifice T9 for T10.',
    ],
    beginnerMistakes: [
      'Carrying steering from T9 into T10 approach (cannot brake properly)',
      'Trying to be fast through T9 instead of setting up T10',
      'Early throttle in T10 causing understeer on exit',
    ],
    priority: 'throttle',
  },
};

// ---------------------------------------------------------------------------
// Session Progression (T-Rod's learning sequence)
// ---------------------------------------------------------------------------

export interface SessionProgressionStep {
  /** Step number (1-based) */
  step: number;
  /** What the driver should focus on */
  focus: string;
  /** Detailed description */
  description: string;
  /** When to introduce this (lap ranges are approximate) */
  introduceLap: number;
  /** Telemetry signals that indicate readiness for this step */
  readinessSignals: string[];
}

export const TROD_SESSION_PROGRESSION: SessionProgressionStep[] = [
  {
    step: 1,
    focus: 'Lines and marks',
    description:
      'Learn the racing line. Hit your turn-in points, apex curbs, and track-out points. ' +
      'Do not worry about speed. Just hit the marks consistently. ' +
      'Vision is the key — look ahead to the next reference point.',
    introduceLap: 1,
    readinessSignals: [
      'Consistent turn-in points (GPS within 2m lap-to-lap)',
      'Hitting apex curbs (within 1m)',
      'Using full track width on exit',
    ],
  },
  {
    step: 2,
    focus: 'Shifts and car control',
    description:
      'Add proper gear selection. Downshift before corners, upshift on straights. ' +
      'Get comfortable with the car at moderate speed. Build rhythm.',
    introduceLap: 3,
    readinessSignals: [
      'Consistent gear selection at each corner',
      'Smooth RPM transitions',
      'No missed shifts or money shifts',
    ],
  },
  {
    step: 3,
    focus: 'Trail braking',
    description:
      'Hold light brake pressure as you turn in. Keep weight on the front tires. ' +
      'Release brake by mid-corner. This is where real speed lives. ' +
      'The brake trace should show a smooth taper, not a cliff.',
    introduceLap: 5,
    readinessSignals: [
      'Brake pressure visible past turn-in point (telemetry overlap)',
      'Smooth brake release curve (no spike-and-release)',
      'Improved corner entry speed without running wide',
    ],
  },
  {
    step: 4,
    focus: 'Throttle commitment',
    description:
      'At the apex, commit to full throttle. Not 60%, not 80% — 100%. ' +
      'The rental car does not have enough torque to spin. ' +
      'Waiting for the apex and then committing is faster AND safer than ' +
      'half-throttle through the whole corner.',
    introduceLap: 7,
    readinessSignals: [
      'Throttle position reaching 90%+ after apex',
      'No throttle hesitation (plateau at 50-70%) mid-corner',
      'Lap times improving through corner exit speed',
    ],
  },
];

// ---------------------------------------------------------------------------
// Utility: look up insights that apply to a specific corner
// ---------------------------------------------------------------------------

export function getInsightsForCorner(cornerId: SonomaCornerId): TRodInsight[] {
  return TROD_INSIGHTS.filter(
    (insight) => insight.cornerIds.length === 0 || insight.cornerIds.includes(cornerId),
  );
}

export function getInsightsForCategory(category: InsightCategory): TRodInsight[] {
  return TROD_INSIGHTS.filter((insight) => insight.category === category);
}

export function getInsightsForLapPhase(phase: ApplicableLaps): TRodInsight[] {
  return TROD_INSIGHTS.filter(
    (insight) => insight.applicableLaps === phase || insight.applicableLaps === 'all',
  );
}
