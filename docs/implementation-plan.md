# Implementation plan

Baseline: 5 November 2026. This is the build sequence for the confirmed design, not a promise that the entire game is implemented in one pass. All twelve domestic divisions and three European competitions remain first-release requirements.

## 1. Dependency order

```text
Design and decision record
           |
           +--> Historical source/rules audit --> verified data packs
           |
           +--> Domain + deterministic core --> match engine --> viewer
                               |
                               +--> world + competition calendar
                                              |
                              management systems + persistent careers
                                              |
                                  multi-season validation + release
```

Data research and engine work can run in parallel. A small fictional dataset is a development fixture, not a replacement for the requested real-world database. Stop and expose missing coverage rather than silently relabeling fabricated players as real.

### Progress on 8 November 2026

Milestone 1 is implemented. Milestone 2 now has the `possession-3` action engine and a tested FIBA 2024 subset. Separate advances, passes, drives and shots use saved court positions and defensive matchups; earlier `rules-2` saves continue with their original engine. Milestone 3 now has animated engine-authored court scenes, pause/resume, playback speeds, reduced-motion and text-only views. Both milestones remain partial: the action model, competition overrides and statistical calibration are still being developed. The [rules matrix](design/rules-coverage.md) and [implementation status](implementation-status.md) record the exact coverage. Downloaded EuroLeague/EuroCup reference records remain separate from the exhibition.

The latest user-directed presentation increment places a larger, full-width court immediately below the score, removes the standalone shot-clock/possession panel, and moves coaching controls below the court. Home/away lineup and bench views show current stamina with visual bars and percentages. These layout changes leave the sporting engine unchanged.

The user's subsequent interface direction applies to every increment: the overview must be a functional manager's desk and all screens must behave as management-game workspaces. Prioritize club state, availability, useful tables, the next decision and working actions. Remove landing-page promotions and keep the development roadmap in documentation. [Interface requirements](game-design.md#11-interface-structure) and [repository guidance](../AGENTS.md) record this direction for future work.

The possession-action increment adds causal spacing and matchups, direct passer assists, resumable live possessions and creation feedback beneath the coaching controls. Isolated tactical comparisons measure tempo, outside emphasis and defensive pressure separately. Next engine work calibrates the resulting pace, shot mix and efficiency, extends off-ball and defensive decisions, and implements the remaining competition rules. Calibration and the season/career foundation continue in the dependency order below. Competition-specific rules must be configured before those competitions become playable; EuroLeague's verified possession rules already differ from the exhibition baseline. The current viewer interpolates recorded action scenes; it does not yet simulate continuous possession physics.

The first Milestone 4 increment now provides a playable development season: six fictional clubs, ten weekly matchdays, thirty home/away fixtures, club choice, derived standings and compact result reviews. Human and AI games use the same possession engine with independent fixture seeds. Instructions, final lineups and condition carry between fixtures; recovery runs once per matchday. Season persistence is separate from exhibition saves, and background matchday processing commits atomically or cancels without changing the world. The subsequent persistent-health increment adds Standard, Reduced and Off injury modes for all clubs, calendar-based recovery, eligibility-safe fixture preparation and medical reports; old saves retain injuries off. This validates the season loop; it does not substitute for the twelve domestic divisions, continental competitions or verified historical rosters.

Persistent health records match incidents and recovery dates across fixtures. The development career now rolls into a new annual schedule with the same club, plans, injury policy and health history; offseason recovery applies once, and previous tables and scores remain available. Format-7 saves retain archives, training, coaching and financial state, and migrate valid earlier seasons. Player rosters remain fixed: aging, youth intake, retirement, promotion/relegation and qualification are not part of this increment. The next world work adds validated competition configurations and calendars, registration and competition transitions. Local persistence now retains five transactional checkpoints, autosaves at new-game/matchday/rollover boundaries, and rejects stale-tab writes; recovery is available through Save history. Weekly team and individual training now runs between matchdays, with workload/recovery tradeoffs, assistant delegation, eligible-day participation and skill development. New careers enable it; pre-training saves retain their original recovery model until explicitly enabled. Transfers, additional staff roles, advanced training, facilities and full financial/board systems remain later milestones; detailed rehabilitation and injury calibration also remain open.

The performance-analysis increment adds current-season squad statistics, league player comparisons and individual match histories using committed box scores. Sorting, per-game/totals/per-40 views and participation filters support lineup and training decisions without adding a second statistics ledger. These reports do not cover archived player seasons; archived team scores remain available.

The first staff increment implements training-coach recruitment, three-slot limits, full-season fee commitments, assignments, releases and renewals. Every club uses the same allocation and validation; AI recruitment fills vacancies within those limits. Coaches contribute bounded, reported practice bonuses, with frozen weekly assignments preserved after later edits. Earlier saves keep coaching disabled until activation. This is an initial coaching allocation model; assistant, fitness, physio, scout and youth-coach recruitment, full payroll/finances, negotiations, facilities, aging and real competition/data integration remain open dependencies. The confirmed staff role limits and youth-coach requirement are unchanged.

The first finance increment adds manual/delegated ticket pricing, deterministic attendance, a reconciled cash/obligation ledger, annual sponsorship and matchday costs. Coaching appointments and renewals use cash as well as the staffing allocation. Prices lock before play, transactions commit with the matchday, and earlier saves opt into the new economy. This provides accounting for later player contracts, transfers and facilities; it does not yet model their expenses. Next management work can build player contracts and recruitment on that foundation while the real competition/data and engine-calibration tracks remain open.

The payroll increment adds ongoing player wage agreements, future wage commitments, ten matchday installments and optional discounted settlement. Human and AI decisions share cash/reserve checks, and older careers enable the system prospectively. This is the payment side of player contracts. The next prerequisite for genuine expiry and recruitment is historical roster ownership: fixture and training reports, injuries, performance totals and archives must identify the players registered at the time. A first offseason market can then implement actual departures, renewals and signings without rewriting historical results. Salary negotiation and employment expiry are not represented by inert controls in the current payroll screen.

## 2. Milestone 0: design and evidence baseline

Deliver the main GDD, specialist specifications, decision log, architecture and this plan. Capture the eighteen discovery answers, including a youth coach and direct/delegated business controls. Resolve contradictory ownership of form, condition, injuries and money.

Audit source coverage at minimum across both tiers in all six countries and the three European competitions. Sample promoted clubs, midseason transfers and outside-country continental entrants. Pin rules and historical effective dates. Select the final start date only after opening-day membership can be reconstructed.

Exit evidence: agreed product choices documented; missing data explicitly recorded; no false claim of a complete roster pack. The full audit can continue while engine milestones progress.

## 3. Milestone 1: runnable simulation foundation

Build a TypeScript project and lean dark application shell around a clearly labeled fictional exhibition fixture. Implement stable IDs, player attributes, roster data, seeded randomness, a serializable match state, and one shared progression function for step, quarter skip and full simulation.

Include a scoreboard, event history, basic box score, simple tactical inputs, eligibility-safe lineup selection and a diagonal development court. Add export/import of the complete fixture state with validation. Describe missing features in development documentation and retain a concise factual prototype label; omit unavailable destinations from normal navigation.

This fixture is a useful engineering checkpoint, not the calibrated final engine or a playable multi-league career. Its simplifications must be recorded in README and implementation status.

Acceptance:

- Identical initial state and tactics produce identical events/results in stepped, quarter-skipped and instant progression.
- Score, makes/attempts, game time and lineup minutes reconcile.
- Save/restore continues the same random stream and result.
- Ties resolve through overtime; forbidden substitutions and malformed saves are rejected.
- Type checking, relevant engine tests and production build pass.
- The overview supports actual manager decisions using current match/club state. It contains no promotional hero, invented activity or nonfunctional destination; its actions and selected player remain coherent after navigation and save/load.

## 4. Milestone 2: legal, calibrated action engine

Replace development approximations with the documented action/rules model: clocks, possession transitions, shot locations and creation, defenders, rebounds, free throws, foul classifications, penalties, legal substitution/timeout opportunities and exclusion/default rules.

Build an article-to-test matrix for each ruleset. Add persistent fatigue, exposure-based injuries, assistant policies, bounded temporary execution and coordination effects. Use configurable competition/strength baselines.

Acceptance: edge-case fixtures pass; matched commands remain playback-independent; statistical reports cover shot mix, pace, efficiency, fouls, turnovers, rebounds and minutes. Parameters are labeled uncalibrated until evidence supports them.

## 5. Milestone 3: match presentation and coaching

Build the final diagonal court renderer around engine events: coherent player positions, ball paths, pass/shot/rebound sequences, team direction, bench and appearance descriptors. Add playback speed, free pause, current-quarter skip, critical-event pause, queued substitutions, timeouts and optional detailed matchups.

Match portrait and court appearance. Implement reduced-motion and text alternatives. Distinguish intent from guaranteed shot distribution in tactical explanations.

Match-screen priority confirmed on 6 November: lead with the score and a large court; keep secondary controls below the viewing area; show player stamina clearly in both the active lineup and bench. A cleaner layout is an ongoing presentation requirement, separate from completion of the underlying action engine.

Acceptance: player IDs and event geometry match rendering; pauses do not grant recovery; switching playback modes cannot change outcomes; desktop/tablet controls remain readable and usable.

## 6. Milestone 4: world, competitions and saves

Implement all twelve playable divisions and three European competitions using validated season configurations. Support club identity across competitions, draws, schedules, standings, tie-breakers, playoffs, cross-tier accession, registration, qualification and boundary promotion/relegation.

Represent external continental participants and background third-tier clubs. Add deterministic date advancement, worker orchestration, resumable rollover, IndexedDB revisions, save migration, export/import and one-writer conflict protection.

Acceptance: any supported club completes a season; dates/eligibility are coherent across domestic/European calendars; promotion and qualification conserve valid participants; interrupted rollover resumes without duplicate transactions.

## 7. Milestone 5: squad, training, health and staff

Implement player pages, roles and promises, morale, chemistry components, condition, form, training presets, delegated plans, injuries, uncertain assessments and rehabilitation. Add staff recruitment and limits including one proposed youth-coach slot; display half-star ratings correctly.

Build the academy prospect roster, simplified youth fixtures, individual development, promotion to the senior squad and deterministic annual intake. Aging, retirement and population replacement must keep the world sustainable.

Acceptance: each state has a named cause; workload is charged once; promises account for eligibility; training costs and staff capacity constrain benefits; youth/retirement keeps plausible roster age and ability distributions over repeated seasons.

## 8. Milestone 6: scouting, recruitment and finances

Implement knowledge maps, regional assignments, discovery, report uncertainty and freshness. Add shortlists, offers, negotiations, competing bids, contracts, loans where permitted, medicals, registration and contract expiry.

Implement a reconciled ledger, payroll, commitments, installments, cash-flow forecasts, board budgets and offer reservations. AI recruitment uses its own knowledge and the same transaction validation.

Acceptance: simultaneous offers cannot overspend reservations; failed negotiations are explainable; ownership, registration and wages update atomically; hidden potential is not exposed in the normal interface; bankrupt or roster-empty clubs trigger defined recovery/failure behavior.

## 9. Milestone 7: facilities, business, board and career

Facilities include arena/stadium, training facilities and youth infrastructure. Add project cost/duration, maintenance, funding, temporary disruption and board constraints. Let the manager set ticket policies, negotiate sponsorship and manage upgrades or delegate each responsibility.

Delegation has explicit authority, budget limits and reporting. Manual and automatic decisions share the same services; automation cannot bypass board budgets. Add meaningful press/player events, president traits, rivalries, board evaluation, optional dismissal and job changes.

Acceptance: overpricing affects demand plausibly; sponsors and capital projects cannot create free money; delegated actions respect policy and report results; dismissal preserves the world and enables a continuing career.

## 10. Milestone 8: integrated first release

Load the verified historical pack and permitted assets. Complete useful English navigation for Home, Inbox, Squad, Tactics, Training, Staff, Scouting, Transfers, Competitions, Club and Settings. Remove placeholders from completed journeys and show remaining gaps honestly.

Run multi-season simulations across all competition tiers, checking statistical realism, financial health, youth quality, staffing, transfer behavior, league entry, save size and recovery. Review representative games visually and review tactics for universally dominant exploits.

Exit evidence: release stories in the GDD pass; all agreed competitions are playable; data coverage and estimates are documented; local save/export recovery works; production build passes. Every management screen presents real game state and working decisions with readable desktop/tablet tables, keyboard access and consistent status after state changes. User retains deployment responsibility.

## 11. Work control

Each implementation increment updates [status](implementation-status.md) with working behavior, validation, known limitations and next dependency. Do not present a milestone number as a completion percentage: data preparation and simulation calibration contain substantial uncertainty.

Do not guess calendar estimates before the historical audit and engine benchmark. Size and sequence work using measured throughput. Any proposal to reduce the agreed league/tier scope requires an explicit product decision; it must not happen through an engineering shortcut.
