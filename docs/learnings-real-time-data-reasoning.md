# Real-Time Data Reasoning — Learnings & Portable Patterns

Personal learnings from building the AI Race Coach data reasoning layer. The goal: extract patterns that transfer to any domain where real-time data must drive real-time decisions.

---

## 1. Data Reasoning — General Patterns

### The Split-Brain Architecture Works Everywhere

The most important architectural decision: **separate fast reflexes from deep thinking**.

```
HOT PATH  (<50ms)  — Heuristic rules, no I/O, no network
COLD PATH (2-5s)   — LLM/ML analysis, richer but slower
FEEDFORWARD        — Anticipatory, based on known context ahead
```

This isn't unique to racing. Any system where you need to act on data in real-time benefits from this split:
- The hot path handles **"act now"** — pattern matching on the latest data point
- The cold path handles **"think deeper"** — multi-frame/multi-signal analysis with AI
- Feedforward handles **"prepare for what's coming"** — geofence, schedule, known sequence

**Key learning:** The hot path must NEVER wait for the cold path. They run independently. The cold path enriches future hot path decisions but never blocks current ones.

### Priority is Not Optional

Without priority, all signals are equal. In practice:
- A safety alert buried behind 3 technique tips = a missed safety alert
- A motivational nudge interrupting a critical instruction = noise

**Pattern:** P0 (safety/critical) → P1 (actionable) → P2 (analytical) → P3 (informational). P0 always preempts. Stale messages expire. Queue has a max size.

**Portable insight:** In any real-time system, define your priority tiers upfront. Ask: "If this message arrives 3 seconds late, does it still matter?" If not, it expires.

### Timing is as Important as Content

The right message at the wrong time is the wrong message.

**Blackout zones:** There are moments when ANY information is harmful — the user is in a high-cognitive-load state and cannot process new input. We blackout coaching during mid-corner/apex because the driver literally cannot spare the attention.

**Cooldown:** After delivering a message, enforce silence. The user needs time to process and act. Flooding with messages is worse than silence.

**Portable insight:** Every real-time advisory system needs:
1. A state machine for delivery timing (not just a cooldown timer)
2. Blackout states based on user context (not just system state)
3. Different timing parameters per user skill/experience level

### The User Model Changes Everything

Beginners and experts need fundamentally different treatment:

| Dimension | Beginner | Expert |
|-----------|----------|--------|
| Message style | Feel-based, simple | Data-driven, precise |
| Timing | Longer cooldown, more blackouts | Shorter cooldown, fewer blackouts |
| Content | One thing at a time | Multiple signals simultaneously |
| Approach | "Do this now" (directive) | "What do you think?" (reflective) |
| Session start | Suppress advanced topics | Full access immediately |

**Key learning from Ross Bentley:** The progression is paragraph → sentence → trigger phrase. First exposure = full explanation. Repeated = just the keyword. This is true in any domain — a nurse doesn't need "check blood pressure because hypertension risk factors include..." after the 1000th patient. They need "BP check."

### Fear Hides in Data

Ross Bentley's insight: drivers hesitate because of fear but won't admit it. The data shows it — "squiggly lines" in telemetry that reveal self-preservation instinct.

**Portable insight:** In any domain, the stated reason for suboptimal behavior is rarely the real reason. The data tells the truth. A factory operator who consistently avoids a setting range might be afraid of a machine fault they experienced once. The system should detect the pattern and address the underlying cause, not just the symptom.

### Session Goals Focus Both Human and System

Ross Bentley: "1-3 specific physical changes per session. More causes overload."

When the user sets goals before a session:
- The system knows what to prioritize (bias rule activation toward goal-related actions)
- The user has a framework for self-evaluation
- Post-session review has a clear success metric

**Portable insight:** Pre-session goal setting isn't just UX — it's a filtering mechanism for the reasoning engine. It reduces noise by giving the system permission to deprioritize things that aren't relevant today.

### Improvement Tracking is a Motivator

People want to see progress. Lap-over-lap improvement tracking with encouragement ("Exit speed up 3 mph!") is simple to implement and powerful for engagement.

**Portable insight:** If your system can detect that the user is getting better at something, tell them. Immediately. Not in a report 3 days later.

---

## 2. Telemetry — Practical Lessons

### Mixed Data Rates are the Norm

In our system: GPS at 25Hz, OBD at 5-8Hz. In any real-world system, sensors report at different rates.

**Solution:** Time-based windows, not frame-count windows. A "100-frame window" means 4 seconds at 25Hz but 12 seconds at 8Hz. A "10-second window" means 10 seconds regardless of source rate.

**Implementation:** Store `{ time, value }` pairs. Trim by `frame.time - WINDOW_DURATION_S`. This one decision eliminated an entire class of bugs.

### Validate Before You Calculate

GPS coordinates of (0, 0) are valid numbers but invalid locations. The haversine formula will happily compute the distance from Null Island to your track and give you garbage results.

**Pattern:** `isValidGps()` guard before any geo calculation. Same principle applies to any sensor: validate physical plausibility before running algorithms. Temperature of -273.16°C? Heartrate of 300bpm? Reject, don't process.

### Performance Optimization for Hot Paths

At 25Hz, you have 40ms per frame. Every allocation counts.

What worked:
- **Pre-filter before expensive math:** Equirectangular approximation (cheap multiply) before haversine (expensive trig). Skip corners >300m away without computing exact distance.
- **Map/Set over Array:** `Map.get(action)` is O(1) vs `array.find()` is O(n). At 25Hz, this matters.
- **Single-pass algorithms:** Compute variance in one pass (running sum + sum of squares), not map→reduce.
- **Avoid allocations in the hot loop:** No `array.map()`, no `array.filter()`, no spread operators in the frame processing path.

**Portable insight:** Profile your hot path. If it runs at high frequency, micro-optimizations compound. The rule: allocation-free, branch-predictable, O(1) lookups.

### Latency Budget is a Design Constraint

Our budget: 300-500ms from telemetry event to audio output. Brian Luc (Edge mentor): "Feedback 800ms late is worse than silence."

This constraint shaped every decision:
- Hot path must be <50ms (leaves room for audio synthesis)
- Cold path is async and never blocks
- Safety messages bypass the queue entirely

**Portable insight:** Define your latency budget first. It determines your architecture. A 50ms budget means no network calls. A 500ms budget means maybe one. A 5s budget means you can call an LLM. Design from the constraint, not toward it.

### Hysteresis Prevents Oscillation

Without hysteresis, the driver model oscillates: BEGINNER → INTERMEDIATE → BEGINNER every few seconds. We added a 5-second hold before allowing level changes.

**Portable insight:** Any classification system operating on streaming data needs hysteresis. Otherwise you get flip-flopping alerts, rapidly changing UI states, and confused users. The threshold to enter a state should be different from the threshold to exit it (or use a time-based hold).

---

## 3. Porting to Other Industries

### The Abstract Pattern

Every domain has this structure:

```
Sensor Data Stream → Enrichment → User Model → Decision Engine → Timed Delivery → Feedback
     (raw)          (derived)    (context)     (what to say)    (when to say)   (did it help?)
```

The specific signals, rules, and messages change. The architecture doesn't.

### Manufacturing — Machine Operator Coaching

**Direct parallels:**

| Racing | Manufacturing |
|--------|--------------|
| TelemetryFrame (speed, brake, throttle, G) | MachineFrame (RPM, feed rate, vibration, temperature) |
| Corner phases (STRAIGHT, BRAKE_ZONE, APEX) | Operation phases (SETUP, CUTTING, COOLDOWN, CHANGEOVER) |
| Driver Model (BEGINNER/INTERMEDIATE/ADVANCED) | Operator Model (TRAINEE/CERTIFIED/EXPERT) |
| Blackout during mid-corner | Blackout during active cut (don't distract with screen pop-ups) |
| OVERSTEER_RECOVERY (P0 safety) | TOOL_BREAK_IMMINENT / THERMAL_RUNAWAY (P0 safety) |
| HUSTLE (lazy throttle) | UNDERFEEDING (operator not pushing feed rate to optimal) |
| "Hard initial!" (trigger phrase) | "Feed up!" / "Check insert!" (shop floor vocabulary) |
| Session goals: "Focus on braking" | Shift goals: "Focus on surface finish in batch 47" |
| Lap-over-lap improvement | Part-over-part cycle time improvement |

**What transfers directly:**
- Priority queue with safety preempt
- Timing state machine with operation-phase blackout
- Operator model that adapts language complexity
- Pre-shift goal setting (1-3 focus areas)
- Shift-over-shift performance tracking

**What's different:**
- Cycle times are longer (minutes vs seconds per "lap")
- Sensors are different (vibration, acoustic emission, power draw)
- Safety regulations (OSHA) dictate minimum alert requirements
- Multi-machine: one operator may oversee 3+ machines

### Healthcare — Clinical Decision Support

**Direct parallels:**

| Racing | Healthcare |
|--------|-----------|
| TelemetryFrame | VitalsFrame (HR, BP, SpO2, respiratory rate, temperature) |
| Corner phases | Patient states (STABLE, DETERIORATING, ACUTE, RECOVERY) |
| Driver Model | Clinician Model (RESIDENT/ATTENDING/SPECIALIST) + Patient acuity |
| Blackout during apex | Don't alert during active procedure / code |
| OVERSTEER_RECOVERY (P0) | SEPSIS_ALERT / CARDIAC_ARREST (P0) |
| Cold path (Gemini analysis) | ML-based risk score, differential diagnosis support |
| Feedforward (geofence) | Anticipatory: "Patient X due for reassessment in 15 min" |
| Timing gate cooldown | Alert fatigue prevention (biggest problem in clinical monitoring) |
| Session progression | Shift progression (suppress non-critical early, ramp up as shift progresses) |
| Skill-adapted humanization | Resident: "Consider sepsis workup — lactate, cultures, fluids." Attending: "Lactate 4.2, MAP 58. Sepsis bundle." |

**What transfers directly:**
- Priority queue (critical vs informational alerts) — directly addresses alert fatigue
- Timing state machine — don't interrupt procedures, enforce spacing between alerts
- User model — different information density for residents vs attendings
- Trigger phrases — experienced clinicians respond to "MAP dropping" not "Mean Arterial Pressure is decreasing below the threshold associated with..."
- Improvement tracking — "Your early warning score response time improved 2 minutes this shift"

**What's different:**
- Life-critical: false negatives have catastrophic consequences (must be more conservative)
- Multi-patient: clinician manages 4-20 patients simultaneously
- Regulatory: FDA/CE clearance for clinical decision support software
- Evidence-based: every rule needs a citation, not just a coaching intuition
- Explainability: "why did you alert me?" must have a traceable answer

### Common Cross-Industry Implementation Steps

1. **Define the frame:** What's your TelemetryFrame equivalent? What are the signals, what rate do they arrive at?
2. **Define phases:** What are the "corner phases" of your domain? When is the user in a high-load state?
3. **Define priorities:** What's P0 (safety/critical)? What's P3 (nice to know)?
4. **Define the user model:** How do you classify experience? What changes per level?
5. **Define blackout:** When should the system NEVER speak?
6. **Build hot path first:** Deterministic rules that fire <50ms. Get this working before adding AI.
7. **Add cold path:** LLM/ML enrichment that runs async and enqueues results.
8. **Add timing:** State machine + priority queue + cooldown + blackout.
9. **Add user model:** Adapt everything above per user level.
10. **Add feedback loop:** Improvement tracking, session goals, cross-session persistence.

### The Real Differentiator

Garmin Catalyst (our competition) has rules and data. What it doesn't have:
- A user model that adapts
- Timing awareness (it talks mid-corner)
- Priority (all messages are equal)
- Human coaching wisdom encoded (Ross Bentley, T-Rod)
- Session intelligence (goals, improvement tracking)

**The same gap exists in every industry.** Manufacturing alert systems don't know if you're a trainee or a 20-year veteran. Hospital monitors don't suppress non-critical alerts during a code. Industrial dashboards don't say "nice improvement on that batch."

The opportunity is in the timing, the adaptation, and the humanity — not just the data.

---

### Ultra Trail Running — Real-Time Coaching for Endurance Athletes

This is where the racing patterns feel most natural. Ultra trail running shares the same core challenge: a human performing at their limit, under fatigue, needing the right information at the right moment — not more information.

**Direct parallels:**

| Racing | Ultra Trail Running |
|--------|-------------------|
| TelemetryFrame (speed, G, brake, throttle) | RunnerFrame (HR, pace, cadence, elevation, power, HRV) |
| Corner phases (STRAIGHT, BRAKE_ZONE, APEX) | Terrain phases (FLAT, CLIMB, TECHNICAL_DESCENT, AID_STATION, SUMMIT) |
| Driver Model (BEGINNER/INTERMEDIATE/ADVANCED) | Runner Model (NOVICE/EXPERIENCED/ELITE) + fatigue state |
| Blackout during mid-corner | Blackout during technical descent (cognitive load is maximal, don't distract) |
| OVERSTEER_RECOVERY (P0 safety) | CARDIAC_DRIFT_ALERT / HYPOTHERMIA_RISK / BONK_IMMINENT (P0 safety) |
| HUSTLE (lazy throttle on exit) | PACE_DROP (runner slowing below target on runnable section — fatigue or laziness?) |
| Session progression (suppress advanced early) | Race progression (first 30km: only hydration/nutrition reminders. After 50km: unlock pacing adjustments) |
| "Hard initial!" (trigger phrase) | "Shorten stride!" / "Eat now!" / "Power hike!" (field-tested vocabulary) |
| Feedforward (geofence before corner) | Feedforward: "Climb starts in 500m — eat something now, you won't want to at km 47" |
| Lap-over-lap improvement | Split-over-split pacing, climb-over-climb power output comparison |
| Pre-session goals (1-3 focus areas) | Pre-race strategy: "Focus on nutrition every 30min, keep HR under 155 on climbs, don't chase early" |
| Cold path (Gemini analysis) | ML-based fatigue prediction, DNF risk, pace plan recalculation |

**What makes ultra trail uniquely interesting:**

1. **Fatigue is the dominant variable.** In racing, a driver's capability is roughly constant across a session. In ultra trail, the runner degrades continuously over 10-30+ hours. The coaching system must model this decay and adjust expectations dynamically. A pace of 6:00/km at km 10 is lazy. The same pace at km 80 might be heroic.

2. **Nutrition/hydration timing is a feedforward problem.** You don't eat when you're hungry — you eat 30 minutes BEFORE you'll be hungry. This is exactly our geofence feedforward pattern: "You're approaching a climb + it's been 25 minutes since last intake → eat now." The data: elapsed time since last nutrition event + upcoming elevation profile + current HR trend.

3. **The "fear" signal is real here too.** Ross Bentley sees fear in brake traces. In ultra trail, you see it in technical descents — cadence drops, pace drops more than terrain justifies, HR stays elevated (anxiety, not effort). The runner won't say "I'm scared of this descent." The data will.

4. **Mental state matters more than physical.** After 60km, finishing is 80% mental. The coaching system needs to detect when the runner is in a dark place (pace collapse not explained by terrain or HR) and switch from technique coaching to psychological support: "You've done this before. One aid station at a time."

5. **The "hustle zone" is real.** Just like Ross's lazy throttle on exits — runners coast on flat sections after a big climb. They've earned a mental break but they're bleeding time. A well-timed "Pick it up on the flat — this is where you make time" is the ultra equivalent of "Hustle! Squirt the throttle!"

**Sensor stack for ultra trail:**

| Device | Rate | Data |
|--------|------|------|
| GPS watch (Garmin/COROS) | 1Hz GPS, 1Hz HR | pace, distance, elevation, heart rate |
| Chest strap (HRM-Pro) | 1Hz | HR, running dynamics (cadence, GCT, vertical oscillation) |
| Stryd power meter | 1Hz | running power (watts), form power, leg spring stiffness |
| Environmental | periodic | temperature, humidity, altitude (barometric) |

**The hot path rules for ultra trail:**

| Rule | Condition | Priority | Message (beginner) |
|------|-----------|----------|-------------------|
| CARDIAC_DRIFT | HR > threshold AND pace dropping | P0 | "Walk now. Heart rate too high." |
| BONK_RISK | >45min since last nutrition + HR dropping + pace dropping | P0 | "Eat something. Right now." |
| HYPOTHERMIA | Pace collapse + temp < 5°C + wet conditions | P0 | "Put on your jacket. Stop and layer up." |
| POWER_HIKE | Grade > 15% AND pace < power-hike threshold | P1 | "Power hike here. Save the legs." |
| PACE_HIGH | Current effort > race plan by 10%+ in first third | P1 | "Easy. You're going out too fast." |
| PACE_DROP | Runnable terrain + pace well below target | P3 | "Pick it up. This is free speed." |
| NUTRITION | Elapsed > 25min since last intake | P1 | "Time to eat. Don't skip this one." |
| HYDRATION | Elapsed > 15min since last drink | P1 | "Drink. Small sips." |
| CADENCE_DROP | Cadence < 160 on flat | P3 | "Quick feet. Shorten your stride." |
| SUMMIT_PREP | Approaching summit (elevation gain flattening) | Feedforward | "Summit soon. Prepare to run the top." |

**What's different from racing:**

- **Much longer sessions** (10-30+ hours vs 20-minute sessions). Session progression has more phases.
- **Self-care actions** (eat, drink, layer) that racing doesn't have. These are P1 — not optional.
- **No "track"** — the route is known but terrain varies enormously. The feedforward path uses GPX elevation profile instead of corner coordinates.
- **Crew/pacer interaction** — at aid stations, the system could brief the crew: "Runner is 8% behind plan, HR trending high, needs calories and encouragement."
- **Weather is a variable** — racing has track temp but ultra trail has rain, wind, altitude, night transitions that all affect strategy.
- **DNF prediction** — a cold path ML model that estimates DNF probability based on current state vs historical data. Not to discourage, but to trigger intervention: "This is the section where 40% of DNFs happen. You're stronger than your pace suggests."

**The Ross Bentley parallel:**

Ross said he spends more time learning about the driver than coaching them. The same is true for ultra trail — the best coaches know their athlete's patterns:
- "You always go out too fast in the first climb"
- "You stop eating after km 60"
- "You're stronger than you think on the second half"

A cross-session runner profile that tracks these patterns becomes the most valuable coaching tool. Not "your HR was 155" — but "last time you ignored nutrition at km 55, you bonked at km 70. Don't repeat that."

---

*Adrian Catalan — April 2026*
*Built during the GDE Trustable AI Field Test project*
