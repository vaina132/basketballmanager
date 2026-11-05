# Match simulation specification — draft

Status: target engine specification, 5 November 2026. The initial engine foundation implements only the subset recorded in [implementation status](../implementation-status.md); the target engine is not yet complete or calibrated.
Confirmed first-release scope: men's top two divisions in Turkey, Spain, Greece, Germany, Italy, and France, all fully playable, plus EuroLeague, EuroCup, and Basketball Champions League.
The game uses the latest completed season's opening-day database, a diagonal 2.5D viewer, and local single-player careers. The candidate season is 2025–26, subject to source verification.
Own-squad skill grades are visible exactly; transfer targets have scouting ranges, while personality and potential are conveyed through reports rather than exact hidden values.
Free pause and automatic stops for critical injuries or an ineligible lineup are confirmed. Changes remain queued until their legal boundaries.
The default injury setting targets realistic incidence, with an optional reduced-injury setting applied equally to every club. Verification and calibration remain outstanding.
Numbers described as tuning values are initial hypotheses, not measured basketball facts.

## 1. Contract and boundaries

The match engine owns sporting outcomes, clocks, eligibility, fatigue, injuries, and statistics.
The viewer renders engine events; it cannot decide whether a shot scores or a player is injured.
Watching, accelerating, skipping a quarter, and instant simulation call the same engine.
Identical initial state, ruleset, engine version, random seed, and commands must produce identical results.
Different substitutions or tactics legitimately change the resulting match.
AI-controlled fixtures use the same rules and action resolution as human-controlled fixtures.

Three layers remain independently replaceable:

1. Rules: legal state transitions and competition-specific exceptions.
2. Basketball model: choices, movement, execution probabilities, and coaching policies.
3. Presentation: diagonal court, animations, audio, commentary, and playback speed.

A visually elaborate engine is not automatically a realistic one. Statistical validation and understandable tactical consequences are the acceptance criteria.

## 2. Season-specific rules

Each competition snapshot references an immutable ruleset and its source documents.
A ruleset includes effective dates, court geometry, game length, roster eligibility, clocks, penalties, timeouts, substitution opportunities, and overtime policy.
Domestic registration and foreign-player limits belong to competition administration; the engine receives an already validated match roster.
Club staff capacity is separate from the competition's permitted match-bench delegation.

For a historical FIBA 2024 baseline: four ten-minute quarters; five-minute overtimes when required; five players per side; a 24-second shot clock with context-dependent resets, including 14 seconds after specified offensive rebounds; exclusion after five player fouls; and team-foul penalties governed by the foul situation. Timeouts and substitutions require legal opportunities. Overtime team fouls continue the fourth-quarter tally. This is a summary, not an implementation substitute for the articles. [FIBA 2024 rules, arts. 4, 8, 18–19, 29, 40–41](https://library.fibairef.basketball/cdn/OBR2024).

Do not silently use that taxonomy for a 2026 ruleset. FIBA's 2026 edition introduces technical-foul categories and disruptive/flagrant foul classifications. [FIBA 2026 rules](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2026-v1-1.pdf).

Before implementing a selected competition, build an article-to-test matrix for its applicable rules and interpretations.
Record competition deviations explicitly; do not infer EuroLeague or domestic regulations solely from FIBA's general rules.
Historical careers retain their starting rule configuration unless a dated rule change is deliberately included.
Unknown future rule changes are never invented as real-world facts.

## 3. Authoritative match state

Store these fields in a serializable state:

- Match, competition, ruleset, data, calibration, and engine version identifiers.
- Period, integer game-clock ticks, shot-clock ticks, clock-running flags, and ball status.
- Possession/control identifiers, inbound location, alternating-possession state, and attacking direction.
- Active lineup, bench availability, player/team fouls, disciplinary counters, and timeout allowances.
- Score, field-goal/free-throw sequences, pending penalties, and review/correction state when supported.
- Player locations in court coordinates, role assignments, ball carrier, and action phase.
- Tactical instructions, queued commands, effective-command boundaries, and AI policy state.
- Acute exertion, injury restrictions, minute targets, substitution plans, and performance-state snapshot.
- Random-stream states, event cursor, command sequence, and derived-statistics checksum.

Use integer time, for example ten-millisecond ticks; choose the final precision before engine implementation.
Persist the unresolved action phase so saving mid-match cannot reroll a shot or discard an outstanding free throw.
Serialize random state, not only the starting seed. Never use browser wall-clock time as simulation input.

## 4. Randomness and reproducibility

Use a documented, versioned seeded generator with independent domains for gameplay, injuries, AI decisions, and cosmetic presentation.
Cosmetic effects never consume the gameplay stream. Parallel fixture order must not alter other fixtures' seeds.
Derive fixture seeds from stable world-seed and fixture identifiers, not mutable array positions.
Tie-break candidate selection by stable identifiers; avoid unordered object iteration as a sporting input.
For reproducibility across browsers, specify numerical rounding and quantized probability tables or verified equivalent arithmetic.
Maintain reference fixtures across supported runtimes; a seed alone does not guarantee cross-platform equivalence.
Random draws produce uncertainty within plausible basketball situations rather than a hidden predetermined final score.
Changing playback speed consumes neither extra draws nor fewer draws.

## 5. Action and possession model

A possession is a sequence of actions rather than one scoring coin flip.
Start with a modest spatial model: court zones and explicit player coordinates at action boundaries.
Continuous animation between those positions is presentation; the resolved opportunities must remain geometrically plausible.

Suggested action loop:

1. Resolve pending penalties, eligibility changes, and commands legal at this boundary.
2. Identify the current phase: inbound, transition, setup, advantage creation, shot, loose ball, or dead ball.
3. Build legal candidate actions from lineup skills, spacing, matchups, clock, and instructions.
4. Choose an action using player decision quality and a bounded preference policy.
5. Determine candidate event times and the earliest relevant boundary: completion, interception, contact, violation, shot release, or clock expiry.
6. Advance clocks and player exposure only to that boundary, then resolve it; never spend the full proposed action duration after an earlier whistle or horn.
7. If a shot is released, resolve contest/block/make and then an eligible rebound or out-of-bounds outcome.
8. Update score, control, fatigue, injuries, and statistics through the rules reducer.
9. Emit authoritative events and repeat until the requested legal stop boundary.

Candidate actions include advance, pass, drive, screen, roll/pop, cut, post entry, post move, catch-and-shoot, pull-up, reset, and intentional foul.
Only implement an action when its prerequisites, defensive responses, and statistical consequences are defined.
Keep initial play families small: transition, pick-and-roll, motion, and post-focused offense.
Do not model unexplained teleporting passes or shots from coordinates inconsistent with their point value.
An offensive rebound generally extends the same team possession; it must not automatically count as a new possession in analytics.
Track turnovers, steals, blocks, rebounds, assists, and team rebounds using an explicit statistics policy versioned separately from playing rules.
For example, Euroleague Basketball's criteria allow an assist for certain shooting fouls after the first successful free throw in the sequence; therefore `assists <= fieldGoalsMade` is not a universal invariant. [Euroleague Basketball Statistics Criteria Manual](https://ftpserver.euroleague.net/general/EB_Statistics_Criteria_Manual.pdf).
A block can lead to retained offense, defensive control, or an out-of-bounds restart; it is not automatically a turnover.

## 6. Attribute interpretation and calibration

Store underlying skills with fine precision; show rounded 1–20 ratings to the manager.
Own-squad profiles show those exact displayed grades. Opponent and target profiles use the manager's estimated ranges; the engine always resolves actions from true skills.
Map each rating to one or more specific mechanisms, never to an unexplained universal overall-power multiplier.
Use the shared player schema for names; proposed refinements such as finishing and perimeter defense require the main design's agreement.

| Skill or trait | Primary match mechanisms |
| --- | --- |
| Two-point shooting / finishing | Appropriate rim, post, or midrange shot execution; refine by shot type where evidence supports it |
| Three-point shooting | Three-point execution, separate from attempt preference |
| Free throws | Free-throw execution |
| Passing / vision | Pass difficulty tolerance, creation, and choice quality |
| Dribbling / decisions | Ball security, separation, and turnover exposure |
| Perimeter / interior defense | Contest positioning, containment, help, and rim protection |
| Rebounding / positioning | Rebound access and contested recovery |
| Speed / strength / jumping | Movement, contact, screen outcomes, and reachable space |
| Stamina | Exertion accumulation and short-term recovery |
| Aggression / discipline | Contest/contact choices and avoidable fouls, with benefits and costs |
| Leadership / composure | Limited coordination and pressure response, not automatic scoring bonuses |

Height in centimetres and weight in kilograms affect geometry and physical matchups with diminishing returns.
Being taller does not automatically improve shooting, decisions, or fitness.
Nationality, skin tone, and portrait appearance never determine ability or behavior.
Loyalty, ambition, and adaptability primarily affect career decisions and integration; they are not direct shot bonuses.

Illustrative, uncalibrated shot model:

```text
x(r) = (r - 10.5) / 9.5                      # rating normalized to [-1, 1]
z = intercept[zone, shotType]
    + betaSkill[shotType] * x(relevantSkill)
    + betaSpace * spaceQuality
    + betaCreation * advantageQuality
    - betaContest * contestQuality
    - betaFatigue * exertionPenalty
    + boundedTemporaryExecution
pMake = clamp(sigmoid(z), probabilityFloor, probabilityCeiling)
```

Coefficients, bounds, and intercepts must be fitted or calibrated by shot context; none are production defaults yet.
Free throws use their own model without defensive contest terms.
Resolve a valid shot attempt's block/make outcomes coherently; avoid independent draws that can both block and score the same normal attempt.
Goaltending and exceptional scoring rulings pass through the rules layer.
Estimate skills from opportunity-adjusted statistics with shrinkage for small samples, rather than ranking raw points per game.
Attempt tendency and ability are distinct: a strong shooter may attempt little, and increased volume may reduce shot quality.
Undocumented mental traits and tactical tendencies are authored estimates with uncertainty, not claimed real-world facts.

## 7. Tactics with a small control surface

The default screen exposes tempo, attacking balance, offensive aggression, defensive scheme, defensive pressure, and rotation.
Inside/outside preference is a normalized intent slider; actual shot shares emerge from available opportunities and opponent responses.
A desired 60% outside emphasis is not a promise that exactly 60% of attempts are threes.
Explain differences through feedback such as “their pressure forced more drives” or “our lineup could not create open perimeter shots.”

| Instruction | Intended benefit | Basketball cost |
| --- | --- | --- |
| Higher tempo | More transition chances and possessions | Faster exertion accumulation and rushed decisions |
| Inside emphasis | Rim pressure, contact, and kick-outs | Congestion against strong help defense |
| Outside emphasis | Spacing and three-point opportunities | Dependence on shooting/creation and greater scoring variance |
| Aggressive defense | Ball pressure and disrupted actions | Fouls, drives conceded, and extra load |
| Drop / switch / hedge | Different pick-and-roll advantages | Matchup-dependent weaknesses and familiarity demands |
| Crash offensive boards | More second chances | Reduced transition protection |

Advanced controls can expose primary matchups, help rules, screen coverage, and shot preferences without requiring every possession to be scripted.
Start with a validated limited defense set; do not advertise zone or switching until their spatial behavior exists.
Tactical familiarity changes execution/coordination costs, not an arbitrary global team rating.
AI uses the same controls and can react to foul trouble, mismatches, fatigue, score, and remaining time.
Coach personalities affect risk and preferred style; AI may not access the human's hidden future commands or random outcomes.

## 8. Form, morale, chemistry, and fatigue

Keep persistent ability, temporary execution state, observed form, morale, and physical exertion distinct.
Observed form is a smoothed report of recent role- and opponent-adjusted performance with confidence intervals.
Temporary execution state provides a modest persistent good/bad-form effect; it mean-reverts and is not rebuilt from raw scoring alone.
If performance informs that state, update from opportunity-adjusted residuals with strong shrinkage to avoid treating shooting luck as a permanent skill increase.
Example tuning hypothesis: an autoregressive daily execution state bounded to ±0.10 log-odds, with persistence selected during calibration.
Do not add both an observed-form bonus and the full temporary-execution effect to the same shot.

Morale changes decision confidence, effort consistency, and integration within bounded limits.
It must not make an unhappy elite player instantly worse than an unskilled happy player.
Match sharpness represents timing readiness. Its effect, morale's execution effect, and latent execution form share a calibrated total bound rather than stacking unrestricted bonuses.
Chemistry affects coordination opportunities and defensive communication; it does not also grant an unexplained make-percentage bonus.
Recent results influence confidence and relationships through the world model; avoid applying an additional “winning streak” multiplier.
Rivalry modifies stakes and pressure response, with individual composure determining whether that helps or hurts.

Physical condition is the pre-match readiness measure; acute exertion is the match's running workload state.
Initialize exertion/readiness from condition once, then accumulate action load and recovery.
During play, displayed condition is derived from that authoritative readiness/exertion state; it is not a second independently updated fatigue variable.
Do not independently multiply shooting by condition and by an equivalent fatigue deficit representing the same cause.
Illustrative load: `deltaExertion = durationMinutes * intensity * (1 - staminaRelief)`, with role-specific intensity and calibrated bounds.
Bench rest, timeouts, and period breaks recover acute exertion according to simulated physiological time.
Pausing the UI for an hour grants no extra rest. Long-term load is carried into the career health model separately.

## 9. Injury integration

The world model owns susceptibility, rehabilitation, prior injuries, and recovery forecasts; the match engine supplies exposure and incident events.
Separate contact incidents from accumulated non-contact exposure to avoid blaming every injury on fitness.
Illustrative hazard: `pInjury(dt) = 1 - exp(-lambdaContext * boundedRiskMultiplier * dtHours)`.
This is a game-model proposal, not medical advice or an asserted clinical predictor.
Estimate baseline incidence and severity distributions only when appropriate sports evidence is available.
Risk modifiers can include recent workload, acute exertion, existing restrictions, and injury history; cap their combined effect and test interactions.
Charge each exposure interval once so finer simulation steps do not create more injuries.
Evaluate incidents consistently before applying their sporting consequences; a disabled player cannot finish an impossible subsequent action.
Severity, immediate ability to continue, substitution requirement, and uncertain diagnosis are separate outputs.
The player's staff initially report symptoms and an estimated absence range; detailed certainty develops through assessment.
Critical injuries trigger the same mandatory eligibility rules in watched and simulated matches.
The assistant follows a configurable medical/rotation policy when the manager skips play; this policy is stored with the match commands.
In the human manager's fixture, critical injuries and an ineligible lineup automatically pause progression, including a quarter skip or instant-match request, until a legal response is supplied.
AI-only fixtures resolve those same incidents through the AI replacement policy without requiring the human manager to intervene.
The confirmed default injury mode targets realistic incidence after calibration; the optional reduced mode applies a documented hazard multiplier equally to all clubs and competition fixtures.
Persist the chosen injury setting and multiplier version in the save. The default must not be described as empirically realistic before exposure and severity calibration passes.

## 10. Interventions and playback

The manager may open controls at any time; sporting changes take effect only at their defined legal/action boundaries.
Substitutions are queued until allowed; timeout requests are not an immediate stoppage of a live-ball possession.
Show “queued” and “active” explicitly, including the reason a command cannot yet apply.
Lineup replacements validate eligibility, unique players, and pending free-throw requirements atomically.
Tactical instructions apply at the next suitable action boundary; major reorganization may require a dead ball or timeout.
Pause is confirmed as free thinking time for the human and has no simulated physiological effect.

`runUntil(periodEnd)` simulates the unresolved current action and all subsequent legal events through the period boundary.
“Skip quarter” means finish the current period; label overtime separately and never accidentally skip an extra period.
When tied at regulation end, continue through the configured overtime policy rather than manufacture a winner.
Instant simulation runs the saved assistant policy for the human team; this is also available during watched games.
Playback mode alone must not change coaching decisions. Different human/assistant commands can change results.
Critical injury and ineligible-lineup stops take precedence over requested simulation speed or finish boundaries. Other routine decisions follow the saved assistant policy.

The confirmed diagonal 2.5D viewer consumes events carrying actor IDs, origin/destination coordinates, action times, shot path metadata, and ball ownership.
Portrait and on-court appearance share an appearance descriptor, separate from ratings and match logic.
Use jersey number, height, build, skin/hair appearance, and accessories for recognition before promising photorealism.
Camera rotation changes projection only. Keep attacking direction, shot geometry, and scoreboard consistent after halftime.
Animation interpolation cannot create passes, assists, fouls, or contact absent from the event stream.
Reduced-motion and text play-by-play modes consume the same events.

## 11. Validation and acceptance gates

Correctness precedes tuning. Required invariants include:

- Team score equals valid scoring events and reconciles with player totals and exceptional scoring rules.
- Attempts, makes, and free-throw sequences remain nonnegative and internally consistent.
- A player cannot appear on both teams, twice in a lineup, or after exclusion without an explicitly valid rules transition.
- Both clocks stop/run/reset according to the same authoritative event, with no negative time.
- Court minutes equal integrated active-lineup time; a normal full-strength regulation game totals 200 player-minutes per team.
- Injuries, penalties, and pending commands survive save/load exactly once.
- Period-end shots and outstanding penalties resolve before standings receive the final result.
- A finished result is recorded exactly once, including retries after an interrupted save.
- Pausing, frame-rate changes, reduced motion, quarter skips, and instant play preserve outcome equality for equal commands.

Scenario tests cover buzzer releases, shot-clock expiry, fouls during shots, offensive rebounds, last-free-throw misses, possession-arrow changes, simultaneous penalties, late-game timeouts, foul-outs, depleted lineups, injury replacements, and repeated overtime.
Rule-specific scenarios must follow the selected edition's official interpretations, including 2026 disciplinary classifications when applicable.
Use property-based event-sequence testing and deterministic replay fixtures for engine state transitions.
Avoid brittle tests asserting that one seed always makes a favorite win or a tactical change always improves the next shot.

Calibration uses an identified competition/season dataset and held-out fixtures or player samples.
Compare possessions, offensive rating, shot-zone/three-point shares, shooting percentages, free-throw rate, turnovers, offensive rebounds, foul distributions, minutes, score variance, and margin distribution.
Report means, dispersion, tails, and confidence intervals; plausible average scores alone are insufficient.
Test ability ordering, mismatched lineups, fatigue response, extreme tactical settings, and zero-cost dominant strategies across many seeds.
Use common seeds for controlled comparisons, while interpreting effects across a sample rather than one rerun.
Validate injury incidence per player-hour and absence distributions separately from basketball scoring calibration.
Run season-level checks for schedule load, rotation behavior, and statistical plausibility before calling the engine realistic.
Publish a calibration report and known simplifications with each material engine version.

## 12. Open design decisions

1. Can the 2025–26 opening-day snapshots, applicable rule editions, and calibration datasets be verified for all twelve domestic divisions and the three confirmed European competitions?
2. Which appearance traits and asset sources provide sufficient player recognition in the confirmed stylized 2.5D viewer?
3. Should the default tactics screen include only man-to-man coverage initially, or a validated zone option too?
4. What match viewing duration and acceleration controls feel comfortable for an ordinary session?
5. Should difficulty alter information and assistant support only, or also relax management constraints? Sporting rules remain consistent.

These choices affect scope and presentation. They do not justify a separate simplified instant-result engine.

## 13. First implementation boundary

Begin with a small deterministic engine foundation after the implementation plan is saved: explicit state, seeded randomness, event reduction, clocks, and a minimal synthetic fixture that can run watched, by period, or instantly with equivalent commands.
Validate replay/save continuity, mode equality, legal clock transitions, and score/statistics reconciliation before adding further actions.
Use synthetic players and a clearly identified limited rules subset for that milestone. Keep a coverage list distinguishing implemented, simplified, and unsupported rules.
Expand through tested possession actions, eligibility and foul rules, coaching commands, fatigue/injuries, competition-specific statistics, and the full selected rulesets.
The first working fixture is an engine prototype; it is not the full twelve-division game and is not evidence of realistic basketball calibration.
