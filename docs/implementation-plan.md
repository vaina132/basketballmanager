# Implementation plan

Baseline: 5 November 2026. This is the build sequence for the confirmed design, not a promise that the entire game is implemented in one pass. Ten domestic divisions (top and second divisions in Turkey, Spain, Italy and France; top divisions in Greece and Germany) and three European competitions are the first-release scope, with league selection when a career starts (owner's decision of 13 November 2026, see [decisions](decisions.md#first-release-league-scope-and-league-selection)).

Current milestone status, 15 November 2026. The active work is [multi-league sprint 3](multi-league-world.md): imports are complete with data-quality follow-ups; single-league save scaling (3.2) is complete; the domestic part of 3.3 now runs shared weekly careers with real byes and independent league tables. Country selection from 3.6 is integrated. **3.4 is in progress:** sourced French regular-season standings, game days inside a week, every league's real postseason and promotion/relegation between a country's two divisions are done (formats 48-50), new worlds rank Spain's, Germany's and Italy's leagues by their verified rules and the rest by the labelled FIBA Appendix D default (formats 51-52, step 3.4e). Clubs now leave and join the full world at season ends wherever the world lists a country's next division (formats 53-55, steps 3.4d-1 to 3.4d-2); the screens (3.4d-3) and real next-division names (3.4d-4, local-only) remain; [HANDOVER.md](../HANDOVER.md) has the current next step. **3.5 is in progress:** European entrants are in new worlds (format 56, 3.5a) and the EuroLeague plays in its real format on midweek game days, with clubs outside the full world as background sides (format 57, 3.5b-c), and so do the EuroCup (format 58, 3.5d) and the BCL (format 59, 3.5e); unchosen leagues get estimated tables and each season end decides the next season's places (format 60, 3.5f); the screens (3.5g) remain. Then come measured setup guidance and combined-world acceptance (3.6–3.7). The dated implementation narrative below remains historical context.

| Milestone | Status | Working now / principal remaining work |
| --- | --- | --- |
| 1. Foundation | Complete | Deterministic domain/engine foundation, development data, tests and initial application. |
| 2. Rules and match engine | Partial | Playable possession engine and tested rules subset; complete competition rules and statistical calibration remain. |
| 3. Match viewer and coaching | Partial | Large court, animated actions, stamina, ability/match ratings, PIR/MVP, substitutions and tactical controls; richer movement and final presentation remain. |
| 4. World and saves | Partial | All ten domestic leagues can share a career, including odd-club byes; country/division selection, independent tables, rollover, history, worker saves, smaller historical records and validated local checkpoints work. Real postseason/promotion, European midweek games/background clubs, measured selection estimates and five-season combined-world acceptance remain. |
| 5. Squad, training, health and staff | Partial | Squad information, training, injuries, training coaches, scouts, fitness coaches, physios, assistants and youth coaches; academy intake/promotion, youth fixtures/results and medical availability, age-adjusted senior practice, gradual decline and retirement; agreed roles, playing-time promises, morale and bounded match focus; deeper relationships/chemistry, richer development, youth match coaching and population calibration remain. |
| 6. Scouting, recruitment and finances | Partial | Scouting, budgets, negotiations, competing bids, installments, buyouts, paid/free in-season registration, optional release clauses, recruitable scouts, quality-dependent discovery and simpler Club management; broader contract mechanics, regional scouting and the complete economy remain. |
| 7. Facilities, business, board and career | Accepted (13 November 2026) | Ticket pricing, negotiated main-sponsor agreements with dated payments and optional delegation, and funded arena/training/youth upgrades with construction, upkeep and optional delegation; fixed board objectives, dated reviews and confidence; board capital requests for facility upgrades with fictional club presidents; season verdicts that set the next season's staff budget and owner capital; press conferences after result runs and an Inbox of recorded events; fictional rivalries with capped derby effects; facility condition with full or reduced upkeep; optional season-end dismissal and job offers with a choice before the offseason (format 38). Later additions: project financing and loans, further president traits, contract-future requests and unemployed seasons. |
| 8. Integrated first release | Pending | Verified opening-day player/club data, all agreed competitions, complete management modules, calibration and release acceptance remain. |

The latest increments bring dismissal and job changes: a season that ends Under pressure dismisses the manager, clubs replacing their coach offer jobs by reputation, and the manager chooses before the offseason whether to join one or stay (format 38); before that, the groundwork recorded club changes and credited every saved decision to the club managed at that time (format 37). Before it came facility condition and upkeep plans: reduced upkeep saves half the cost while upgraded facilities wear and lose part of their benefit, full upkeep restores them (format 36). Before it came fictional rivalries: derbies draw bigger crowds and weigh more with the board and the squad, within caps, from the matchday they take effect (format 35). Before it came press conferences after runs of three wins or defeats, with small fading morale effects, and an Inbox page of recorded club events (format 34). Before it came board season verdicts: each season's final board confidence sets the next season's staff budget and owner capital (rewards as investment, penalties as tighter budgets), shown on the Board page and the manager's desk; older careers opt in under format 33. Before it came board funding requests: each club has a fictional president whose generosity sets the confidence the board needs, and the manager can ask the board to fund the part of a facility upgrade the club cannot pay, seeing the expected answer before asking and the reason for any refusal. Automatic control and rival clubs ask under the same rules. It follows sponsorship negotiations in Club (dated offers, one request per offer, dated installments and optional bonuses). Earlier careers opt in prospectively under format 32. Detailed behavior and verification are recorded in [current status](implementation-status.md) and the provisional rules in [decisions](decisions.md#board-funding-policy) and [sponsorship](decisions.md#sponsorship-negotiation-policy).

Level 7 passed its acceptance check on 13 November 2026 (step 7.8 in the [handover history](handover-history.md)). Richer player relationships remain Level 5 work. Real competition/data integration and match calibration remain parallel requirements.

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

### Progress on 10 November 2026

Milestone 1 is implemented. Milestone 2 now has the `possession-3` action engine and a tested FIBA 2024 subset. Separate advances, passes, drives and shots use saved court positions and defensive matchups; earlier `rules-2` saves continue with their original engine. Milestone 3 now has animated engine-authored court scenes, pause/resume, playback speeds, reduced-motion and text-only views. Both milestones remain partial: the action model, competition overrides and statistical calibration are still being developed. The [rules matrix](design/rules-coverage.md) and [implementation status](implementation-status.md) record the exact coverage. Downloaded EuroLeague/EuroCup reference records remain separate from the exhibition.

The earlier user-directed court increment places a larger, full-width court immediately below the score, removes the standalone shot-clock/possession panel, and moves coaching controls below the court. Home/away lineup and bench views show current stamina with visual bars and percentages. These layout changes leave the sporting engine unchanged.

The user's subsequent interface direction applies to every increment: the overview must be a functional manager's desk and all screens must behave as management-game workspaces. Prioritize club state, availability, useful tables, the next decision and working actions. Remove landing-page promotions and keep the development roadmap in documentation. [Interface requirements](game-design.md#11-interface-structure) and [repository guidance](../AGENTS.md) record this direction for future work.

The possession-action increment adds causal spacing and matchups, direct passer assists, resumable live possessions and creation feedback beneath the coaching controls. Isolated tactical comparisons measure tempo, outside emphasis and defensive pressure separately. Next engine work calibrates the resulting pace, shot mix and efficiency, extends off-ball and defensive decisions, and implements the remaining competition rules. Calibration and the season/career foundation continue in the dependency order below. Competition-specific rules must be configured before those competitions become playable; EuroLeague's verified possession rules already differ from the exhibition baseline. The current viewer interpolates recorded action scenes; it does not yet simulate continuous possession physics.

The first Milestone 4 increment now provides a playable development season: six fictional clubs, ten weekly matchdays, thirty home/away fixtures, club choice, derived standings and compact result reviews. Human and AI games use the same possession engine with independent fixture seeds. Instructions, final lineups and condition carry between fixtures; recovery runs once per matchday. Season persistence is separate from exhibition saves, and background matchday processing commits atomically or cancels without changing the world. The subsequent persistent-health increment adds Standard, Reduced and Off injury modes for all clubs, calendar-based recovery, eligibility-safe fixture preparation and medical reports; old saves retain injuries off. This validates the season loop; it does not substitute for the twelve domestic divisions, continental competitions or verified historical rosters.

Persistent health records match incidents and recovery dates across fixtures. The development career rolls into a new annual schedule with the same club, instruction policies and health history; offseason recovery applies once, and previous tables and scores remain available. Format-13 saves retain archives, training, coaching, finances, payroll, employment, scouting, negotiation history and dated recruitment windows, and migrate valid formats 1–12 without changing their active match or enabling the new calendar. Employment now changes registrations at rollover; aging, youth intake, retirement, promotion/relegation and qualification remain unimplemented. The next world work adds validated competition configurations and calendars, competition-specific registration and transitions. Local persistence retains five transactional checkpoints, autosaves at new-game/matchday/rollover boundaries and contract/scouting decisions, and rejects stale-tab writes; recovery is available through Save history. Weekly team and individual training runs between matchdays, with workload/recovery tradeoffs, assistant delegation, eligible-day participation and skill development. New careers enable it; pre-training saves retain their original recovery model until explicitly enabled. Additional staff roles, advanced training, facilities and full financial/board systems remain later milestones; detailed rehabilitation and injury calibration also remain open.

The performance-analysis increment adds current-season squad statistics, league player comparisons and individual match histories using committed box scores. Sorting, per-game/totals/per-40 views and participation filters support lineup and training decisions without adding a second statistics ledger. The subsequent roster-history increment extends these reports to newly retained archived player seasons; older archives retain team scores only.

The first staff increment implements training-coach recruitment, three-slot limits, full-season fee commitments, assignments, releases and renewals. Every club uses the same allocation and validation; AI recruitment fills vacancies within those limits. Coaches contribute bounded, reported practice bonuses, with frozen weekly assignments preserved after later edits. Earlier saves keep coaching disabled until activation. This was the initial coaching allocation model. Later increments add assistants, youth coaches and player aging. Monthly staff payroll, staff negotiations, facilities and real competition/data integration remain open dependencies. The confirmed staff role limits and youth-coach requirement are unchanged.

The first finance increment adds manual/delegated ticket pricing, deterministic attendance, a reconciled cash/obligation ledger, annual sponsorship and matchday costs. Coaching appointments and renewals use cash as well as the staffing allocation. Prices lock before play, transactions commit with the matchday, and earlier saves opt into the new economy. Payroll and employment now build on that foundation; facilities and the broader club economy remain unfinished alongside real competition/data integration and engine calibration.

The payroll increment adds annual player wage agreements, future wage commitments, ten matchday installments and optional discounted settlement. Human and AI decisions share cash/reserve checks, and older careers enable the system prospectively. This is the payment side of player contracts. Historical roster ownership and employment now supply the registered club and agreed salary for each annual schedule. Wages remains the payment workspace; duration, renewal and recruitment decisions live in Transfers.

The career-entry increment adds a proper main menu and Manager, Club and Review setup, with name, date of birth, nationality and profile persistence. Existing careers can add or edit identity without resetting play. This closes the initial entry-flow gap while retaining the fictional development pack. Named independent career slots, real pack/league selection and the broader management modules remain open. The subsequent roster-history increment completes the reporting prerequisite for genuine contracts/recruitment; verified data, real competitions and match calibration are parallel unfinished tracks.

The roster-history increment adds saved registration snapshots for match and training attribution, preserves full player box scores at rollovers, and exposes past-season statistics and reviews in Squad and Competitions. Legacy membership can be reconstructed from its fixed pack; discarded historical box scores remain unavailable. These snapshots now preserve actual club stints and historical jerseys when employment changes current squads.

The employment increment adds a working Transfers workspace, expiring contracts, one-to-three-year renewals, salary offers and offseason free-agent signings. Initial terms expire in the current year; accepted offers apply next season, leaving completed-season rosters immutable. All clubs share a EUR 240,000 annual salary allocation, eight-to-twelve-player limits, nonoverlapping employment and a reserve to reach eight players. AI clubs retain eight before the market opens, then recruit toward ten after minimum squads are secured. Assistant control immediately reviews binding renewals and offseason signings under the same guards. Rollover applies actual departures and recruitment together with lineups, training memberships, registration snapshots and payroll. All sixty players retain identity and development, including free agents. New careers enable employment; imported formats 1–9 opt in after finance and payroll activation. Every contract decision creates a checkpoint; the employment/registration/payroll audit introduced in format 10 remains part of the current format. The [status record](implementation-status.md#verification-completed) retains the 928-test result, production verification and fifteen-season consistency diagnostic for that increment.

The scouting increment adds a player directory, persistent shortlists, two individual observation slots per club and matchday, manual/assistant assignments, and dated reports linked to actual registered-player exposure. No minutes means no knowledge gain. Repeated successful observations narrow outsider ranges through three levels without exposing exact skills; old reports broaden with calendar age. Own squads remain exact, and former-player assessments survive transfers. AI recruitment uses the acting club's knowledge when enabled, with neutral estimates for unknown outsiders. Format 11 retains observation history and validates provenance; imports through format 10 retain disabled scouting until activation. Assignments resolve only at real committed matchdays, with no invented offseason clock, fees or scout staff. This initial model does not include regional coverage, potential/personality assessment or calibrated scouting accuracy.

The negotiation increment adds explainable, deterministic acceptance, counteroffers and rejection with immutable per-club conversation history. One-year base requirements and rounded two/three-year premiums create an explicit salary-versus-duration choice; unsuitable offers can receive a shorter alternative. Submission warns that acceptance signs atomically, while counters/rejections consume no budget or cash. AI signings use the same policy and journal. Format 12 replays proposals against historical contract/budget state and keeps formats 1–11 unchanged until explicit activation. This adds no competing bids, offer expiry, agents, personal preferences or simulated negotiation time.

The subsequent user-directed usability increment is implemented: nationality suggestions with free text; optional Replay code with a fresh automatic default; one shared budget strip; visual coaching slots and recruit cards; age filters and shortlist → Observe → report → contract navigation; direct drag/tap/keyboard substitutions through the existing legal queue; and compact management screens with detailed information behind disclosures. Stable fictional birth dates provide calendar age without adding age-dependent development, retirement or a new data pack. The user explicitly retained the existing financial constraints, now displayed together with a reconciled breakdown rather than presented as one pooled balance. That interface pass left the match engine, economic rules and save contract unchanged. Validation is tracked in [implementation status](implementation-status.md#verification-completed).

Continue the visual workspace pattern in later modules: show actual identities, condition, budget consequences and the next decision first; reveal supporting detail when requested. Preserve keyboard/touch paths and route every action through authoritative rules. This usability pass does not mark the full career or management milestones complete.

The dated-offseason increment now implements a 28-day development window, next-day player replies, seven-day proposal holds, withdrawal/replacement/expiry and wage/roster reservations. The calendar advances to actual decision dates, with recoverable guards before closure and early rollover once every club has eight signed players and no open offers remain. AI and assistant recruitment submit the same pending commands; accepted replies create ordinary binding contracts. Conditions recover with elapsed days while completed match snapshots stay fixed. Format 13 replays the event journal and preserves formats 1–12 with the calendar disabled until activation. This first version reserves each player for one live proposal globally; it supplies the scheduling and reservation foundation without simulating competing bids. Final validation is tracked in [implementation status](implementation-status.md#verification-completed).

The competing-offer increment adds simultaneous club bids, deterministic player choice and release of unsuccessful salary/roster holds. Acceptable due bids are compared by annual salary, contract length, current employer and a stable tie-break. AI and assistant bids use the same guards. Format 14 retains exact event replay; format-13 live offers keep their old rules until settled, then competing bids activate prospectively. Paid and free in-season moves now extend this market; loans, agents and richer contract options remain unfinished; later increments add age-dependent practice, youth intake, fixtures and retirement. Real competition/data integration and match calibration continue as parallel tracks. The agreed twelve domestic divisions and three European competitions remain the first-release scope.

The paid-transfer increment adds contracted targets, seller review/approval/counters, separately reserved cash fees and a dated player decision. Acceptance atomically records both payment entries for both clubs and immutable releases of old future terms, with new employment effective on opening day. Format 15 replays transfers against historical financial/contract prefixes and migrates formats 1-14 without inventing moves. Subsequent increments add midseason transfers, optional release clauses, broader staffing and youth systems. Loans, richer contract mechanics, facilities and real competition/data integration remain unfinished.

The installment increment adds upfront, two-payment and three-payment fees with frozen real dates, protected unpaid commitments, paired actual receipts and automatic partial settlement from later cash. Format 16 audits historical payment/cash prefixes and migrates formats 1-15 without changing old money or results. It does not complete cash-flow forecasting, loan/agent clauses or the broader club economy.

The buyout increment adds offseason release of future contracted employment by paying every remaining guaranteed salary once. It protects cash and squad completion, leaves historical registrations and transfer installments intact, and permits recruitment by other clubs while preventing same-window re-signing by the releasing club. Format 17 retains settlement commands and exact contract/negotiation history anchors; migration preserves all earlier money and payment schedules. Midseason moves, negotiated buyout clauses, loans and broader management systems remain open.

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

Implement the ten playable divisions and three European competitions using validated season configurations, with the leagues included chosen when a career starts. Support club identity across competitions, draws, schedules, standings, tie-breakers, playoffs, cross-tier accession, registration, qualification and boundary promotion/relegation.

Represent external continental participants and background third-tier clubs. Add deterministic date advancement, worker orchestration, resumable rollover, IndexedDB revisions, save migration, export/import and one-writer conflict protection.

Acceptance: any supported club completes a season; dates/eligibility are coherent across domestic/European calendars; promotion and qualification conserve valid participants; interrupted rollover resumes without duplicate transactions.

## 7. Milestone 5: squad, training, health and staff

Implement player pages, roles and promises, morale, chemistry components, condition, form, training presets, delegated plans, injuries, uncertain assessments and rehabilitation. Add staff recruitment and limits including one proposed youth-coach slot; display half-star ratings correctly.

Build the academy prospect roster, simplified youth fixtures, individual development, promotion to the senior squad and deterministic annual intake. Aging, retirement and population replacement must keep the world sustainable.

Acceptance: each state has a named cause; workload is charged once; promises account for eligibility; training costs and staff capacity constrain benefits; youth/retirement keeps plausible roster age and ability distributions over repeated seasons.

## 8. Milestone 6: scouting, recruitment and finances

Current foundation: ticketing and cash accounting, annual payroll, salary/term offers, expiry, offseason free-agent recruitment, delegation, atomic next-year registrations, persisted scouting observations, uncertain skill ranges, report freshness and shortlists are implemented for the fictional league. AI recruitment uses the acting club's knowledge when scouting is enabled. Salary/term negotiations now produce explainable acceptance, counteroffers or rejection. The dated offseason calendar, offer deadlines, wage/roster reservations, competing club bids, club consent, transfer installment schedules, automatic partial payments and offseason contract buyouts are implemented. In-season free agents can now sign for the remaining season, with next-matchday replies, cash/salary/roster reservations, immutable registration history and prorated payroll. Paid in-season transfers now add club consent, up to three covered seasons, installment fees and prospective payroll stops with immutable prepaid history. Optional release clauses now add a disclosed salary/control tradeoff and an upfront route to player talks, with historical terms preserved. A tested current-season cash projection remains an internal selector; its expected/cautious interface was removed at the user's request. Club presents actual financial activity. Recruitable scouts add named observation capacity, frozen report quality and a quality-dependent discovery pool within the shared staff allocation. Fitness coaches now add bounded weekly condition effects. Physios and the Medical workspace now add bounded, dated rehabilitation. Assistant-coach recruitment now adds current-squad recommendations and prospective AI tactics. Academy graduates enter the same recruitment and financial rules; youth fixtures, senior aging and retirement now support that lifecycle. Continue with the remaining management systems below. These foundations do not complete this milestone's full economy, regional scouting or AI-strategy requirements.

Implement knowledge maps, regional assignments, discovery, report uncertainty and freshness. Add shortlists, offers, negotiations, competing bids, contracts, loans where permitted, medicals, registration and contract expiry.

Implement a reconciled ledger, payroll, commitments, installments, cash-flow forecasts, board budgets and offer reservations. AI recruitment uses its own knowledge and the same transaction validation.

Acceptance: simultaneous offers cannot overspend reservations; failed negotiations are explainable; ownership, registration and wages update atomically; hidden potential is not exposed in the normal interface; bankrupt or roster-empty clubs trigger defined recovery/failure behavior.

## 9. Milestone 7: facilities, business, board and career

Current foundation: all three facility types have funded upgrades, calendar durations, completed-level upkeep, temporary arena disruption and optional delegation under existing cash/commitment guards. Board objectives and dated confidence reviews now use actual results and unpaid costs. Board capital requests for upgrades, decided by board confidence and the president's generosity, are implemented, as are upkeep choices with deterioration, season verdicts and optional dismissal with job changes; loans and other project financing remain.

Facilities include arena/stadium, training facilities and youth infrastructure. Add project cost/duration, maintenance, funding, temporary disruption and board constraints. Let the manager set ticket policies, negotiate sponsorship and manage upgrades or delegate each responsibility.

Delegation has explicit authority, budget limits and reporting. Manual and automatic decisions share the same services; automation cannot bypass board budgets. Add meaningful press/player events, further president traits (generosity is implemented), rivalries, board evaluation, optional dismissal and job changes.

Acceptance: overpricing affects demand plausibly; sponsors and capital projects cannot create free money; delegated actions respect policy and report results; dismissal preserves the world and enables a continuing career.

## 10. Milestone 8: integrated first release

Load the verified historical pack and permitted assets. Complete useful English navigation for Home, Inbox, Squad, Tactics, Training, Staff, Scouting, Transfers, Competitions, Club and Settings. Remove placeholders from completed journeys and show remaining gaps honestly.

Run multi-season simulations across all competition tiers, checking statistical realism, financial health, youth quality, staffing, transfer behavior, league entry, save size and recovery. Review representative games visually and review tactics for universally dominant exploits.

Exit evidence: release stories in the GDD pass; all agreed competitions are playable; data coverage and estimates are documented; local save/export recovery works; production build passes. Every management screen presents real game state and working decisions with readable desktop/tablet tables, keyboard access and consistent status after state changes. User retains deployment responsibility.

## 11. Work control

Each implementation increment updates [status](implementation-status.md) with working behavior, validation, known limitations and next dependency. Do not present a milestone number as a completion percentage: data preparation and simulation calibration contain substantial uncertainty.

Do not guess calendar estimates before the historical audit and engine benchmark. Size and sequence work using measured throughput. Any proposal to reduce the agreed league/tier scope requires an explicit product decision; it must not happen through an engineering shortcut.
