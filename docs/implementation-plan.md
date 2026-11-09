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

### Progress on 9 November 2026

Milestone 1 is implemented. Milestone 2 now has the `possession-3` action engine and a tested FIBA 2024 subset. Separate advances, passes, drives and shots use saved court positions and defensive matchups; earlier `rules-2` saves continue with their original engine. Milestone 3 now has animated engine-authored court scenes, pause/resume, playback speeds, reduced-motion and text-only views. Both milestones remain partial: the action model, competition overrides and statistical calibration are still being developed. The [rules matrix](design/rules-coverage.md) and [implementation status](implementation-status.md) record the exact coverage. Downloaded EuroLeague/EuroCup reference records remain separate from the exhibition.

The earlier user-directed court increment places a larger, full-width court immediately below the score, removes the standalone shot-clock/possession panel, and moves coaching controls below the court. Home/away lineup and bench views show current stamina with visual bars and percentages. These layout changes leave the sporting engine unchanged.

The user's subsequent interface direction applies to every increment: the overview must be a functional manager's desk and all screens must behave as management-game workspaces. Prioritize club state, availability, useful tables, the next decision and working actions. Remove landing-page promotions and keep the development roadmap in documentation. [Interface requirements](game-design.md#11-interface-structure) and [repository guidance](../AGENTS.md) record this direction for future work.

The possession-action increment adds causal spacing and matchups, direct passer assists, resumable live possessions and creation feedback beneath the coaching controls. Isolated tactical comparisons measure tempo, outside emphasis and defensive pressure separately. Next engine work calibrates the resulting pace, shot mix and efficiency, extends off-ball and defensive decisions, and implements the remaining competition rules. Calibration and the season/career foundation continue in the dependency order below. Competition-specific rules must be configured before those competitions become playable; EuroLeague's verified possession rules already differ from the exhibition baseline. The current viewer interpolates recorded action scenes; it does not yet simulate continuous possession physics.

The first Milestone 4 increment now provides a playable development season: six fictional clubs, ten weekly matchdays, thirty home/away fixtures, club choice, derived standings and compact result reviews. Human and AI games use the same possession engine with independent fixture seeds. Instructions, final lineups and condition carry between fixtures; recovery runs once per matchday. Season persistence is separate from exhibition saves, and background matchday processing commits atomically or cancels without changing the world. The subsequent persistent-health increment adds Standard, Reduced and Off injury modes for all clubs, calendar-based recovery, eligibility-safe fixture preparation and medical reports; old saves retain injuries off. This validates the season loop; it does not substitute for the twelve domestic divisions, continental competitions or verified historical rosters.

Persistent health records match incidents and recovery dates across fixtures. The development career rolls into a new annual schedule with the same club, instruction policies and health history; offseason recovery applies once, and previous tables and scores remain available. Format-12 saves retain archives, training, coaching, finances, payroll, employment, scouting and negotiation history, and migrate valid formats 1–11 without changing their active match. Employment now changes registrations at rollover; aging, youth intake, retirement, promotion/relegation and qualification remain unimplemented. The next world work adds validated competition configurations and calendars, competition-specific registration and transitions. Local persistence retains five transactional checkpoints, autosaves at new-game/matchday/rollover boundaries and contract/scouting decisions, and rejects stale-tab writes; recovery is available through Save history. Weekly team and individual training runs between matchdays, with workload/recovery tradeoffs, assistant delegation, eligible-day participation and skill development. New careers enable it; pre-training saves retain their original recovery model until explicitly enabled. Additional staff roles, advanced training, facilities and full financial/board systems remain later milestones; detailed rehabilitation and injury calibration also remain open.

The performance-analysis increment adds current-season squad statistics, league player comparisons and individual match histories using committed box scores. Sorting, per-game/totals/per-40 views and participation filters support lineup and training decisions without adding a second statistics ledger. The subsequent roster-history increment extends these reports to newly retained archived player seasons; older archives retain team scores only.

The first staff increment implements training-coach recruitment, three-slot limits, full-season fee commitments, assignments, releases and renewals. Every club uses the same allocation and validation; AI recruitment fills vacancies within those limits. Coaches contribute bounded, reported practice bonuses, with frozen weekly assignments preserved after later edits. Earlier saves keep coaching disabled until activation. This is an initial coaching allocation model; assistant, fitness, physio, scout and youth-coach recruitment, monthly staff payroll, staff negotiations, facilities, aging and real competition/data integration remain open dependencies. The confirmed staff role limits and youth-coach requirement are unchanged.

The first finance increment adds manual/delegated ticket pricing, deterministic attendance, a reconciled cash/obligation ledger, annual sponsorship and matchday costs. Coaching appointments and renewals use cash as well as the staffing allocation. Prices lock before play, transactions commit with the matchday, and earlier saves opt into the new economy. Payroll and employment now build on that foundation; transfer fees, facilities and the broader club economy remain unfinished alongside real competition/data integration and engine calibration.

The payroll increment adds annual player wage agreements, future wage commitments, ten matchday installments and optional discounted settlement. Human and AI decisions share cash/reserve checks, and older careers enable the system prospectively. This is the payment side of player contracts. Historical roster ownership and employment now supply the registered club and agreed salary for each annual schedule. Wages remains the payment workspace; duration, renewal and recruitment decisions live in Transfers.

The career-entry increment adds a proper main menu and Manager, Club and Review setup, with name, date of birth, nationality and profile persistence. Existing careers can add or edit identity without resetting play. This closes the initial entry-flow gap while retaining the fictional development pack. Named independent career slots, real pack/league selection and the broader management modules remain open. The subsequent roster-history increment completes the reporting prerequisite for genuine contracts/recruitment; verified data, real competitions and match calibration are parallel unfinished tracks.

The roster-history increment adds saved registration snapshots for match and training attribution, preserves full player box scores at rollovers, and exposes past-season statistics and reviews in Squad and Competitions. Legacy membership can be reconstructed from its fixed pack; discarded historical box scores remain unavailable. These snapshots now preserve actual club stints and historical jerseys when employment changes current squads.

The employment increment adds a working Transfers workspace, expiring contracts, one-to-three-year renewals, salary offers and offseason free-agent signings. Initial terms expire in the current year; accepted offers apply next season, leaving completed-season rosters immutable. All clubs share a EUR 240,000 annual salary allocation, eight-to-twelve-player limits, nonoverlapping employment and a reserve to reach eight players. AI clubs retain eight before the market opens, then recruit toward ten after minimum squads are secured. Assistant control immediately reviews binding renewals and offseason signings under the same guards. Rollover applies actual departures and recruitment together with lineups, training memberships, registration snapshots and payroll. All sixty players retain identity and development, including free agents. New careers enable employment; imported formats 1–9 opt in after finance and payroll activation. Every contract decision creates a checkpoint; the employment/registration/payroll audit introduced in format 10 remains part of the current format. The [status record](implementation-status.md#verification-completed) retains the 928-test result, production verification and fifteen-season consistency diagnostic for that increment.

The scouting increment adds a player directory, persistent shortlists, two individual observation slots per club and matchday, manual/assistant assignments, and dated reports linked to actual registered-player exposure. No minutes means no knowledge gain. Repeated successful observations narrow outsider ranges through three levels without exposing exact skills; old reports broaden with calendar age. Own squads remain exact, and former-player assessments survive transfers. AI recruitment uses the acting club's knowledge when enabled, with neutral estimates for unknown outsiders. Format 11 retains observation history and validates provenance; imports through format 10 retain disabled scouting until activation. Assignments resolve only at real committed matchdays, with no invented offseason clock, fees or scout staff. This initial model does not include regional coverage, potential/personality assessment or calibrated scouting accuracy.

The negotiation increment adds explainable, deterministic acceptance, counteroffers and rejection with immutable per-club conversation history. One-year base requirements and rounded two/three-year premiums create an explicit salary-versus-duration choice; unsuitable offers can receive a shorter alternative. Submission warns that acceptance signs atomically, while counters/rejections consume no budget or cash. AI signings use the same policy and journal. Format 12 replays proposals against historical contract/budget state and keeps formats 1–11 unchanged until explicit activation. This adds no competing bids, offer expiry, agents, personal preferences or simulated negotiation time.

The subsequent user-directed usability increment is implemented: nationality suggestions with free text; optional Replay code with a fresh automatic default; one shared budget strip; visual coaching slots and recruit cards; age filters and shortlist → Observe → report → contract navigation; direct drag/tap/keyboard substitutions through the existing legal queue; and compact management screens with detailed information behind disclosures. Stable fictional birth dates provide calendar age without adding age-dependent development, retirement or a new data pack. The user explicitly retained the existing financial constraints, now displayed together with a reconciled breakdown rather than presented as one pooled balance. The match engine, economic rules and format-12 save contract remain unchanged. Validation is tracked in [implementation status](implementation-status.md#verification-completed).

Continue the visual workspace pattern in later modules: show actual identities, condition, budget consequences and the next decision first; reveal supporting detail when requested. Preserve keyboard/touch paths and route every action through authoritative rules. This usability pass does not mark the full career or management milestones complete.

The next management dependency is a dated offseason decision calendar, offer deadlines and budget/roster reservations, followed by competing club bids resolved on that calendar. The current market still lacks transfer fees, midseason moves, buyouts, early termination, loans, agents and competing offers; aging, youth intake and retirement are also open. Real competition/data integration and match calibration continue as parallel tracks. The agreed twelve domestic divisions and three European competitions remain the first-release scope.

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

Current foundation: ticketing and cash accounting, annual payroll, salary/term offers, expiry, offseason free-agent recruitment, delegation, atomic next-year registrations, persisted scouting observations, uncertain skill ranges, report freshness and shortlists are implemented for the fictional league. AI recruitment uses the acting club's knowledge when scouting is enabled. Salary/term negotiations now produce explainable acceptance, counteroffers or rejection. Next, add a dated market decision calendar, offer deadlines, budget/roster reservations and competing club bids, then the remaining transfer systems below. These foundations do not complete this milestone's full economy, regional scouting or AI-strategy requirements.

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
