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

### Progress on 6 November 2026

Milestone 1 is implemented. Milestone 2 now has the `rules-2` action engine and its first FIBA 2024 rules subset, including coaching opportunities, eligibility, penalties, clocks, injuries and assistant substitutions. Its remaining rules coverage and calibration work are tracked in the [rules matrix](design/rules-coverage.md) and [implementation status](implementation-status.md). This is progress within Milestone 2, not a claim that its complete acceptance gate has passed. The downloaded EuroLeague/EuroCup reference records remain separate from the exhibition.

Next work expands the action model and statistical calibration, then the event-driven match presentation and season/career systems in the order below. Competition-specific rules must be configured before those competitions become playable; EuroLeague's verified possession rules already differ from the exhibition baseline.

## 2. Milestone 0: design and evidence baseline

Deliver the main GDD, specialist specifications, decision log, architecture and this plan. Capture the eighteen discovery answers, including a youth coach and direct/delegated business controls. Resolve contradictory ownership of form, condition, injuries and money.

Audit source coverage at minimum across both tiers in all six countries and the three European competitions. Sample promoted clubs, midseason transfers and outside-country continental entrants. Pin rules and historical effective dates. Select the final start date only after opening-day membership can be reconstructed.

Exit evidence: agreed product choices documented; missing data explicitly recorded; no false claim of a complete roster pack. The full audit can continue while engine milestones progress.

## 3. Milestone 1: runnable simulation foundation

Build a TypeScript project and lean dark application shell around a clearly labeled fictional exhibition fixture. Implement stable IDs, player attributes, roster data, seeded randomness, a serializable match state, and one shared progression function for step, quarter skip and full simulation.

Include a scoreboard, event history, basic box score, simple tactical inputs, eligibility-safe lineup selection and a diagonal development court. Add export/import of the complete fixture state with validation. Keep missing features visibly described as planned; no nonfunctional navigation masquerading as a management system.

This fixture is a useful engineering checkpoint, not the calibrated final engine or a playable multi-league career. Its simplifications must be recorded in README and implementation status.

Acceptance:

- Identical initial state and tactics produce identical events/results in stepped, quarter-skipped and instant progression.
- Score, makes/attempts, game time and lineup minutes reconcile.
- Save/restore continues the same random stream and result.
- Ties resolve through overtime; forbidden substitutions and malformed saves are rejected.
- Type checking, relevant engine tests and production build pass.

## 4. Milestone 2: legal, calibrated action engine

Replace development approximations with the documented action/rules model: clocks, possession transitions, shot locations and creation, defenders, rebounds, free throws, foul classifications, penalties, legal substitution/timeout opportunities and exclusion/default rules.

Build an article-to-test matrix for each ruleset. Add persistent fatigue, exposure-based injuries, assistant policies, bounded temporary execution and coordination effects. Use configurable competition/strength baselines.

Acceptance: edge-case fixtures pass; matched commands remain playback-independent; statistical reports cover shot mix, pace, efficiency, fouls, turnovers, rebounds and minutes. Parameters are labeled uncalibrated until evidence supports them.

## 5. Milestone 3: match presentation and coaching

Build the final diagonal court renderer around engine events: coherent player positions, ball paths, pass/shot/rebound sequences, team direction, bench and appearance descriptors. Add playback speed, free pause, current-quarter skip, critical-event pause, queued substitutions, timeouts and optional detailed matchups.

Match portrait and court appearance. Implement reduced-motion and text alternatives. Distinguish intent from guaranteed shot distribution in tactical explanations.

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

Exit evidence: release stories in the GDD pass; all agreed competitions are playable; data coverage and estimates are documented; local save/export recovery works; production build passes. User retains deployment responsibility.

## 11. Work control

Each implementation increment updates [status](implementation-status.md) with working behavior, validation, known limitations and next dependency. Do not present a milestone number as a completion percentage: data preparation and simulation calibration contain substantial uncertainty.

Do not guess calendar estimates before the historical audit and engine benchmark. Size and sequence work using measured throughput. Any proposal to reduce the agreed league/tier scope requires an explicit product decision; it must not happen through an engineering shortcut.
