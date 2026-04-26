# Pre-Race Chat — Integration Contract

**Owner:** UX Team (Rabimba)
**Consumer:** Data Reasoning (Adrian)
**Status:** Interface ready, awaiting UX implementation

---

## What This Is

Before a session starts, the driver sets 1-3 goals for their track session. Ross Bentley (Speed Secrets author, Garmin Catalyst consultant) confirmed this is how professional coaching works:

> "1-3 specific physical changes per session. More causes overload."
> — Ross Bentley, Apr 15 mentorship session

The UX team builds the chat/form UI. Data Reasoning consumes the output to bias real-time coaching.

---

## Interface: `SessionGoal`

Defined in `koru-application/src/types.ts`:

```typescript
export interface SessionGoal {
  id: string;
  focus: 'braking' | 'throttle' | 'vision' | 'lines' | 'smoothness' | 'custom';
  description: string;            // e.g. "Work on harder initial brake application in Turn 7"
  source: 'pre_race_chat' | 'auto_generated' | 'coach_assigned';
  prioritizedActions?: CoachAction[];  // Hot path rules to boost when this goal is active
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique goal ID (e.g. `"goal-braking-t7"`) |
| `focus` | enum | Yes | Category: `braking`, `throttle`, `vision`, `lines`, `smoothness`, or `custom` |
| `description` | string | Yes | Human-readable goal description |
| `source` | enum | Yes | Use `'pre_race_chat'` for goals from the chat UI |
| `prioritizedActions` | CoachAction[] | No | Optional list of hot path rules to prioritize. See mapping below. |

### Focus → Suggested `prioritizedActions` Mapping

| Focus | Suggested Actions | What They Detect |
|-------|------------------|-----------------|
| `braking` | `THRESHOLD`, `SPIKE_BRAKE`, `TRAIL_BRAKE` | Brake pressure, trace quality, trail braking |
| `throttle` | `HUSTLE`, `COMMIT`, `EARLY_THROTTLE` | Lazy throttle, commitment, premature throttle |
| `vision` | `PUSH`, `COAST` | Looking ahead, staying committed |
| `lines` | `TURN_IN`, `APEX` | Corner entry and apex proximity |
| `smoothness` | `COGNITIVE_OVERLOAD`, `LIFT_MID_CORNER` | Input smoothness, mid-corner stability |

---

## How to Set Goals

Call `coachingService.setSessionGoals(goals)` **before the session starts** (before the first `processFrame`).

```typescript
import { CoachingService } from './services/coachingService';
import type { SessionGoal } from './types';

const service = new CoachingService();

// From pre-race chat UI
const goals: SessionGoal[] = [
  {
    id: 'goal-braking',
    focus: 'braking',
    description: 'Work on harder initial brake application',
    source: 'pre_race_chat',
    prioritizedActions: ['THRESHOLD', 'SPIKE_BRAKE'],
  },
  {
    id: 'goal-throttle',
    focus: 'throttle',
    description: 'Full throttle commitment on corner exits',
    source: 'pre_race_chat',
    prioritizedActions: ['HUSTLE', 'COMMIT'],
  },
];

service.setSessionGoals(goals);
// Max 3 goals enforced — extra goals are silently dropped
```

---

## What Data Reasoning Needs From the Chat

The pre-race chat should produce an array of `SessionGoal` objects. The minimum viable interaction:

### Option A: Simple Form (Recommended for v1)
```
"What do you want to focus on today?"
☐ Braking technique
☐ Throttle commitment
☐ Vision / looking ahead
☐ Racing lines
☐ Smoothness / consistency
☐ Custom: [_____________]
```

Each selection maps to a `SessionGoal` with pre-configured `prioritizedActions`.

### Option B: Conversational (Future)
LLM-powered chat where the driver says "I want to work on my braking in Turn 7" and the LLM extracts structured `SessionGoal` objects. Rabimba mentioned using "on-demand adapters" based on the chat — this fits perfectly.

### Option C: Coach-Assigned (Future)
Ross Bentley or another human coach assigns goals based on previous session review. Source would be `'coach_assigned'`.

---

## Constraints

- **Max 3 goals.** Anything beyond 3 is dropped. Ross Bentley is explicit about this.
- **Goals must be set before session starts.** Changing mid-session is not supported yet.
- **Beginner focus.** For our May 23 field test, all goals should be beginner-appropriate. Avoid jargon.
- **Track-agnostic.** Goals should work on any track (no "Turn 7" references in v1).

---

## Example Pre-Race Chat Flow (Suggested)

```
AI: "Hey! Before we hit the track, what do you want to focus on today?
     Pick up to 3 things:"

Driver: "I want to work on my braking and being smoother"

AI: "Got it! Today's focus:
     1. 🛑 Braking — I'll coach you on harder initial application
     2. 🎯 Smoothness — I'll remind you to keep inputs steady
     
     Ready to go? Let's do this!"

→ Produces:
[
  { id: "goal-1", focus: "braking", description: "Harder initial brake", source: "pre_race_chat", prioritizedActions: ["THRESHOLD", "SPIKE_BRAKE"] },
  { id: "goal-2", focus: "smoothness", description: "Steady inputs", source: "pre_race_chat", prioritizedActions: ["COGNITIVE_OVERLOAD", "LIFT_MID_CORNER"] }
]
```

---

## Testing

```bash
cd koru-application
npx vitest run src/services/__tests__/coachingServicePhase6.test.ts
```

Tests verify:
- Goals are stored correctly
- Max 3 enforcement
- Empty goals by default

---

## Questions?

Ping Adrian in the pod chat or open an issue on the repo.
