# Club, player, and world simulation — draft

Status: target management mechanics, 5 November 2026. The current exhibition foundation does not implement these career systems; see [implementation status](../implementation-status.md).
The user's requested features are requirements; formulas, weights, timing, and scope choices below are design proposals.
Numerical coefficients are initial tuning hypotheses, not validated basketball, financial, or medical findings.
Confirmed direction (revised 13 November 2026, see [decisions](../decisions.md#first-release-league-scope-and-league-selection)): men's basketball, with the top and second divisions in Turkey, Spain, Italy and France and the top divisions in Greece and Germany fully playable in the first release, plus EuroLeague, EuroCup, and Basketball Champions League; a new career chooses which leagues are included.
These ten domestic divisions are core playable scope, not deferred or background-only leagues. The starting database uses the latest completed verifiable season's opening-day roster snapshot.
The player is a full manager over recruitment, contracts, staff, and tactics within board budgets, across unlimited seasons with optional dismissal and job changes.
Presentation uses a diagonal 2.5D court; saves are local single-player with import/export. The interface is English and targets desktop and tablet.
Known identities and rosters must be verified; unavailable salaries and traits may use clearly labeled estimates.
Confirmed additions: an academy with simplified youth fixtures and a youth coach; direct business/facilities control with optional delegation; meaningful media events; critical match pauses; adjustable realistic injury incidence; and a clean dark interface.

## 1. Design contract

- A club must remain understandable through its squad, calendar, cash position, commitments, and goals.
- Human and AI clubs obey the same registration, contract, money, injury, and roster constraints.
- Complexity belongs in the simulation; the interface presents the next useful decision and its consequences.
- Changes have named causes, persistent history, and explicit limits; avoid unrelated hidden bonuses.
- Save state includes random-generator state, pending events, promises, financial obligations, and version identifiers.
- A simulated day processes once, even after a save reload; transactions and scheduled events have unique IDs.
- Real observations, estimated basketball ratings, and fictional simulation personalities are separately labeled.
- Never present invented temperament, medical history, loyalty, or ambition as a fact about a real person.

## 2. Player identity, skills, and state

Store stable IDs rather than identifying players by names. Names and clubs can change.
Identity includes birth date, nationalities, registration eligibility, preferred positions, handedness, height in cm, and weight in kg.
Appearance has a licensed/photo source reference and editable portrait/court traits: hair, facial hair, complexion, build, and accessories.
Court height and build follow recorded measurements; visual appearance does not create gameplay advantages beyond modeled physical attributes.
Use real photos where usable; otherwise use a consistent illustrated portrait with matching court appearance. An illustration is never labeled an authentic photograph.

| Group | Proposed attributes, displayed from 1 to 20 |
| --- | --- |
| Technical | Finishing, mid-range shooting, three-point shooting, free throws, passing, ball handling, offensive rebounding, defensive rebounding, screening, perimeter defense, interior defense |
| Mental basketball | Decisions, anticipation, composure, concentration, teamwork, off-ball movement |
| Physical | Stamina, strength, speed, acceleration, jumping, balance |
| Personality | Adaptability, aggression, ambition, loyalty, leadership, professionalism |

The default profile groups finishing and mid-range under a compact two-point summary, and perimeter/interior defense under defending.
Expanded attributes explain differences between players who share the same summary rating.
Use floating-point underlying ability for gradual development, clamped to [1,20]; display rounded integers or scouting ranges.
Own-roster basketball skills display exact rounded ratings. Outsiders' skills display scouting estimates or ranges; potential and personality remain report-based hidden information for all players.
Do not turn overall rating into the match engine's primary input: each action consults relevant abilities and context.
Overall and role suitability are optional summaries calculated for the selected role, never extra performance multipliers.
Potential is a hidden distribution of plausible development ceilings, not a guaranteed final overall rating.
Preferred positions and learned roles differ: a tall player is not automatically a capable center.

| Variable state | Meaning and intended update |
| --- | --- |
| Condition, 0–100 | Readiness before a match; during play, display a projection of readiness and acute exertion rather than maintaining a second fatigue penalty |
| Match sharpness, 0–100 | Readiness from recent competitive work; maintained by matches and suitable training |
| Morale, 0–100 | Satisfaction and confidence shaped by events, promises, relationships, and role |
| Observed form | Context-adjusted recent performance estimate with an explicit confidence/sample indicator |
| Temporary execution state | Small persistent, mean-reverting good/bad-form influence, separate from the observed results summary |
| Workload history | Training and match exposure, with recent and medium-term windows |
| Availability | Healthy, modified training, unavailable, or limited return; plus competition suspensions |
| Familiarity | Position, tactical-system, language/team integration, and teammate exposure |

Condition, morale, sharpness, and form must not represent the same thing under four names.
Condition affects physical execution and work capacity; sharpness affects timing within a small bounded range.
Morale affects bounded focus and decision consistency; it does not multiply every attribute.
Form reports recent outcomes relative to expectation. It is not also a direct blanket bonus, which would double count those outcomes.
Temporary execution state provides a small persistent form influence; it is not the raw observed-form score and is not reconstructed from points alone.
If performance updates that state, use opportunity-adjusted residuals with strong shrinkage; coordinate its cap with morale and sharpness to prevent stacked confidence bonuses.
The shared match specification proposes an initial bounded execution term of ±0.10 log-odds; this is uncalibrated and subordinate to action-level limits.
Initialize acute exertion from pre-match readiness once; write its resulting recovery burden back after play rather than applying condition and exertion twice.

## 3. Morale, promises, and playing-time expectations

Record event contributions with cause, strength, timestamp, half-life, and affected relationship.
Proposed representation: `morale = clamp(baseline + sum(decayingEventImpacts), 0, 100)`.
Proposed decay: `impact(t) = initialImpact * 2^(-daysElapsed / halfLifeDays)`.
Permanent problems, such as unpaid wages, remain active until resolved; they must not disappear solely through time decay.
Group contributions into role satisfaction, relationships, results, contract/security, adaptation, and personal events.
Cap each group before combining it so repeated press questions or consecutive small wins cannot create unlimited swings.
Show the strongest positive and negative reasons rather than exposing an unexplained number alone.
Player reactions depend on ambition, professionalism, loyalty, leadership, team status, and prior promises.
Aggression affects competitive risk and assertiveness; do not equate it mechanically with bad character.
Injured or suspended matches are excluded from eligible playing-time expectations.
Expected minutes are a negotiated role range over a rolling period, not a guarantee that every game meets a fixed number.
Promises have a measurable condition, deadline, exceptions, and success/failure consequence.
A contract conversation cannot silently create a promise; the manager sees the commitment before accepting it.
Team leaders can spread some sentiment through relationships, with capped influence and diminishing propagation.

## 4. Form and performance feedback

Keep match statistics, per-possession contributions, opponent strength, role, and minutes for each appearance.
Estimate expected contribution from abilities, role, matchup, and opportunity; compare actual contribution to this baseline.
Use residuals from several dimensions rather than points alone: scoring efficiency, creation, turnovers, rebounding, and defensive assignments.
Proposed form estimate is an exposure-weighted exponentially decaying mean of residuals, shrunk toward zero for small samples.
`formEstimate = rawResidualMean * effectivePossessions / (effectivePossessions + priorStrength)`.
Use a bounded normalized residual so a single extreme game cannot dominate an entire month.
Present form as improving/steady/struggling with a trend and sample size; allow details on the player page.
An injury absence lowers confidence in the estimate; it does not itself become poor form.
An excellent defender should be recognized even when the box score is quiet; record engine-observed defensive outcomes.

## 5. Team chemistry and confidence

Chemistry describes coordination and relationships; coach confidence describes belief in the manager; board confidence is a separate employment measure.
Maintain pair familiarity `F(i,j)` in [0,1] from shared training and meaningful court exposure.
For shared exposure `x`, propose `F_next = 1 - (1 - F_current) * exp(-x / learningScale)`.
Inactive pairs decay slowly toward a floor; a transfer changes relationships without deleting a returning player's history.
Lineup familiarity is the weighted mean of its ten pair relationships, with additional responsibility weights for ball-handler/screener and defensive partnerships.
Team chemistry displayed to the user is a minutes-weighted projection of likely lineups, not a simple average over the entire club.

Initial diagnostic decomposition, each component normalized to [0,100]:

| Component | Proposed weight | How it changes |
| --- | --- | --- |
| Shared-court familiarity | 35% | Joint possessions and retained lineup continuity |
| Tactical familiarity | 25% | Appropriate training and repeated system execution |
| Relationship cooperation | 20% | Compatible roles, resolved disputes, leadership interactions |
| Role acceptance | 10% | Expectations, fair explanations, and kept promises |
| Trust in the coach | 10% | Consistency, credibility, and handling of meaningful events |

These weights describe a dashboard summary, not an additional global match multiplier.
The engine reads the corresponding components where relevant: passes, screens, rotations, and assignment execution.
Cap the total coordination effect at the action level so multiple related variables cannot amplify each other without limit.
Recent results influence morale, board confidence, and a limited confidence signal; do not also add a second chemistry bonus for the same win.
Rivalry results increase the magnitude and persistence of relevant emotional reactions, not the abilities or score of the next match.

## 6. Training, development, and aging

The default weekly interface asks for intensity, one team focus, and optional individual focus; an assistant can manage the rest.
Team focus options: balanced, shooting, ball movement, defense, rebounding, conditioning, and tactical familiarity.
Individual focus uses a role or small skill group, preventing an overwhelming list of daily exercises.
A calendar preview shows scheduled matches, recovery blocks, estimated workload, and expected development emphasis.
Schedule congested weeks around recovery automatically; show manual overrides and their likely tradeoffs.
Development depends on training exposure, appropriate coaching, professionalism, age-dependent adaptability, facilities, health, and opportunity.
Proposed weekly skill change: `learningRate(age,skill) * effectiveExposure * coachingFactor * environmentFactor * remainingHeadroom - decline`.
`remainingHeadroom` approaches zero near a player's latent ceiling; improving from 19 to 20 should be much harder than from 5 to 6.
Training allocation is a budget: emphasizing one skill reduces time available to others.
Match exposure contributes to learning when the level and role are suitable; minutes alone must not guarantee growth.
Training quality saturates and declines with overload; repeating the hardest setting is not an optimal universal strategy.
Use individual age curves by skill family with modest variation; physical decline and decision-making development need not share a peak.
Do not sharply reduce every skill on a birthday; continuous aging updates avoid arbitrary cliffs.
Offseason development, growth in young players, and retirement decisions use the same ongoing process rather than unexplained annual bonuses.
Training and academy infrastructure affect the environment factor within bounded limits; their direct spending controls are part of the first-release design.
Development reports explain exposures and constraints without revealing the true potential ceiling.

## 7. Injuries, recovery, and availability

This is a game-balancing model, not a medical prediction system.
Separate sudden contact injuries, non-contact workload injuries, and illness events so one fatigue formula does not explain everything.
For each relevant exposure interval, use a hazard model: `P(event) = 1 - exp(-lambda * exposure)`.
`lambda` is a calibrated baseline for that event class multiplied by bounded modifiers for workload, fatigue, susceptibility, and relevant context.
Duration-based match and training hazards use player-hours with separately calibrated baselines and bounded intensity/context modifiers.
Convert minutes explicitly; possession counts and dimensionless training loads can inform modifiers but cannot substitute for hours in the same formula.
Contact-incident probabilities use a separate per-incident model; all paths retain exposure/incident IDs for deduplication.
Generate injury opportunities once in the authoritative match/training engine; the daily update must not reroll the same exposure.
Susceptibility and prior injury history require sourced data or clearly labeled fictional initialization; never infer them from appearance.
Avoid a single hard workload threshold that guarantees safety below it or injury above it.
An injury record includes category, body region, onset, severity, estimated absence range, restrictions, rehabilitation stage, and recurrence state.
The initial medical report gives a range; later assessments narrow uncertainty rather than arbitrarily changing a hidden fixed date.
A physio improves assessment accuracy and rehabilitation quality within limits; no staff member removes injury risk.
Recovery stages: unavailable, rehabilitation, modified training, full training, and return with optional minutes restriction.
Returning early can trade short-term availability for recurrence risk and impaired effectiveness; consequences are explained before selection.
An injury event can force an immediate substitution; the substitution and eligibility rules belong to the match rules engine.
Severity and recovery are sampled reproducibly and persist through reloads.
Track aggregate injuries, days lost, recurrence, and exposure denominators to identify unrealistic injury storms.
Availability filtering applies consistently in training, squad selection, AI rotation planning, and transfer medicals.
Default injury incidence targets calibrated realism; a reduced-injury setting scales incidence equally for every club, preserving coherent severity and recovery rules.
Store the selected injury setting in the save and calibration report; changing it must not heal existing injuries or reroll already resolved exposure.
Critical injuries or an ineligible active lineup pause the manager's match, including during quarter skipping; substitutions still obey the legal match opportunity.
Free user pause does not advance simulation time or create recovery. Explicitly delegated medical/substitution handling may resolve incidents under the saved policy.

## 8. Staff

| Role | Maximum | Primary influence |
| --- | --- | --- |
| Assistant coach | 1 | Advice, delegated rotation/tactics, player conversations, weekly plans |
| Coach | 3 | Technical/tactical training quality within assigned workload |
| Fitness coach | 1 | Conditioning plans, load estimates, recovery planning |
| Physio | 1 | Medical estimates, rehabilitation quality, return recommendations |
| Scout | 3 | Discovery, evaluation uncertainty, local knowledge, reporting speed |
| Youth team coach | 1 proposed | Academy development, youth training and fixtures, promotion advice |

The original five role limits are explicit user requirements and apply to AI clubs too.
The youth team coach role is confirmed; a cap of one is a proposed engineering default, because the user did not specify a number. Apply the final chosen cap equally to AI clubs.
Store the overall staff rating as an integer from 1 to 10; display `rating / 2` stars on a five-star scale.
For example, rating 7 displays three full stars and one half star; show the accessible text “3.5 out of 5 stars.”
Role-specific skills explain fit: judging ability/potential, local knowledge, instruction, tactics, fitness, or rehabilitation as appropriate.
An overall star rating is a summary of role skills, not a second benefit stacked on top of them.
Staff have contracts, wages, availability, reputation, preferred roles, and optional language/country knowledge.
Vacancies produce a documented baseline service; a missing assistant must not block time progression.
Staff workload has diminishing returns; three elite coaches cannot infinitely multiply development.
A single person cannot fill simultaneous contracted roles unless a future rule explicitly supports a combined appointment.

## 9. Scouting and imperfect knowledge

Maintain the true player database separately from each club's knowledge and reports.
Unknown players already exist in the world; a scouting discovery reveals them rather than generating a convenient new star on demand.
Publicly prominent players can be visible to everyone while their true ability, potential, demands, and availability remain uncertain.
Joining the managed squad reveals exact rounded basketball skills; potential, personality, and unverified factual data remain uncertain and appropriately labeled.
Club reach is a map of country/region knowledge with source, coverage, freshness, and network depth.
Knowledge follows scouts partly, while retained club reports remain with the club and become stale over time.
An assignment specifies region/country or competition, role/age/price filters, duration, and budget.
Assignment costs include modeled travel and observation resources; do not charge fictional per-click fees.
Proposed discovery hazard increases with coverage, local knowledge, observation effort, and player visibility, and saturates with repeated searching.
Country travel and permitted competition coverage are data-driven; exact geography and cost values await scope decisions.
Discoveries have an explanation, such as a youth tournament visit, club contact, or match observation.
Observations update estimated skill ranges using uncertainty reduction; repeated copies of the same match do not count as independent evidence.
A useful model is `posteriorPrecision = priorPrecision + independentObservationQuality` with a floor on remaining uncertainty.
Scouts can retain systematic biases, but repeated scouting should not reveal a deterministic answer after an arbitrary fixed number of visits.
Potential is reported as a range with confidence and risk factors; even elite scouts cannot certify a wonderkid's future.
An expired report shows its age; a player can develop, decline, recover, or change demands after observation.
The shortlist supports comparison by role fit, estimated cost, uncertainty, registration eligibility, and availability.
Reports should recommend an action: observe again, ask availability, approach, or reject, with reasons.

## 10. Contracts, transfers, and budgets

Recruitment separates player interest, selling-club willingness, contract negotiation, eligibility, and affordability.
Use competition/season rule packs for registration periods, roster limits, nationality/homegrown rules, and any permitted exceptions.
Do not import another sport's transfer-window, draft, salary-cap, or squad-registration assumptions into every competition.
Contract fields include start/end dates, salary schedule, role expectation, bonuses, options, release/buyout clauses, and agent costs where enabled.
Proposed first-version convention: annual gross salaries with monthly payroll and EUR reporting, preserving native-currency/source information. Label simplified tax and exchange assumptions; detailed jurisdiction modeling remains a research task.
Represent currency amounts in integer minor units and store currency codes; multi-currency conversion requires dated rate assumptions.
Contract end-of-season dates are distinct from a fixed number of days and must follow the relevant calendar.
A move can involve a free agent, negotiated release/payment, contract expiry, or an enabled clause. Include loans where the verified competition rules permit them, with explicit wage shares and availability/registration consequences.
Transfer listing signals availability; it does not guarantee offers or force a player to accept a move.
Offers have expiry dates and a persistent negotiation state; avoid repeated identical counteroffers every simulated day.
Player utility weighs role, compensation, club ambition, competition level, location/adaptation, relationships, and risk.
Club valuation weighs expected contribution, age, contract control, alternatives, financial pressure, and strategic fit.
Agent and player preferences can differ only if agents are explicitly modeled; avoid implying a hidden agent simulation otherwise.
Registration and financial validation run again at completion because the world can change while an offer is open.
Reserve capacity for accepted pending deals so several simultaneous negotiations cannot overspend the same money.

Use an auditable ledger with transaction ID, date, currency, account, amount, counterparty, cause, and recurring obligation references.
Separate bank cash, board-authorized recruitment budget, wage commitments, forecast operating result, and liabilities.
Initial model: `cashNext = cashNow + collectedReceipts - actualPayments`; promises of future revenue are not current cash.
Track remaining committed salary, staff costs, bonuses, installments, scouting costs, facility spending, and cancellation obligations.
Revenue may include ticketing, sponsorship, competition distributions, player payments, and board capital; values require sources or labeled estimates.
Show a cash forecast with an adverse scenario, not an implied guarantee that projected prize money will arrive. *Superseded by the user's later decision (see [AGENTS.md](../../AGENTS.md) and [game design §11](../game-design.md#11-interface-structure)): Club omits expected/cautious forecasts. Show actual cash, agreed terms, dated commitments and actual financial activity instead; the internal projection is not a gameplay screen.*
Board injections are explicit funded transactions with a finite owner's capacity and decision logic; they are not automatic bankruptcy prevention.
The default dashboard shows money available, committed wages, projected cash, and upcoming exceptional payments, including business and facilities commitments. *Projected cash is superseded as noted above; the shared budget strip and actual dated commitments remain.*
Financial failure rules—emergency cuts, administration, enforced sales, dismissal—need a deliberate design decision and applicable rule data.

## 11. Facilities, ticketing, sponsorship, and delegation

The manager directly controls authorized spending, ticket prices, sponsorship negotiations, and arena projects; these are not limited to requests sent to the board.
The board continues to set overall budgets and borrowing authority. A project outside current authority can trigger a funding request, while affordable authorized work can proceed directly.
Separate operating spending, capital projects, reserved commitments, and financing so a nominal transfer budget cannot accidentally fund the same money twice.
Facility categories include arena/stadium infrastructure, training facilities, academy infrastructure, medical/recovery equipment, and scouting infrastructure where supported.
Represent each facility with capacity, quality, condition, ownership/lease constraints, maintenance obligations, and active projects.
Benefits must map to named mechanisms: training quality, youth development, medical assessment, attendance capacity, or matchday spending; no universal facility bonus.
Facility quality has diminishing returns, while deterioration creates an upkeep decision rather than requiring weekly maintenance clicks.
An upgrade records scope, cost estimate, committed price, installment schedule, planned duration, construction state, and resulting capacity/quality.
Before commitment, show forecast cash, ongoing upkeep, construction disruption, expected benefit, and uncertainty. *Superseded for cash: per the user's later decision, reviews show the actual cost, payment dates, upkeep and the Remaining budget after payment, not cash forecasts.*
Construction takes calendar time; postponement, cancellation, and scope changes preserve sunk costs and outstanding obligations.
Arena projects may reduce usable capacity or require a temporary venue; the calendar service validates home fixtures and the ledger records the resulting costs.
Do not permit a new stand, venue, or academy to complete instantly because the manager advances several days in one click.

Ticket controls use a compact base match price and optional season-ticket offer; advanced category pricing can remain collapsed.
Estimate demand from club support, recent performance, competition/opponent appeal, rivalry, schedule, available capacity, and affordability.
An initial pricing hypothesis is `demand = baselineDemand * (price / referencePrice)^(-elasticity) * boundedContextFactors`, with strictly positive reference price and a separately defined free-entry case.
All demand coefficients and price sensitivity require calibration; do not present this expression as a measured real-club model.
Paid attendance is bounded by sellable capacity after valid season-ticket allocations and operational restrictions; never sell the same seat twice.
Revenue is actual paid ticket sales plus separately modeled matchday sales, less relevant operating costs; supporters absent from a match do not automatically buy new tickets.
Season-ticket cash timing is explicit, and later per-match reporting must not collect it a second time.
Show projected attendance, revenue, and a confidence range before a price change. Extreme prices can damage demand and fan satisfaction without an arbitrary guaranteed optimum.

Sponsorship deals specify commercial inventory/category, duration, fixed payments, payment dates, bonuses, exclusivity, and termination conditions.
Negotiate against offers driven by club reach, results, audience, reputation, competition participation, available inventory, and market conditions.
Prevent double-selling exclusive inventory such as a shirt slot or arena naming rights; renewing a contract must respect its current obligations.
Sponsorship promises and performance bonuses become dated ledger obligations; speculative future success is not current cash.
Use clearly fictional commercial counterparties unless actual sponsorship terms and permitted identity use are verified.
AI clubs price tickets, maintain facilities, select projects, and negotiate sponsorship within the same money, inventory, and calendar constraints.

Each responsibility offers manual, advice, or automatic operation: training, rotations, scouting assignments, recruitment, staff, press, ticketing, sponsorship, and facilities.
Manual means the manager decides; advice produces a recommendation; automatic permits actions within configured budgets, priorities, and exceptions.
The interface identifies the responsible existing role or board/business administration rather than silently introducing extra hired staff slots.
Automatic spending follows per-responsibility caps and the shared club budget; it cannot bypass reserved commitments or invent financing.
An audit log explains automatic actions and their causes. Switching a responsibility back to manual preserves existing legal contracts and project commitments.
Routine press is delegated by default; major disputes, promises, and materially consequential media choices remain meaningful events.

## 12. AI clubs and a living world

Every club has a strategy profile: ambition, patience, financial caution, youth emphasis, recruitment reach, tactical preferences, and risk tolerance.
Profiles create preferences within common rules; they never grant free money, hidden skill access, or immunity from injuries.
Real clubs may use sourced strategic facts; invented owner/coach personalities must be presented as fictional save-world behavior.
AI observes its own scouting knowledge and public facts, not every opponent's hidden potential or future random events.
At season planning, choose targets and roster needs from budget, objectives, contract expiry, role depth, and competition workload.
Daily AI handles deadlines and urgent gaps; weekly AI revisits shortlists, roles, training, and finances; seasonal AI rethinks strategy.
Recruitment utility combines expected marginal role contribution, cost, uncertainty, fit, and resale/development value.
Set minimum thresholds and transaction cooldowns; no signing solely because a slot or cash exists.
No oscillation between buying and immediately selling the same player without a new material event.
Tactics adapt to personnel and opponent information, with a cost for unfamiliar changes; AI cannot read the next simulated possession.
Match coaches use the same legal substitution windows, instruction latency, timeout limits, and fatigue information as the human.
Training, injuries, development, contract obligations, and youth generation apply to every fully simulated club.
All selected domestic divisions run full club and competition simulation, including the second tiers.
Only leagues outside that confirmed scope may use a less-detailed background tier, with a consistent promotion-to-full-simulation process if they later become playable.
Resolution of competing offers is deterministic and policy-based; processing order must not grant the first club free priority.
All clubs use the same transaction validators and calendar services, rather than duplicated human and AI implementations.

## 13. Youth, newgens, and population sustainability

Generate a dated annual intake pool by country/competition, plus any explicitly modeled in-season arrivals.
Assign young players to academies, development programs, or eligible free-agent pools according to the selected league's design.
The managed academy has a prospect roster, youth team coach, training focus, simplified fixture schedule/results, development reports, and senior promotion decisions.
Youth infrastructure has funded quality/capacity and upkeep, integrated with the facilities controls rather than an unexplained annual intake modifier.
Simplified youth fixtures still produce consistent minutes, workload, availability, and development exposure; do not award both a fixture-development bonus and the same exposure twice.
The youth coach recommends readiness and promotion using observable skills, role needs, and uncertainty; the manager retains direct control or may delegate within policy.
Senior promotion validates applicable age, contract, registration, and squad rules. It does not instantly increase ability or force the manager to offer a senior contract blindly.
Youth and senior calendars coordinate shared players' availability and workload; a prospect cannot play two overlapping fixtures.
The discovery process then controls which intake players the manager learns about.
Generation respects plausible age, size, position, and skill correlations without tying ability to appearance or ethnicity.
Countries can differ through modeled participation/development infrastructure supported by data or labeled design estimates.
Potential is a long-tailed distribution; rare exceptional prospects can occur without guaranteeing one to every club or country each year.
Potential, current ability, mentality, health, and opportunity remain distinct, so some great prospects fail to develop.
Generate appearance from a shared identity specification used for portrait and court avatar, supporting the requested visual consistency.
Newgens have fictional names and identities; prevent accidental substitution for an existing real player's ID.
Population policy accounts for retirements, exits, unmodeled lower leagues, positional balance, and competition expansion.
Track age distribution, replacement rate, elite-player prevalence, nationality/position mix, and median skill across at least twenty simulated seasons.
Avoid ratings inflation by calibrating intake distributions and development/decline together, not by arbitrarily nerfing annual cohorts.
Release, retirement, staff conversion, and historical-record retention are explicit lifecycle events.

## 14. Board, president, press, rivalries, and career

President parameters include patience, negotiability, ambition, emotional reactivity, financial capacity, and willingness to invest.
Parameters guide decisions probabilistically and within financial limits; temperament does not bypass agreed club rules.
Board objectives have a weight, deadline, tolerance, and observable measure: results, financial discipline, development, or culture.
Board confidence combines progress against agreed expectations and credible context, including injury burden and inherited obligations.
Avoid punishing the manager for a target that was never communicated or retroactively changed without a recorded conversation.
Funding requests beyond existing authority show rationale, cost, response, and reconsideration conditions; direct control of authorized staffing and facilities spending remains with the manager or selected delegate.
Press interactions use short authored choices and optional tone; outcomes depend on actual commitments and affected people.
Do not make every answer a disguised right/wrong puzzle or require repeated media clicks to remain competitive.
Delegate routine press work and reserve interruptions for material consequences; dialogue content may initially be template-based.
Rivalry metadata contains the clubs, competition context, intensity, and source or fictional-save origin.
Rivalry results amplify specific fan, board, and player reactions, with capped effects and time decay.
Repeated sporting events may evolve a fictional save-world rivalry; clearly distinguish it from historical rivalry facts.
Career mode supports optional dismissal and job changes; still decide resignation, vacancies, reputation, contract expiry, and whether an unemployed career can continue.
If dismissal is disabled, the same poor performance can affect budgets and objectives without unexpectedly ending the save.

## 15. Calendar and season lifecycle

Use one world date, timezone-independent simulation dates, stable competition IDs, and season-specific rule versions.
The scheduling service combines domestic and European fixtures, rest constraints, arena conflicts, international windows if modeled, and postponed games.
Reconcile EuroLeague, EuroCup, and Basketball Champions League participation against all active domestic divisions in the same calendar; the two schedules cannot independently allocate a club's availability.
Define priority and rescheduling policies; an infeasible calendar must surface a validation error rather than silently overlap fixtures.
Daily processing order is explicit: resolve dated obligations and eligibility, pre-session recovery, training/matches, results, reactions, knowledge/AI decisions, then notifications.
Training exposure and match exposure on the same day must be coordinated; no default full training session immediately before every match.
Use a deterministic event queue and a snapshot of relevant state for competing actions before settlement.
A match result posts statistics, competition tables, player exposure, finance entries, and reactions exactly once.
Competition rules govern tie-breakers, postseason qualification, home advantage, series formats, and overtime independently of interface code.
Season rollover completes awards and final distributions, resolves expiring contracts/options, processes intake/retirements, and generates validated future calendars.
Do not wipe historical records, relationships, injury rehabilitation, debt, or outstanding promises at rollover.
Reconcile promotion/relegation between each selected country's two playable divisions, and applicable European qualification/participation rules, before generating the next schedule.
The lower boundary beneath a playable second tier needs a documented intake/relegation policy using background clubs; do not erase relegated clubs or silently prevent their return.

## 16. Interface and validation priorities

Primary screens: Home, Squad/Academy, Tactics/Match, Training, Staff, Scouting/Transfers, Calendar/Competitions, Club/Business/Facilities, Inbox, and Settings.
Use a clean dark theme, recognizable portraits, and one accent color, with readable contrast and keyboard/touch-accessible controls on desktop and tablet.
The home screen prioritizes the next fixture, availability concerns, time-sensitive decisions, and a compact club status.
Inbox items distinguish action required, useful report, and routine information; optional reports never stop time progression by default.
Each intervention explains the affected mechanism and uncertainty without disclosing hidden true ratings.
Maintain a consistent scale legend: player skills 1–20, player overall rating 1–99 shown as half-stars out of five, condition/morale 0–100, staff half-stars out of five.
Acceptance scenarios include an unhappy injured starter, an unregistered signing, simultaneous accepted offers, an expiring scouting report, and a retiring captain.
Business scenarios include sold-out fixtures, overlapping season-ticket inventory, an exclusive sponsor renewal, an arena project reducing capacity, and delegated spending competing with an accepted transfer.
Youth scenarios include a promotion near a registration deadline, a prospect shared between squads, and insufficient academy capacity at annual intake.
Run a complete season for every active club and audit accounting, eligibility, player population, staff limits, and event uniqueness.
Run long-horizon automated worlds to detect bankrupt-everywhere outcomes, unlimited wealth, endlessly unemployed talent, and elite-rating inflation.
All tests should verify observable invariants or statistical behavior, not merely repeat formulas already present in implementation.

## 17. Remaining implementation assumptions

- Verification of the selected completed season, authoritative sources for the ten domestic divisions and three European competitions, and depth of additional background countries.
- Optional editor access and details of confidence display; own-roster exact skills, outsider ranges, and hidden potential/personality reports are confirmed.
- Gross/net salary convention, base currency, contract detail, loans, and financial-failure consequences need documented implementation defaults and verified competition rules.
- The youth coach cap defaults to one unless revised; the role, academy roster, simplified fixtures, youth infrastructure, and senior promotion are confirmed.
- Manager reputation, unemployment continuity, and the detailed behavior of the confirmed optional-dismissal mode.
- Per-responsibility automatic spending caps and noncritical interruption thresholds need initial tuning; direct control with optional delegation, routine press delegation, and critical match pauses are confirmed.
- Sources and usable rights for visual assets; verified identities/rosters, labeled estimates for unknowns, and consistent illustrated fallbacks are confirmed.
