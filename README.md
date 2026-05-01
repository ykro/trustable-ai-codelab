# Trustable AI Race Coach

Today's best telemetry systems — including the SOTA Garmin Catalyst — run on fixed, deterministic rules. They tell you what went wrong after the fact, with numbers. This project takes a different approach: a multimodal, agentic AI system built on Google's stack — Gemini API for cloud reasoning today, with on-device inference (Gemini Nano via the Chrome Prompt API, or a Gemma model) explored as part of the roadmap — that processes real-time data streams to deliver context-aware coaching as it happens, adapted to driver skill level.

The goal is to build a reference architecture that proves a split-brain AI can be trusted in a mission-critical, zero-latency environment. The patterns and learnings from high-frequency racing telemetry are designed to translate to broader enterprise domains where real-time AI decision-making under pressure is the challenge.

```
Catalyst tells you what you did wrong with numbers.
This system tells you in real time how to adapt and fix it, adjusted to your skill level.
```

## Table of Contents

- [April 29 Technical Gate — Data Reasoning Checkpoint](#april-29-technical-gate--data-reasoning-checkpoint)
  - [Domain Expertise Layer](#domain-expertise-layer)
- [Post-Gate Feedback (April 29 review)](#post-gate-feedback-april-29-review--what-changed-and-why)
- [Sonoma Field Test — Validation Plan (May 23, 2026)](#sonoma-field-test--validation-plan-may-23-2026)
- [Roadmap](#roadmap)
  - [Data Reasoning](#data-reasoning)
  - [Other pods (Edge / AGY / UX) — see user-stories.md](#edge--telemetry-agy-pipeline-ux--frontend)
  - [Future Work](#future-work)
- [Hardware Stack](#hardware-stack)
- [Architecture](#architecture)
  - [Split-Brain Coaching Engine](#split-brain-coaching-engine)
  - [Coach Personas](#coach-personas)
- [Onboarding](#onboarding)
- [streaming-telemetry-server](#streaming-telemetry-server)
- [koru-application](#koru-application)
- [Tech Stack](#tech-stack)
- [Data Reasoning Documentation](docs/data-reasoning.md)

---

## April 29 Technical Gate — Data Reasoning Checkpoint

This section is the entry point for the architecture + code review on **April 29, 2026**. It summarizes what data reasoning has shipped, how it sits in the larger system, and what reviewers should evaluate.

### What has shipped (Phases 0–5 complete, Phase 6 partial)

All work lives in [`koru-application/src/services`](koru-application/src/services) and [`koru-application/src/utils`](koru-application/src/utils). Detailed module-by-module documentation in [`docs/data-reasoning.md`](docs/data-reasoning.md).

| Phase | Status | What's in it |
|-------|--------|--------------|
| 0 — Foundation | ✅ | Types (`CornerPhase`, `TimingState`, `CoachingDecision`, `DriverState`), shared `geoUtils`, telemetry parser fix for Sonoma CSV, `OVERSTEER_RECOVERY` safety rule. |
| 1 — Detection + timing | ✅ | `CornerPhaseDetector` (GPS primary with equirectangular pre-filter + G-force fallback). `TimingGate` state machine with pre-blackout state restoration. |
| 2 — Priority queue | ✅ | `CoachingQueue` with P0–P3 priorities, 3s stale expiry, P0 preempt, max 5 items. |
| 3 — Driver model | ✅ | `DriverModel` classifies BEGINNER / INTERMEDIATE / ADVANCED from input smoothness + coasting ratio. Time-based 10s window, 5s hysteresis with re-promotion guard. |
| 4 — Test infrastructure | ✅ | Vitest, **185 tests across 32 files**, Sonoma CSV integration + 9 latency benchmarks (HOT path, humanization, P0 stress, burst, concurrent load, transition, stale expiry, COLD recovery, time-to-corner). Regressions for every fix found in the two post-gate audit rounds. |
| 5 — Domain expertise (coaching knowledge) | ✅ | See [Domain Expertise Layer](#domain-expertise-layer) below. Ross Bentley curriculum + T-Rod transcript + mentorship insights flow into decision rules, cold-path prompts, persona phrasing, hustle detection, and session-goal vocabulary. |
| 6 — Session intelligence | 🟡 partial | `SessionGoal` + `setSessionGoals()` with working `prioritizedActions` boost (floored at P1). `DriverProfile` / `DriverProfileStore` interfaces. In-session `PerformanceTracker`. **Pending:** message compression (owned), pre-race chat UI (UX), persistence backend (AGY). |

### Architecture in one diagram

The system is described as an 8-layer split, with data reasoning owning layers 2–6. Edge / Telemetry feeds layer 1, AGY Pipeline persists layer 8, UX renders layer 7. The 8 layers are *logical* boundaries (data contracts and responsibilities) rather than separate processes — in the current PWA build, layers 2–6 live inside `CoachingService` as a module graph. The boundaries show up in the type system, not the deployment topology, which is a deliberate trade-off for the <50ms HOT-path budget.

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │  DOMAIN EXPERTISE LAYER (Ross Bentley + T-Rod + mentorship)         │
   │  Decision rules • physics knowledge • persona phrasing • goals      │
   └─────────────┬─────────────────────────────────┬─────────────────────┘
                 │ (rules + thresholds)            │ (knowledge + prompts)
                 ▼                                 ▼
                     ┌─────────────────────────────────────────────────┐
                     │        koru-application (PWA, Pixel 10)         │
                     │                                                 │
 ┌──────────────┐SSE │  ┌─────────────┐    ┌──────────────────────┐    │
 │ RaceBox 25Hz │───►│  │ Telemetry   │───►│   CoachingService     │   │
 │ + OBDLink    │    │  │ Stream      │    │   ─────────────────   │   │
 │ + CSV replay │    │  └─────────────┘    │ DriverModel ─┐        │   │
 └──────────────┘    │                     │ CornerPhase ─┤        │   │
                     │                     │ TimingGate  ─┼─► HOT  │   │
                     │                     │ Queue       ─┤  COLD ─┼──►│ Gemini Flash
                     │                     │ Performance ─┤  FEED ─┤   │
                     │                     │ SessionGoals ┘        │   │
                     │                     └────────┬─────────────┘    │
                     │                              ▼                  │
                     │                  Audio (TTS + AudioContext)     │
                     └─────────────────────────────────────────────────┘

   Latency budget: <50ms HOT, 2–5s COLD, 150m geofence FEED.  "800ms late > silence."
```

**Decision routing:** every frame fans out to three paths. HOT runs heuristics + driver-adapted humanization in-process; COLD prompts Gemini with a skill-adapted prompt and physics context; FEEDFORWARD fires from a 150m geofence around known corners. All three enqueue into a single priority queue, and the TimingGate decides whether the dequeue actually speaks.

The **Domain Expertise Layer** is an explicit cross-cutting concern in the architecture (not a runtime layer in the request path). It is the source of every coaching-judgment value in the system: thresholds in the decision rules, mental-model content in the cold-path prompts, persona phrasing, goal vocabulary, and pedagogical principles like the hustle zone. It is documented in its own section below.

**Data reasoning enriches Gemini, not replaces it:** see the [Architecture → How Data Reasoning Works Alongside Gemini](#how-data-reasoning-works-alongside-gemini) section below for the full framing.

### Domain Expertise Layer

Coaching judgment is not heuristics-with-numbers. Every threshold, phrase, and decision rule in the data-reasoning code traces back to a specific source — an authored curriculum, a recorded coaching session, or an explicit mentorship conversation. We treat these sources as a **first-class architectural layer**: a curated body of domain knowledge that feeds the runtime layers, with attribution preserved end-to-end.

The full source list (Ross Bentley curriculum + mentorship, T-Rod transcript, Brian Luc mentorship, Garmin Catalyst as SOTA reference) and how each source maps into specific code artifacts is documented in [`docs/data-reasoning.md` → Domain Expertise Layer (provenance)](docs/data-reasoning.md#domain-expertise-layer-provenance).

#### Where it lives in code

The domain expertise is materialized in three artifacts:

- [`koru-application/src/utils/coachingKnowledge.ts`](koru-application/src/utils/coachingKnowledge.ts) — `RACING_PHYSICS_KNOWLEDGE` (the Ross Bentley mental-model corpus injected verbatim into every cold-path prompt) and `DECISION_MATRIX` (12 rules, each a tuple of `(action, condition string, telemetry predicate)`).
- [`koru-application/src/data/trodCoachingData.ts`](koru-application/src/data/trodCoachingData.ts) — patterns extracted from the T-Rod transcript, used to derive the BEGINNER phrasing and the four T-Rod-specific decision rules.
- [`koru-application/src/services/coachingService.ts` → `humanizeAction`](koru-application/src/services/coachingService.ts) — ~250 lines of skill-adapted phrasing across 5 personas × 3 skill levels × ~20 actions. The BEGINNER row is sourced from Ross Bentley trigger phrases + the T-Rod transcript verbatim where applicable.

#### Provenance map (selected)

| Code artifact | Source | Quote / reference |
|---|---|---|
| `RACING_PHYSICS_KNOWLEDGE → "Friction Circle (Clock Metaphor)"` | Ross Bentley curriculum | "12 o'clock is max braking, 6 is max acceleration, 3 and 9 are max cornering." |
| `DECISION_MATRIX → EARLY_THROTTLE` (`throttle>30 && \|gLat\|>0.6 && gLong<-0.1`) | T-Rod transcript | Repeated correction: "wait for the exit before getting on the gas." |
| `DECISION_MATRIX → SPIKE_BRAKE` (`brake>70 && gLong<-1.2`) | T-Rod transcript | "Brake trace should be a ski slope, not a cliff. Squeeze, don't stab." |
| `DECISION_MATRIX → COGNITIVE_OVERLOAD` | Ross Bentley mentorship Apr 15 | Fear and cognitive load are leading indicators a beginner is past their limit; signal: input-smoothness collapse. |
| `checkHustle` (`throttle 50–92% on exit, BEGINNER only`) | Ross Bentley mentorship Apr 15 | Hustle zones — "drivers get lazy mid-session; that last 10–15% throttle matters for exit speed." |
| `humanizeAction(BEGINNER, COMMIT)` → "Commit! Full throttle now — the car can take it." | Ross Bentley trigger phrases | Inside-out coaching: short, action-first, no jargon. |
| `humanizeAction(BEGINNER, COAST)` → "Pick a pedal — gas or brake. Stay committed!" | T-Rod transcript verbatim | Direct coaching command from the recorded session. |
| `SessionGoal` (max 3 per session) | Ross Bentley mentorship Apr 15 | "1–3 specific physical changes per session." |
| BEGINNER timing config: 3 s cooldown, blackout in MID_CORNER + APEX | Ross Bentley pedagogy | Beginners process slower; never coach mid-apex. |

A more complete map lives in [`docs/data-reasoning.md`](docs/data-reasoning.md#domain-expertise-layer-provenance).

#### Why this matters for the gate

Coaching judgment is the layer that separates this project from a heuristic-with-numbers system like Garmin Catalyst. The reviewer ask is to see the layer **explicitly**: where it comes from, where it lands in code, and how it is kept honest as the project evolves. The provenance map above is the primary deliverable; it lets a reviewer pick any line of coaching output and trace it back to its source material.

### What we'd value reviewer input on (April 29)

The hard technical gate is two days out. These are the areas where outside review would be most useful — both to validate decisions we're confident in and to surface concerns we may have under-weighted.

1. **Latency budget.** The HOT path is designed for <50ms; we now have a benchmark test ([`coachingService.latency.test.ts`](koru-application/src/services/__tests__/coachingService.latency.test.ts)) reporting mean and p99 over 1000 frames. We have not yet measured on a Pixel 10 with audio + Gemini in flight; that measurement is the most useful thing reviewers could push for.
2. **Safety bypass surface area.** P0 (`OVERSTEER_RECOVERY`, and future `BRAKE`) is the only intended path that bypasses the TimingGate. After PR #3, `boostForGoals` is floored at P1 so no goal-promoted action can reach P0. The TimingGate state machine (`OPEN → DELIVERING → COOLDOWN → BLACKOUT`) and the COOLDOWN-interrupted-by-BLACKOUT restoration in [`timingGate.ts`](koru-application/src/services/timingGate.ts) are the load-bearing pieces — fresh eyes are welcome.
3. **Driver model.** Smoothness + coasting are coarse proxies. The 10s window + 5s hysteresis + re-promotion guard keep the classification stable, but the underlying signals haven't been validated against actual coach assessments. Reviewer feedback on whether this is a reasonable v1 versus a placeholder would be useful.
4. **Offline behavior.** Cold path resets `lastColdTime = 0` on fetch failure so the next frame can retry. HOT + FEEDFORWARD work without network. Worth confirming the offline contract is clear enough for the May 23 Sonoma field test.
5. **Coaching content / Domain Expertise Layer.** `humanizeAction` covers 5 personas × ~20 actions × 3 skill levels — a lot of strings. The BEGINNER set is derived from Ross Bentley pedagogy and the T-Rod Sonoma session, and every threshold in `DECISION_MATRIX` is sourced. The [Domain Expertise Layer](#domain-expertise-layer) section documents the provenance map. A spot-check of any coaching line against its cited source would be useful.
6. **Cross-team contracts.** Phase 6.2 depends on UX (Rabimba) — see [`docs/pre-race-chat-contract.md`](docs/pre-race-chat-contract.md). Phase 6.3 depends on AGY Pipeline (Mike + Austin) — `DriverProfileStore` interface in [`types.ts`](koru-application/src/types.ts). Useful for reviewers to sanity-check whether these contracts are enough for the downstream pods to start.
7. **Test coverage.** 185 unit + integration tests across 32 files, including 9 latency benchmarks (HOT path, humanization, P0 fault, burst, concurrent, transition, stale, COLD recovery, time-to-corner) plus memory pressure, long-session, listener fan-out, network jitter, and frame-integrity tests. Two post-gate audit rounds each surfaced bugs that were closed with regression tests. Acknowledged gaps: no end-to-end test against the real Gemini endpoint, no real-Pixel-10 latency measurement (Sonoma is the place for that — see [Sonoma Field Test plan](#sonoma-field-test--validation-plan-may-23-2026)).

### Telemetry capability matrix (degraded modes)

If BT Classic on the OBDLink MX+ doesn't reach the PWA in time for May 23, the system runs in a degraded telemetry mode. A breakdown of what coaching capability survives in each channel set is documented in [`docs/data-reasoning.md` → Telemetry Capability Matrix](docs/data-reasoning.md#telemetry-capability-matrix-degraded-modes). Short version: GPS + IMU only retains roughly 60–70% of coaching actions, with FEEDFORWARD corner advice intact, but DriverModel classification leans BEGINNER because synthetic brake/throttle from G-force estimation have low variance.

### Comparison vs. Garmin Catalyst (the SOTA we're trying to beat)

|  | Garmin Catalyst | This project |
|---|---|---|
| Coaching model | Pure heuristic, fixed rules | Heuristic (HOT) + Gemini (COLD) + geofence (FEED) |
| Driver adaptation | None | Driver model classifies skill, adjusts cooldown / blackout / prompts |
| Timing | Always talks (even mid-corner) | TimingGate with blackout during apex / mid-corner |
| Track knowledge | Delta vs best lap (numbers) | Corner-specific advice, real-coach phrasing, physics |
| Personalization | One voice, one style | 5 personas × 3 skill levels |
| Hustle detection | No | Lazy-throttle detection on exits (Ross Bentley insight) |
| Session goals | No | 1–3 focus areas bias hot-path priority |
| Improvement tracking | Lap times only | Per-corner deltas, lap-over-lap encouragement |
| Offline | Yes | Yes for HOT + FEEDFORWARD; COLD requires network (degrades silently to HOT-only) |

---

## Post-Gate Feedback (April 29 review) — what changed and why

The Googler review returned **CONDITIONAL PASS** with six concrete asks (DR-1..6, one DR-7 for after Sonoma) plus updates to AGY-1 and UX-2 for cross-domain portability. Every ask is mapped to a user story in [`docs/user-stories.md`](docs/user-stories.md) with acceptance criteria. This section documents what each item was, how it was implemented, where it lives in code, and the test that proves it.

> Two follow-up audits ran on the implementation. Each surfaced real bugs that were then fixed; both rounds of fixes are listed inline below where they apply.

### DR-1 — Dynamic FEEDFORWARD geofence ([story](docs/user-stories.md#dr-1--dynamic-feedforward-geofence))

**The ask.** Replace the static 150m geofence — at 100 mph it gives only ~1.8s of cognitive headroom after a 1.5s TTS budget. Need a velocity-scaled trigger that holds time-to-event constant in seconds, not metres.

**What changed.** `getTriggerDistance(speedMph)` in [`coachingService.ts`](koru-application/src/services/coachingService.ts) returns `min(MAX_TRIGGER_M, max(MIN_TRIGGER_M, v_mps × (FEEDFORWARD_LEAD_S + TTS_BUDGET_S)))` with `LEAD_S=3.0`, `TTS_BUDGET_S=1.5`, `MIN=40m`, `MAX=250m`. At 30 mph → 60m, 60 mph → 121m, 100 mph → 201m, 140 mph → 250m (capped). Idle → 0m (no fire). The `MAX_TRIGGER_M` cap was added in audit-1 fix B3 to prevent the trigger from overlapping clustered corners (Sonoma T2/T3) at very high speed.

**Plus** — the second-round audit caught that even with the dynamic radius, `findNearestCornerWithinTriggerDistance` was picking the geometrically-closest corner without heading awareness, so for clustered corners along an approach line (T1/T2/T3) the second corner only became "nearest" after the C1↔C2 midpoint. A heading-aware "next corner ahead" predicate now rejects corners ≥ 90° behind the driver, with a fallback to nearest-only when GPS heading is not yet derivable.

**Tests proving it.** [`feedforwardGeofence.test.ts`](koru-application/src/services/__tests__/feedforwardGeofence.test.ts) (14 tests: scaling at 30/60/100 mph, idle, low-speed floor, MAX cap), [`feedforwardGeofence.timeToCorner.test.ts`](koru-application/src/services/__tests__/feedforwardGeofence.timeToCorner.test.ts) (TTC ≥ 4.5s at high speed, ≥ 3.0s low speed across every Sonoma corner), [`coachingService.clusteredCorners.test.ts`](koru-application/src/services/__tests__/coachingService.clusteredCorners.test.ts) (heading-aware on a synthetic 3-corner cluster).

### DR-2 — P0 stress test + documented bypass parameters ([story](docs/user-stories.md#dr-2--p0-stress-test--documented-bypass-parameters))

**The ask.** Document what triggers P0 and prove with a forced-fault test that the HOT path keeps firing safety alerts when the COLD path hangs or crashes.

**What changed.** A new "P0 Safety Bypass — parameters and guarantees" section in [`docs/data-reasoning.md`](docs/data-reasoning.md#p0-safety-bypass--parameters-and-guarantees) lists exact triggers (`OVERSTEER_RECOVERY` decision rule, plus the reserved `BRAKE` slot), bypass behaviors (skips TimingGate blackout, preempts queue, no humanization budget, no cold-path dependency, P0 floor on goal-boost), and failure modes that do NOT affect P0. The split-brain architecture was already structurally correct — `runColdPath` is dispatched via `void`, never awaited inside `processFrame`, so the test was provable without production-code changes.

**Tests proving it.** [`coachingService.p0Stress.test.ts`](koru-application/src/services/__tests__/coachingService.p0Stress.test.ts) — 7 cases injecting each fault (Promise that never resolves, sync throw, 5-second slow resolve, success control), asserting P0 emits at `priority === 0` within a 100ms wall-clock HOT budget regardless of cold-path state.

### DR-3 — HOT-path humanization ≤ 50ms with raw fallback ([story](docs/user-stories.md#dr-3--hot-path-humanization--50-ms-with-raw-command-fallback))

**The ask.** Make sure humanization can never push the HOT path over 50ms. If the text-parser slows down, fall back to raw robotic commands for the field test.

**What changed.** Every `humanizeAction` call is wrapped in `humanizeOrFallback`, which records per-call wall-clock latency in a 2000-element ring buffer (audit-2 swapped this from `Array.shift()` O(N) to circular-buffer O(1) push). Three escape valves:
1. **Single-frame tripwire** (>50ms on one call) — next emission falls back to raw label, then auto-disarms.
2. **N-of-M permanent fallback** (>25% breaches in last 100 frames) — humanization is permanently disabled for the rest of the session, raw labels for everything; one-shot `console.warn` and a public `isHumanizationPermanentFallback()` flag for the UX team to surface visually.
3. **Audit-2 widening of the B5 boundary** — the production latency metric now spans the entire synchronous HOT path including `drainQueue` and listener callbacks, not just the humanizer. The 50ms budget is now measured end-to-end.

**Tests proving it.** [`coachingService.humanizationBudget.test.ts`](koru-application/src/services/__tests__/coachingService.humanizationBudget.test.ts) (single-frame fallback + N-of-M escalation), [`coachingService.processFrameLatency.test.ts`](koru-application/src/services/__tests__/coachingService.processFrameLatency.test.ts) (full-path p99 < 50ms over 1000 frames).

### DR-4 — "Why over What" in COLD ([story](docs/user-stories.md#dr-4--why-over-what-prompt-restructuring-in-cold))

**The ask.** Use Gemini's physics context to explain root cause, not symptom. "You missed the apex *because your brake release was too abrupt, unloading the front tires*."

**What changed.** A new pure module [`coldPromptBuilder.ts`](koru-application/src/services/coldPromptBuilder.ts) with `buildColdPrompt(ctx)` and `computePhysicsContext(frames)`. The prompt has six structural sections: persona system prompt → physics knowledge block → current telemetry → **computed physics context** (lateral & longitudinal weight-transfer integrals, peak combined G, friction-circle utilization %, brake-release rate with ABRUPT flag, throttle-application rate, speed delta, AT_LIMIT flag) → root-cause-analysis directive ("do NOT restate the symptom — explain WHY in mechanical terms") → mandatory `Symptom: / Root Cause: / Fix:` output schema with the requirement that Root Cause cite at least one number from the context.

**Audit-1 fix B4** added a `brakeReleasedInWindow` boolean — when the telemetry window ends with the driver still on the brakes, the prompt now says "brake still applied at end of window (no release captured)" instead of a misleading near-zero release rate.

**Tests proving it.** [`coldPromptStructure.test.ts`](koru-application/src/services/__tests__/coldPromptStructure.test.ts) — 22 tests covering directive presence, physics-context population for missed-apex / late-brake / early-throttle / oversteer scenarios, output-schema requirements, skill-level adaptation, the brake-not-released flag, and a snapshot test on the canonical missed-apex prompt so future drift is reviewable.

### DR-5 — Eyes-up vision coaching in FEEDFORWARD ([story](docs/user-stories.md#dr-5--eyes-up-vision-coaching-in-feedforward))

**The ask.** Before high-speed corners (Sonoma T10 specifically), tell the driver where to look — not just what to do with the pedals.

**What changed.** Added optional `visualReference?: string` to the `Corner` type. `buildFeedforwardText(corner)` prepends the cue when set: `"T10: Eyes up to the bridge tire mark. Stay committed through the kink."` Tagged corners in the Sonoma fixture: T1 ("Eyes up to the brake marker", added in audit-1 fix P1), T7, T10, T11. Corners without `visualReference` keep the existing `name: advice` shape.

**Tests proving it.** Same [`feedforwardGeofence.test.ts`](koru-application/src/services/__tests__/feedforwardGeofence.test.ts) — six cases verifying corners with/without the cue, whitespace-only fallback, and the cue text reaches the emitted FEEDFORWARD message.

### DR-6 — Humanization safety override ([story](docs/user-stories.md#dr-6--humanization-safety-override-under-high-slip--high-speed-braking))

**The ask.** Under high-slip or high-speed braking, drop conversational humanization. A spin at 90 mph needs "Both feet in!" — not a polite suggestion.

**What changed.** Public predicate `shouldBypassHumanization(action, frame)` — returns true when (a) `OVERSTEER_RECOVERY` at any speed, or (b) BRAKE-class action (`BRAKE / THRESHOLD / SPIKE_BRAKE`) at speed > 70 mph. When true, the emitted message is the raw imperative from a small `SAFETY_OVERRIDE_TEXT` map ("Both feet in!", "Brake hard!"). Audit-1 removed `TRAIL_BRAKE` from the BRAKE-class set (it is a deliberate technique, not an emergency).

**Audit-1 fix B2** then closed a gap: the override text was correct but P1 actions like `THRESHOLD` were still subject to MID_CORNER blackout in the TimingGate. The fix promotes priority to P0 in `runHotPath` whenever the override predicate fires, so safety messages now bypass blackout *and* preempt the queue, matching DR-6's actual intent.

**Tests proving it.** [`coachingService.safetyOverride.test.ts`](koru-application/src/services/__tests__/coachingService.safetyOverride.test.ts) (4 base cases) and [`coachingService.safetyOverridePromotion.test.ts`](koru-application/src/services/__tests__/coachingService.safetyOverridePromotion.test.ts) (P1→P0 promotion under blackout, with controls).

### DR-7 — Abstract geofence triggers (post-Sonoma) ([story](docs/user-stories.md#dr-7--abstract-geofence-triggers-for-cross-domain-portability-post-sonoma))

**The ask.** Decouple FEEDFORWARD from track-coordinate-specific corner objects so the same engine can drive a delivery drone or an assembly-line stage.

**Status.** Not started. Explicitly out of scope for May 23 — no behavioral change required for the field test, this is a refactor task. The pattern is already documented in [`docs/learnings-real-time-data-reasoning.md`](docs/learnings-real-time-data-reasoning.md) (Appendix A "Cross-domain framework extensibility").

### Cross-pod feedback (revised asks)

The reviewer's framework-extensibility section also produced two revised asks for adjacent pods, both tracked in [`docs/user-stories.md`](docs/user-stories.md):

- **AGY-1 generic time-series schema** (Mike Wolfson + Austin) — storage schema must use a domain-agnostic envelope (`timestamp`, `sourceId`, `channels: { [name]: number | string }`) rather than naming `RPM/throttle/brake` at the top level.
- **UX-2 generic Session Initialization module** (Rabimba Karanjai) — pre-race chat built as a domain-agnostic component with driver-vs-operator labels passed in as configuration.

### What the reviewer flagged as portable today (no action — recognition)

The HOT/COLD/FEEDFORWARD tri-path routing engine, the P0 Safety Bypass mechanism, and the latency-budget monitoring pattern were called out as *"gold-standard patterns for any edge-AI system."* These are reflected in [`docs/learnings-real-time-data-reasoning.md`](docs/learnings-real-time-data-reasoning.md) for cross-industry portability — see Appendix A for the lessons distilled from this round of review.

### Status summary

| Item | Status | Closed by |
|---|---|---|
| DR-1 dynamic geofence | ✅ | Velocity scaling + MAX cap + heading-aware predicate |
| DR-2 P0 stress test + docs | ✅ | 7 fault-injection tests + bypass parameters section |
| DR-3 humanization budget | ✅ | Tripwire + raw fallback + N-of-M permanent fallback + circular buffer |
| DR-4 why-over-what COLD | ✅ | New `coldPromptBuilder.ts` + brake-not-released flag + 22 tests |
| DR-5 eyes-up FEEDFORWARD | ✅ Sonoma corners (T1/T7/T10/T11) | Pending: remaining Sonoma corners + non-Sonoma tracks |
| DR-6 safety override | ✅ | Predicate + override text + P1→P0 promotion under blackout |
| DR-7 abstract triggers | ⏸️ post-Sonoma | Documented as future-work pattern |
| AGY-1 generic schema | ⏳ owned by Mike + Austin | Story written, implementation pending |
| UX-2 generic init module | ⏳ owned by Rabimba | Story written, implementation pending |

---

## Sonoma Field Test — Validation Plan (May 23, 2026)

The April 29 review left us with six conditional-pass items (DR-1..6). All six are implemented on the `data-reasoning` branch and proved by unit tests (**185 passing across 32 files** — see [`docs/data-reasoning.md`](docs/data-reasoning.md#test-suite-layout)). The May 23 field test at Sonoma Raceway is where we verify the same behavior **on the car, at speed, in the helmet** — not in a unit test harness.

This section is the test plan: what runs at Sonoma, who runs it, what counts as pass/fail, and how each piece of feedback is checked.

### Test format (every session)

- **Driver:** Beginner driver, 2024 Subaru GR86 (automatic), Pixel 10 in cradle, Pixel Earbuds, RaceBox Mini + OBDLink MX+ wired up.
- **Engineer:** One person in the passenger seat with a laptop running session capture, watching a live HUD and the SSE log.
- **Session shape:** 20-minute on-track stint, 5–8 laps depending on traffic. Three planned stints across the day so we can re-run after fixes.
- **Recording:** Full telemetry captured to JSON via the AGY pipeline (or local file if AGY-2 is not yet shipped). Coaching events captured with timestamps. In-car GoPro for audio sanity-check (did the right phrase actually reach the helmet on time?).
- **Wet-lap procedure for safety override (DR-6):** the spin/high-slip cases are exercised on the **skid pad**, not on the racing line. We don't engineer spins at speed.

### Success criteria (overall)

A field test counts as **pass** if all of the following hold across at least one full 20-minute stint:

1. Zero hot-path coaching events delivered later than 500 ms after the trigger frame (measured via `event.timestamp` to `audio.firstSampleAt`).
2. Zero P0 safety alerts dropped, regardless of whether the COLD path was reachable.
3. Driver self-report: "I had time to act on the corner advice before the braking zone" (1–5 Likert, target ≥ 4 on average across corners).
4. No coaching delivered during MID_CORNER or APEX phases (verified by replaying the log against the TimingGate state).

### How each feedback item is verified at the track

| Feedback | What we measure | Pass criterion | How |
|---|---|---|---|
| **DR-1** Dynamic FEEDFORWARD geofence | Driver's `Time-to-corner` at the moment FEEDFORWARD fires, by corner. | At Sonoma's three highest-speed approaches (T2, T7 entry, T10), `time_to_corner ≥ 4.5 s` (3.0 s lead + 1.5 s TTS) on every fire across the stint. Slower corners (T11, T7 apex) accept ≥ 3.0 s. | Replay the captured `coachingEvents.json` against the GPS log; compute distance-to-corner at fire-time and divide by speed. Plotted alongside the static-150 m baseline for direct comparison. |
| **DR-2** P0 safety bypass under fault | P0 latency when the COLD path is artificially degraded. | P0 (`OVERSTEER_RECOVERY`) emits within 100 ms of the trigger frame whether COLD is healthy, throttled, or unreachable. | Engineer toggles three modes mid-session via a debug control: `cold:healthy`, `cold:throttled-5s`, `cold:offline`. We trigger oversteer-recovery on the skid pad in each mode and check the log. Mirrors the unit test `coachingService.p0Stress.test.ts` against real audio. |
| **DR-3** Humanization ≤ 50 ms | Per-frame humanization wall-clock time on the Pixel 10. | p99 across the full stint ≤ 50 ms; if any frame exceeds, the next emission is the raw label (the fallback is itself the safety net). | Production code already records the timing in a 2000-frame ring buffer (see DR-3 implementation). Engineer dumps the buffer at session end via a debug control and we plot the histogram. |
| **DR-4** "Why over What" COLD output | Form of the Gemini response. | At least 80% of COLD responses follow the `Symptom: / Root Cause: / Fix:` schema, and the Root Cause cites a number from the physics context. | Engineer reviews the captured COLD prompt+response pairs after each stint. Pass = at-a-glance form check + grep for "Root Cause:" in 80%+ of responses. The 20% slack accounts for Gemini occasionally drifting; if we see >40% drift, the prompt needs another pass. |
| **DR-5** Eyes-up vision coaching | Driver self-report on the three tagged corners (T7, T10, T11). | Driver reports "I knew where to look before the corner" on ≥ 2 of the 3 tagged corners during a debrief. | Post-stint debrief, structured questions per corner. We do *not* prompt the driver with "did the eyes-up cue help?" — we ask "where were you looking on the approach to T10?" first, and only if their description matches the cued reference do we count it as the cue working. |
| **DR-6** Humanization safety override | Output style during forced-fault skid-pad runs. | Under engineered oversteer on the skid pad, the audio output is the raw imperative (e.g. "Both feet in!") with no persona inflection. Under controlled brake events at 70+ mph (using a long approach to a marked cone), BRAKE-class output is also raw. | Skid pad: induce mild oversteer; record audio, transcribe, compare to the override map. Brake test: 70 mph + hard braking into a cone, 3 repetitions, all should fire raw imperative. Cooldown lap to reset between attempts. |

### What we are *not* validating at Sonoma

- **DR-7 (abstract geofence triggers)** — explicitly out of scope for May 23. It is a post-Sonoma refactor with no behavioral change required.
- **AGY-1 generic schema** — owned by Mike + Austin. If their generic schema is shipped before May 23 we capture sessions with it; otherwise we capture to local JSON and migrate offline.
- **UX-2 Session Initialization module** — owned by Rabimba. If it ships, we use it for goal entry. If not, we set goals manually via a fallback form.

### Failure → fix loop

If any pass criterion fails on the first stint, we have two more stints across the day. The flow is:

1. Pull the log onto the engineer laptop in the paddock between stints.
2. Identify the failing frames (we have the timestamp from the criterion).
3. Re-run the relevant unit test against the captured frame to see if it would have caught the bug. If yes — the test is wrong / not strict enough; tighten it. If no — write the missing test before changing production code.
4. Patch on the spot if the fix is small (config tweak, threshold change). Defer to a follow-up commit if not.
5. Re-deploy to the Pixel 10 and run the next stint.

This is the same discipline the unit suite enforces (see [`docs/data-reasoning.md` → Test discipline](docs/data-reasoning.md#test-discipline--how-new-tests-get-added)). The goal is that nothing fixed at Sonoma stays fixed *only* at Sonoma — every track-side patch lands as a new test before the day ends.

### Artifacts produced

By the end of May 23 we expect:

- 3 × full-stint session captures (telemetry + coaching events + audio).
- A markdown debrief of pass/fail per criterion with the supporting plot or grep.
- A list of new test cases derived from any frame that surprised us — to be added to the suite the next day.
- An updated `docs/data-reasoning.md` Test Suite section reflecting the new test count.

---

## Roadmap

> Cross-team TODOs below have testable user-story versions with acceptance criteria in [`docs/user-stories.md`](docs/user-stories.md).

### Data Reasoning

> **Focus: BEGINNER drivers** (Team 1 Beginner Pod). All coaching logic, humanization, and thresholds are tuned for beginner skill level first. The same codebase supports intermediate/advanced via the Driver Model, but the primary target is someone on track for the first time.

See [`docs/data-reasoning.md`](docs/data-reasoning.md) for detailed feature documentation and how to run tests.

**Phase 0-3: Foundation + Core Engine** (implemented on `data-reasoning` branch)
- [x] **Timing state machine** — OPEN → DELIVERING → COOLDOWN → BLACKOUT. P0 safety bypasses blackout. Blackout during MID_CORNER + APEX for beginners. Restores COOLDOWN cleanly when BLACKOUT interrupts it.
- [x] **Priority queue** — P0 safety, P1 tactical, P2 strategic, P3 encouragement. Max 5 items, 3s stale expiry, preempt for safety.
- [x] **Driver model** — Skill classification from smoothness + coasting ratio. Time-based 10s window (handles 8Hz OBD + 25Hz RaceBox). 5s hysteresis with re-promotion guard.
- [x] **Corner phase detection** — GPS primary (APEX/MID_CORNER/TURN_IN/EXIT/BRAKE_ZONE all reachable, ordering verified by tests) + G-force fallback (track-agnostic). Equirectangular pre-filter for performance.
- [x] **Foundation types** — CornerPhase, TimingState, CoachingDecision, DriverState, OVERSTEER_RECOVERY, telemetry parser fix for Sonoma CSV.

**Phase 4: Test Infrastructure** (implemented)
- [x] **78 tests across 9 files** — geoUtils, CornerPhaseDetector, TimingGate, CoachingQueue, DriverModel, DecisionMatrix, PerformanceTracker, CoachingService Phase 6, Sonoma CSV integration. Includes regression tests for the cooldown-during-blackout fix, GPS phase reachability, hysteresis, and session-goal priority boost.
- [x] **Vitest setup** — `npm test` runs all tests.

**Phase 5: Coaching Knowledge Enrichment** (implemented)
- [x] Ross Bentley mental models (7) + T-Rod coaching patterns (5) in racing physics knowledge
- [x] 4 new decision matrix rules: EARLY_THROTTLE, LIFT_MID_CORNER, SPIKE_BRAKE, COGNITIVE_OVERLOAD
- [x] Skill-adapted humanization (beginner: feel-based T-Rod + Ross Bentley trigger phrases, advanced: data-driven)
- [x] Session progression (time-based phases, suppress advanced actions for beginners)
- [x] Cold path prompts adapted per skill level
- [x] Ross Bentley trigger phrases: "Hard initial!", "Eyes up!", "Hustle!", "Squeeze don't stab"
- [x] Hustle/laziness detection — detects lazy throttle on exits for beginners (Ross Bentley insight)

**Phase 6: Session Intelligence** (in progress)
- [ ] **6.1 Message Compression** — paragraph → sentence → trigger phrase progression. First time: full instruction. Repeated: trigger phrase only. Per action+corner tracking within session. (Ross Bentley: trigger phrases are the goal state). *Owned by data-reasoning, no external blockers — next task to land in this branch.*
- [x] **6.2 Pre-Session Goal Setting** — `SessionGoal` type + `setSessionGoals()` API. `prioritizedActions` now actually bias the hot path: a listed action gets a one-tier priority boost (P3→P2, P2→P1; P0 stays P0).
  - *Needs from UX (Rabimba):* A pre-race chat screen that collects 1–3 goals, serializes them to the `SessionGoal[]` shape in [`docs/pre-race-chat-contract.md`](docs/pre-race-chat-contract.md), and calls `coachingService.setSessionGoals(goals)` before the live session starts.
  - *Needs from data-reasoning (after UX lands):* emit P3 encouragement when the associated `PerformanceTracker` metric improves.
- [x] **6.3 Cross-Session Driver Profile** — `DriverProfile` + `DriverProfileStore` interfaces defined. Tracks skill level, problem corners, strengths/weaknesses across sessions.
  - *Needs from AGY Pipeline (Mike + Austin):* (a) define the storage schema covering `DriverProfile` fields (skill level history, weak corners by track, goal completion counts) **as a generic time-series-sensor schema, not hardcoded to car telemetry — see April 29 feedback**, (b) expose endpoints / a client SDK that satisfies the `DriverProfileStore` interface in `types.ts`, and (c) a write hook at session end to flush `PerformanceTracker.getCornerHistories()` into the profile. Tracked as AGY-1 / AGY-2 in `docs/user-stories.md`.
  - *Needs from data-reasoning (after AGY lands):* swap the in-memory stub for the real store, add a session-boundary flush call, add regression tests against a fake store.
- [x] **6.4 In-Session Improvement Tracking** — `PerformanceTracker` tracks per-corner metrics (min speed, brake point, throttle %, corner name) within a session. Lap-over-lap delta emits P3 encouragement on improvement. Cross-session trends require persistence layer (Phase 6.3).
- [ ] **Auto-generation of session goals from DriverProfile** — Once persistence lands, derive default goals from the driver's recent weak corners/mistakes instead of asking from scratch. *Depends on 6.2 + 6.3 above — no net new cross-team asks.*

**Phase 7: April 29 Feedback (in progress on `data-reasoning`)**

Closing items raised in the conditional-pass review. Detailed acceptance criteria in [`docs/user-stories.md`](docs/user-stories.md) (DR-1..7).

- [ ] **DR-1** — Dynamic FEEDFORWARD geofence (velocity-scaled, time-to-event budget)
- [ ] **DR-2** — P0 stress test + documented bypass parameters
- [ ] **DR-3** — HOT-path humanization ≤50ms with raw-command fallback
- [ ] **DR-4** — "Why over What" prompt restructuring in COLD
- [ ] **DR-5** — Eyes-up vision coaching in FEEDFORWARD
- [ ] **DR-6** — Humanization safety override under high-slip / high-speed braking
- [ ] **DR-7** — Abstract geofence triggers for cross-domain portability *(post-Sonoma, not gating field test)*

### Edge / Telemetry, AGY Pipeline, UX / Frontend

These pods own their own roadmaps and acceptance criteria. To avoid duplication, the canonical task list lives in [`docs/user-stories.md`](docs/user-stories.md): ET-1..6 (Edge / Telemetry — extend `streaming-telemetry-server` with merged OBD+RaceBox stream, pre-rendered MP3s, dual-BT test, time sync, resilient BT bridge), AGY-1..3 (AGY Pipeline — post-session schema, coaching-event ingestion, `DriverProfileStore` persistence backend), UX-1..5 (UX / Frontend — CoachPanel metadata, pre-race chat UI, PWA conversion, minimal in-car HUD, persona selection).

The two integration cliffs that matter most for the May 23 field test are **UX-2 (pre-race chat → `setSessionGoals()`)** wired against [`docs/pre-race-chat-contract.md`](docs/pre-race-chat-contract.md), and **AGY-3 (`DriverProfileStore` backend)** implementing the interface in `koru-application/src/types.ts`.

### Future Work

Roadmap-level exploration items, not gated on the May 23 field test: cold-path offline fallback (pre-computed lookup tables, on-device Gemma evaluation), track auto-detection from heading-change rate, corner-specific coaching for unknown tracks, two-way conversational dialog for advanced drivers, and a possible native Android app. Tracked as roadmap notes only — no acceptance criteria or owners assigned yet.

---

## Hardware Stack

All teams share a common compute and sensor platform. Car-specific adapters vary by team. **This repo's active work targets Team 1 (Beginner Pod) — the TODOs above are scoped to the GR86.**

### Common Stack (All Teams)

| Device | Role | Connection | Data Rate |
|--------|------|------------|-----------|
| **Pixel 10** | Compute gateway, audio output, edge AI inference | — | — |
| **RaceBox Mini** | 25Hz GPS + IMU (position, speed, heading, lateral/longitudinal G) | BLE 5.2 | 25 Hz, 7.5-15ms latency |
| **OBDLink MX+** | Standard OBD-II adapter (RPM, speed, pedal position, coolant temp) | Bluetooth Classic 3.0 | 5-8 Hz effective |

### Team Car

Active work targets **Team 1 (Beginner Pod): 2024 Subaru GR86 (automatic, DauntlessOBD Enhanced + Hachi ASC CAN, full CAN access at 100–500 kbps)**. Team 2 (BMW E46 M3) and Team 3 (Honda S2000 AP2) are separate pods with their own hardware paths; not in scope for this repo.

### Data Channel Tiers

Coaching capability scales with available data channels. Team 1 sits at Tier 1; Tiers 2–3 are referenced for roadmap context only.

| Tier | Channels | Coaching Capability |
|------|----------|-------------------|
| **Tier 1 (Beginner)** | GPS + IMU + RPM + Speed | Lap time delta, brake markers, apex location, corner speed |
| **Tier 2 (Enthusiast)** | + Pedal position + Coolant temp + Oil temp | Throttle commitment, safety alerts (S54 >105°C coolant, >130°C oil) |
| **Tier 3 (Professional)** | + Wheel speeds x4 + Steering angle + Brake state | Traction circle utilisation, slip ratio, ABS map, trail braking quality |

### Latency Budget

Total budget from telemetry event to audio coaching: **300-500ms**.

```
RaceBox BLE → Pixel 10:     7.5 - 15 ms
OBD K-Line round-trip:      80 - 150 ms (vehicle-side, cannot reduce)
Browser BLE → fusion:       5 - 10 ms
AI inference (hot path):    < 50 ms
TTS audio output:           50 - 200 ms
                            ─────────────
Total:                      ~200 - 425 ms
```

> "Feedback 800ms late is worse than silence." — Brian Luc, Mentorship Session 1

---

## Architecture

Two components work together: a **telemetry server** streams GPS/vehicle data over SSE, and a **web application** processes that stream through a split-brain coaching engine that decides what to say and when.

```
                         ┌─────────────────────────────────────────────┐
                         │           koru-application (React)          │
                         │                                             │
 ┌───────────────┐  SSE  │  ┌─────────────┐    ┌──────────────────┐   │
 │  Telemetry    │──────►│  │  Telemetry   │───►│  CoachingService │   │
 │  Server       │       │  │  Stream      │    │  (Split-Brain)   │   │
 │  (FastAPI)    │       │  │  Service     │    │                  │   │
 └───────────────┘       │  └─────────────┘    │  HOT ──► <50ms   │   │
        ▲                │                      │  COLD ─► Gemini  │   │
        │                │                      │  FEED ─► Geofence│   │
 ┌──────┴──────┐         │                      └────────┬─────────┘   │
 │ GPS Device  │         │                               │             │
 │ (Racelogic) │         │  ┌──────────┐    ┌────────────▼──────────┐  │
 │ or Mock CSV │         │  │  Gemini  │    │    Audio Output       │  │
 └─────────────┘         │  │  Service │    │  (TTS + AudioContext) │  │
                         │  └──────────┘    └───────────────────────┘  │
                         │                                             │
                         │  Pages: Landing │ Dashboard │ Live │ Replay │
                         └─────────────────────────────────────────────┘
```

### Split-Brain Coaching Engine

The coaching engine routes decisions through three paths based on urgency:

```
  TelemetryFrame
       │
       ├──► HOT PATH (heuristic rules, <50ms)
       │    "Trail brake!" "Commit!" "Brake!"
       │    No cloud round-trip. Fires on threshold violations.
       │
       ├──► COLD PATH (Gemini 2.5 Flash Lite, 2-5s)
       │    Multi-frame telemetry analysis with physics context.
       │    "You're lifting early in T5 — trust the grip through mid-corner."
       │
       └──► FEEDFORWARD (geofence triggers, 150m before corner)
            Corner-specific advice delivered before the maneuver.
            "T3 right: late apex, brake at the 100m board."
```

### How Data Reasoning Works Alongside Gemini

Data reasoning is designed to partner with Gemini end-to-end. Gemini is the language and voice of the coach — generating nuanced cold-path analysis, shaping prompts into natural coaching lines, and speaking them via TTS. Data reasoning is the judgment layer that sits beside Gemini and makes it race-safe: it decides which telemetry events are worth reasoning about, hands Gemini a skill-adapted prompt with the right physics and pedagogy context, and governs when any output — Gemini's or heuristic — is actually delivered. The two are co-designed:

- **Feeding Gemini (input enrichment)** — The HOT path filters raw telemetry through a decision matrix so only meaningful events reach the coaching layer. The DriverModel classifies the driver (BEG/INT/ADV) and rewrites the cold-path prompt accordingly: beginners get feel-based, trigger-phrase prompts; advanced drivers get data-driven, technical prompts. Ross Bentley mental models and session-phase context are injected into the prompt so Gemini reasons with physics + pedagogy, not just numbers.
- **Pairing with Gemini (output gating)** — The TimingGate state machine (OPEN → DELIVERING → COOLDOWN → BLACKOUT) decides *when* any output is actually spoken. The priority queue replaces stale Gemini responses with fresher P0/P1 safety calls rather than queueing a 2-second-old paragraph behind a "BRAKE!".
- **Complementing Gemini (hot path for safety)** — For sub-50ms safety calls (BRAKE, OVERSTEER_RECOVERY), heuristic rules fire directly alongside Gemini's slower cold-path work; a 2–5s round trip is unacceptable on those. Gemini continues to own cold-path multi-frame analysis and feedforward corner enrichment on its own cadence.

Put another way: **Gemini is the voice; data reasoning is the judgment about what's worth saying, to whom, and when.** They work as a single coach — "800ms late is worse than silence," so the layer exists to make sure Gemini arrives at the driver's ear at the right moment with the right message.

### Coach Personas

Five AI personas with different communication styles. Switch mid-session.

| Coach | Style | Example |
|-------|-------|---------|
| **Tony** | Motivational | "Commit! Trust the grip!" |
| **Rachel** | Technical | "Trail off brake before turn-in. Balance the platform." |
| **AJ** | Direct | "Brake 5m later." |
| **Garmin** | Data | "Entry speed: -8 mph vs ideal. +0.3s potential." |
| **Super AJ** | Adaptive | Switches style per error type |

---

## Onboarding

### Prerequisites

- Node.js 20+
- Python 3.10+
- A [Gemini API key](https://aistudio.google.com/apikey) (optional, hot path works without it)

> **Note:** The original lab used `gemini-2.0-flash` which is now deprecated ([deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations)). Updated to `gemini-2.5-flash-lite` for cold path and analysis.

### 1. Start the Telemetry Server

```bash
cd streaming-telemetry-server
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python ingest.py --mock
```

The server starts at `http://localhost:8000`. The `--mock` flag replays `SampleStream2024.csv` (Sonoma Raceway data) at 10Hz over SSE.

For live GPS hardware (VK-162 USB dongle):

```bash
python ingest.py --port /dev/tty.usbserial-XXXX --baud 9600
```

### 2. Start the Web Application

```bash
cd koru-application
npm install
npm run dev
```

Open `http://localhost:5173`. Click **Open Dashboard** to enter the app.

### 3. Configure Gemini (optional)

Click the gear icon in the navbar and paste your Gemini API key. This enables:
- Cold path cloud coaching (Gemini Flash)
- Post-session AI lap comparison
- Gemini TTS voice output

The hot path and feedforward path work without an API key.

### 4. Run a Session

| Mode | Steps |
|------|-------|
| **Live** | Go to Live > paste SSE endpoint (`http://localhost:8000/events`) > pick a coach > drive |
| **Replay** | Go to Replay > upload a CSV from your datalogger > scrub with synced charts |
| **Analysis** | Go to Analysis > upload two CSVs > click Compare Laps for sector-by-sector AI breakdown |

---

## streaming-telemetry-server

Python FastAPI service that streams GPS telemetry over Server-Sent Events (SSE) at `localhost:8000/events`. Supports CSV replay (`--mock`, default 10 Hz), serial NMEA (`--port`), and an experimental binary mode for VBox devices. The full endpoint reference, modes, and env vars live in [`streaming-telemetry-server/`](streaming-telemetry-server/) — this server is owned by the Edge / Telemetry pod; extending it to emit merged RaceBox + OBD channels is tracked as user-story ET-1.

---

## koru-application

React + TypeScript + Vite web application for real-time coaching visualization and interaction.

```
koru-application/
  src/
    components/
      CoachPanel.tsx         # Coaching message display and persona selector
      GaugeCluster.tsx       # Speed, throttle, brake, G-force gauges
      Navbar.tsx             # Navigation bar with API key settings
      PlaybackControls.tsx   # Replay scrubber and playback speed
      TelemetryCharts.tsx    # Recharts-based telemetry visualization
      TrackMap.tsx           # Canvas track map with car position
    data/
      trackData.ts           # Thunderhill East track definition (corners, sectors)
    hooks/
      useGeminiCloud.ts      # Gemini API integration hook
      usePredictiveCoaching.ts  # Mistake zone tracking + 8s lookahead
      useTTS.ts              # Text-to-speech hook (Web Speech API + Gemini TTS)
    pages/
      Landing.tsx            # Landing page
      Dashboard.tsx          # Main dashboard
      LiveSession.tsx        # Live telemetry + real-time coaching
      Replay.tsx             # CSV replay with synced charts
      Analysis.tsx           # Two-lap AI comparison
    services/
      audioService.ts        # AudioContext pre-caching + Web Speech API fallback
      coachingService.ts     # Split-brain coaching engine (hot/cold/feedforward)
      geminiService.ts       # Gemini REST API wrapper
      telemetryStreamService.ts  # SSE client, CSV/JSON file replay, virtual sensors
    utils/
      audioUtils.ts          # Audio helper utilities
      coachingKnowledge.ts   # Coach personas, decision matrix, racing physics knowledge
      telemetryParser.ts     # Telemetry data parsing utilities
    types.ts                 # TelemetryFrame, Track, Corner, CoachAction, CoachPersona
```

### Data Flow

```
 SSE/CSV Input
      │
      ▼
 TelemetryStreamService ──► TelemetryFrame
      │
      ├──► GaugeCluster (speed, throttle, brake, G)
      ├──► TelemetryCharts (time-series plots)
      ├──► TrackMap (car position on canvas)
      │
      └──► CoachingService
              │
              ├──► Hot Path ──► immediate CoachAction
              ├──► Feedforward ──► geofence-triggered advice
              └──► Cold Path ──► GeminiService ──► analysis
                                                      │
                                        All paths ────┘
                                             │
                                             ▼
                                      CoachPanel (display)
                                      AudioService (TTS)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS 4 |
| Charts | Recharts |
| AI | Gemini 2.0 Flash via `@google/genai` |
| Audio | Web Speech API + Gemini TTS (`gemini-2.5-pro-preview-tts`) |
| Track rendering | Canvas API |
| Telemetry server | Python FastAPI + SSE |
| GPS parsing | pynmea2 |
| Communication | Server-Sent Events (SSE) |

## License

MIT
