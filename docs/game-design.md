# European Basketball Manager: game design

Version: 0.1, design baseline incorporating eighteen discovery answers, 5 November 2026.

This document turns the user's brief and discovery answers into a buildable game specification. Confirmed requirements are commitments; proposed mechanics and numerical coefficients remain subject to validation. It describes the target game; actual implemented behavior is recorded in [implementation status](implementation-status.md). This is a substantial multi-stage game project.

## 1. Product and design principles

A single-player basketball management game for the browser. The player runs recruitment, contracts, staff, training, tactics, and match coaching within the club board's budget. A believable European basketball world continues around them for an unlimited sequence of seasons.

The interface should make the next meaningful decision obvious. Complexity belongs in the simulation and optional explanations, not in a large number of mandatory sliders or repetitive conversations.

Core principles:

1. Every visible outcome has a consistent sporting or management cause, including uncertainty.
2. Watched, accelerated, quarter-skipped, and instant matches use the same sporting engine.
3. AI clubs use the same registration, budget, knowledge, contract, and match constraints as the human club.
4. Skills, physical readiness, morale, form, and team coordination describe different things and must not multiply the same advantage repeatedly.
5. Real identities and observed facts are distinguishable from estimated ratings and authored simulation traits.
6. A save preserves its world, rules, data, random state, and history across reloads and supported upgrades.
7. The full first-release scope below remains intact even when development milestones use smaller test datasets.

## 2. Confirmed scope

| Area | Confirmed decision |
| --- | --- |
| Basketball | Men's club basketball |
| Countries | Turkey, Spain, Greece, Germany, Italy, France |
| Domestic scope | Top two divisions in each country, all fully playable: twelve domestic divisions |
| European scope | EuroLeague, EuroCup, Basketball Champions League |
| Starting data | Latest completed season for which an opening-day database can be verified; a new simulated timeline begins from that point |
| Season candidate | 2025-26 is the candidate based on the current date, not yet a verified complete dataset |
| Career | Choose a club; continue over many seasons; optional dismissal and job changes |
| Authority | Full recruitment, contract, staff, and tactical control within board budgets |
| Match presentation | Diagonal 2.5D court, stylized players with recognizable appearance traits |
| Match modes | Watch, change speed, intervene, finish current quarter, or simulate the match |
| Saves | Single-player, local saves, save-file import/export, no account |
| Knowledge | Exact skill ratings for own squad; scouting ranges for outsiders; potential and personalities expressed through reports |
| Missing data | Labeled estimates accepted; permitted real photos with consistent illustrated fallbacks |
| Interface | English; primarily desktop/laptop, with tablet support; restrained dark theme, portraits, clear tables, one accent color |
| Academy | Prospect roster, simplified youth fixtures, development and senior promotion; dedicated youth coach |
| Facilities/business | Arena/stadium, training facilities, youth infrastructure; direct management of projects, ticket prices and sponsorship, with optional delegation |
| Conversations | Meaningful decisions; routine media can be delegated |
| Match pauses | Free pause; automatic stops for critical injuries or ineligible players; commands take effect at legal boundaries |
| Injuries | Realistic default with reduced-injury settings applied equally to every club |
| Delivery | Code in this repository; user handles GitHub and Vercel deployment |

National team management, online multiplayer, full 3D, and playable third divisions are outside this agreed first-release scope. Clubs from other countries still need enough representation to participate credibly in the included European competitions and transfer market.

## 3. Specification map

| Document | Responsibility |
| --- | --- |
| [Club and world](design/club-and-world.md) | Attributes, morale, chemistry, training, injuries, staff, scouting, contracts, finances, AI, youth, board, calendar |
| [Match simulation](design/match-simulation.md) | Rules, deterministic action engine, tactics, interventions, events, diagonal viewer, calibration |
| [Data and sources](design/data-and-sources.md) | Official sources, historical snapshots, estimates, imports, portraits, provenance, gaps |
| [Data acquisition](data-acquisition.md) | Free/paid supplier evaluation, coverage gates and user-assisted trial/sample requests |
| [Architecture](architecture.md) | Browser application boundaries, worker protocol, persistence, versioning, performance |
| [Implementation plan](implementation-plan.md) | Build order, deliverables, tests, and release acceptance |
| [Decisions](decisions.md) | User decisions, remaining product questions, implementation defaults |

If a draft subsection contradicts a confirmed decision, the confirmed decision governs and the subsection must be corrected before implementation. Numerical examples are proposed tuning values, not calibrated claims.

## 4. Start a career

The main menu provides New career, Continue, Load saves, Import and exhibition access. The new-career flow selects a verified season pack, club, manager name, date of birth, nationality, and career options. Age follows the simulated date. The current development implementation offers its fictional pack only; real pack and league choices require verified integration. It shows the club's expected finish, finances, squad needs, facilities, rivalries, and board temperament in a concise preview.

Default proposal: begin during preseason, at a documented common world date early enough for all selected competitions. An opening-day roster snapshot cannot be silently moved six weeks earlier: either reconstruct membership for the chosen start date or begin at the snapshot date. The exact start date follows the data audit.

The player inherits active contracts, injuries only where supported and appropriate, registered rosters, loans, and commitments from the chosen snapshot. Missing details receive explicit simulation estimates. Later real-world events do not occur automatically.

Career setup explains that some ratings and finances are estimates. This is database information, not a repeated warning during play. A details view exposes source coverage and the chosen pack version.

Difficulty should alter assistance, information presentation, and board tolerance before introducing hidden sporting bonuses. AI teams must not receive stronger shot probabilities because the player selects a harder setting.

## 5. Main play loop

### Each day or decision window

1. Review the next fixture and a short list of actionable messages.
2. Resolve important recruitment, staffing, player, or board decisions.
3. Set or delegate the weekly training plan; staff adjust for the calendar.
4. Review squad availability, load, roles, and scouting reports.
5. Continue to the next meaningful event; scheduled world work advances deterministically.

The Continue button stops for fixtures, required registration decisions, contract deadlines requiring a response, and urgent availability problems. Routine completed scouting or commercial updates need not stop time unless the player requests it.

### Matchday

1. Review opponent report, readiness, and relevant warnings.
2. Select an eligible match squad, starting lineup, rotation, and simple tactical intent.
3. Watch or simulate. During play, pause to think, issue tactics, queue substitutions, or request a legal timeout.
4. Review a compact result explanation: shot quality, turnovers, rebounds, foul trouble, and important tactical effects.
5. Update recovery, promises, relationships, table positions, cash events, and relevant media.

### Season cycle

Preseason preparation; registration; domestic and European phases; playoff or knockout progression where applicable; promotion/relegation and qualification; awards and board review; expiring contracts; youth intake; retirement and aging; next-season scheduling. Competition-specific dates and formats come from versioned configurations.

## 6. Player model and information design

Physical descriptors use centimetres and kilograms. Persistent basketball skills and mental/physical attributes use a displayed 1-20 scale. Internal fractional precision permits gradual development. Condition and morale use 0-100 measures; health, fatigue, workload, and form remain separate state.

Retain the user's attributes: adaptability, aggression, ambition, loyalty, leadership; stamina, strength, speed, jumping; two-point shooting, three-point shooting, free throws, passing, dribbling, defending. Add only attributes with an identifiable role: finishing, positioning, rebounding, decisions, composure, work ethic, and defensive specialties as detailed in the player schema.

Avoid presenting both a derived summary and its components as independent abilities. For example, an overall defending display may summarize perimeter/interior defense; the engine must not add all three as separate bonuses. Define the full canonical schema once before implementation.

Skill is not attempt tendency. Personality is not sporting quality. Potential is not a promised final rating. A scout can describe a prospect as promising while acknowledging limited evidence and development uncertainty.

The player page prioritizes identity, portrait, position/role, readiness, contract, key abilities, form trend, and concerns. Tabs reveal all attributes, statistics, development, reports, relationships, and history.

## 7. Squad, staff, and development

The squad screen supports lineup selection, depth charts, role promises, player availability, transfer listing, loan proposals where legal, and contract actions. Show competition registration status separately from contract ownership and general squad membership.

| Staff role | Maximum | Main contribution |
| --- | --- | --- |
| Assistant coach | 1 | Advice, delegated rotations/tactics, player assessment |
| Coach | 3 | Training quality and specialist development |
| Fitness coach | 1 | Conditioning and load planning |
| Physio | 1 | Assessment, rehabilitation, recovery support |
| Scout | 3 | Coverage, knowledge, evaluation uncertainty |
| Youth team coach | 1 proposed | Academy training and youth development; role confirmed, proposed capacity of one |

Staff quality is internally 1-10, shown on a five-star scale in half-star increments. A rating of 7 is 3.5 stars. Different role skills may underlie the summary; a star rating does not override task capacity, wages, or availability.

Training offers simple weekly presets, intensity, an individual focus, and delegation. It accounts for fixtures, travel, age, readiness, staff capacity, facilities, and rehabilitation. A fatigued player should not gain more by repeatedly selecting the heaviest plan.

The academy has its own prospect roster and simplified fixtures. Youth infrastructure and a dedicated youth coach affect development quality and capacity within limits. An annual intake adds new prospects, including rare high-upside players; promotion to the senior team is a separate manager decision.

Development must create tradeoffs: minutes can help learning but increase load; specialist work costs time otherwise available to broader development; a loan can provide minutes but reduce direct control and training quality.

## 8. Transfers, scouting, and money

The first release includes a working multi-club market, not a static player shop. Offers can compete, expire, be rejected, or depend on registration and budget conditions. Club and player consent are separate. Free agents and contract renewals remain essential when transfer fees are uncommon or poorly documented.

Proposed supported negotiations: contract duration, gross annual salary, role expectation, signing/agent fees where modeled, bonuses, release/buyout clauses, transfer fee and payment schedule, loans and wage shares where permitted. Terms need jurisdiction/competition configuration rather than a universal football transfer model.

The finance page distinguishes cash, recurring commitments, transfer installments, outstanding offers, and board-authorized spending. The displayed available budget reserves pending commitments so simultaneous offers cannot spend the same funds twice.

Example: a club with EUR 1 million cash and EUR 900,000 in near-term committed payments cannot treat all EUR 1 million as recruitment capacity. A successful player sale changes cash and obligations on the agreed dates; accepting an offer does not erase unpaid wages or fees.

Scouting assignments cover countries or regions, competitions, player profiles, and individual targets. Knowledge accumulates with staff ability, language/region familiarity, travel, time, and observation; it decays or becomes stale. Visibility and confidence are different: knowing a player's name does not mean knowing their skills accurately.

Financial estimates should produce coherent club tiers and sustainable long-term behavior. They must not be represented as the real clubs' audited finances.

Facilities include the arena/stadium, training facilities and youth infrastructure. The manager can control authorized facility spending, ticket prices, sponsorship negotiations and arena projects directly, or delegate each responsibility. Board budgets and project approvals still constrain major commitments. Capital cost, upkeep, time, disruption, attendance demand and sponsor obligations prevent upgrades or commercial deals from becoming free-money actions.

## 9. AI world and competitions

Each club has a roster plan, tactical preference, finances, scouting network, board objectives, and risk tolerance. AI recruitment weighs fit, price, availability, uncertainty, age, playing time, registration, and strategic needs. It can fail and change course without receiving hidden rescue money.

Simulate all twelve playable divisions with their actual selected-season membership and format, subject to verified rules. The three European competitions use the same club/player identities and shared availability records as domestic competitions.

Every continental participant outside the six playable countries needs a coherent roster, contracts, budget, calendar load, and club policy. Its home competition can use background simulation. Specify that approximation visibly in database/world information; avoid presenting invented detailed tables as verified competitions.

Promotion and relegation at the boundary below the twelve playable divisions need background clubs and rules. Playoff qualification, licensing, eligibility, reserved places, and continental participation must be configuration-driven; a simple universal league-position rule would be inaccurate.

Scheduling includes shared arenas, travel/rest assumptions, playoff uncertainty, season overlaps, and player availability. World time advances once; the same player cannot be independently healthy in a domestic match and injured in a European match on the same date.

## 10. Relationships and consequences

Presidents differ in patience, ambition, financial generosity, negotiation style, and interference. Those are game traits; undocumented traits of real people are not factual claims. The board evaluates resources, objectives, injuries, trajectory, finances, promises, and results with bounded patience.

Players react to meaningful causes: agreed role, actual minutes, contract treatment, fitness decisions, team results, relationships, and communication. Repeating a positive conversation cannot farm unlimited morale. Promises have explicit conditions, deadlines, and a history visible to the manager.

Rivalries amplify supporter and board response within limits. One derby should matter without erasing a season of context. Confidence and chemistry effects should be explainable through their component trends.

The optional dismissal setting preserves the career world. If dismissal is enabled, job opportunities follow reputation and vacancies; advancing while unemployed delegates former-club decisions and keeps all competitions running.

## 11. Interface structure

The interface is a basketball management game workspace. The user explicitly confirmed on 6 November 2026 that the overview and all future screens must serve gameplay decisions. Use compact navigation, clear state, readable tables, and working actions. Landing-page heroes, promotional slogans, oversized decorative artwork, roadmap banners, and future-feature advertising do not belong in gameplay screens.

Use charcoal/slate surfaces with one amber accent, flat borders and small section bars. The command header and club rail stay compact. Group related information into management workspaces and retain readable player names and values while reducing decorative spacing. Team instructions use labeled sliders with visible values and keyboard support on the overview and match screen; both edit the same managed-club settings. Rotation control has two positions, Manual and Assistant. Disable match instructions after the final result.

Prioritize portraits, meaningful icons, stamina/skill bars and direct actions over explanatory paragraphs. Reveal detailed records, accounting and help on demand while keeping urgent decisions visible. Nationality entry offers suggestions and accepts typed values. An optional Replay code repeats randomness with the same options and decisions; leaving it blank creates a fresh career and does not choose difficulty.

Keep the club's budgets together at the top of career workspaces. The current model distinguishes cash after remaining wages, this season's available staff funds and next season's annual player wage room. The user explicitly retained these separate financial rules; display them clearly without combining them into one spending pool. Expanded details reconcile the same authoritative limits used by hiring and contract commands.

Scouting provides age and position filters and an explicit discover → shortlist → observe → report → contract-review flow. Saving a target does not automatically assign an observation. Match substitutions work by dragging a reserve onto an active player or selecting both through touch, mouse or keyboard. The interface pauses and settles playback before submitting the existing command; legal stoppages, exclusions and pending-change cancellation remain authoritative.

The following navigation describes the complete target game. During development, expose implemented destinations and omit unavailable systems from normal navigation. A concise factual exhibition/prototype label can explain the current scope; the detailed roadmap belongs in repository documentation.

| Navigation item | Primary task |
| --- | --- |
| Home | Next fixture, urgent decisions, calendar, club pulse |
| Inbox | Decisions and reports with deadlines and relevant actions |
| Squad | Availability, roles, selection, depth, contracts |
| Tactics | Starting five, rotation, simple team instructions, optional matchups |
| Training | Weekly plan, individual focus, load and recovery |
| Staff | Hiring, roles, quality, capacity, responsibilities |
| Scouting | Assignments, coverage, reports, shortlist |
| Transfers | Offers, negotiations, listings, loans, renewals |
| Competitions | Tables, fixtures, results, brackets, statistics |
| Club | Board, finances, facilities, supporters, history |
| Settings | Career options, assistance, display, audio, save/import/export |

Persistent top bar: club identity, game date, next event, Continue, search, and save status as those systems become available. Show the actual simulated date, never the computer's date as a substitute, and expose Continue only when world progression exists. Sidebar collapses for tablets.

Home is the manager's desk: current fixture or result, availability and current lineup, concerns requiring attention, tactical instructions, and relevant recorded activity. Prioritize the next decision and provide a direct route to it. Keep summaries compact and use tables where they make comparison easier. Do not fabricate fixture dates, budgets, messages, standings, board reactions, or club activity to populate a dashboard. Empty states identify a real available action or simply state that nothing requires attention.

Match screen: scoreboard/clock followed immediately by a large diagonal court across the available content width; playback controls and compact lineup with condition/fouls; secondary coaching controls and settings below the viewing area; event feed and bench/substitution drawer. Do not restore the standalone shot-clock/possession information panel removed at the user's request. Critical availability is visible without opening the full player profile. Current stamina is shown with bars, percentages and fatigue labels for active players and reserves; it is distinct from the permanent stamina attribute. The same player portrait/appearance definition appears in squad, reports, and court rendering.

Every displayed estimate, rating range, star, and warning has a short explanation. Empty states state the next useful action. Sorting/filtering long tables should preserve selection and scroll. Use keyboard navigation, readable contrast, non-color status labels, and reduced-motion support.

Interface acceptance applies to every screen: its information is drawn from authoritative game state; visible actions lead to implemented behavior; player identity, displayed lineup, condition, scores and eligibility remain coherent after substitution, pause/resume, save/load and navigation. Presentation cannot change sporting outcomes. Desktop and tablet layouts must retain readable information density and usable controls.

## 12. Realism and acceptance

Realism is a validation program, not a label earned by adding more attributes. The simulation must reproduce plausible distributions of pace, efficiency, shooting, fouls, turnovers, minutes, injuries, development, and economic outcomes for the selected competition tiers.

Compare results by team strength, role, age, league, and season, not only global averages. Measure variance and confidence intervals. Tactics must have tradeoffs. No universal instruction combination should dominate every opponent and roster.

Required end-to-end release stories:

1. Start a career at any eligible club in any of the twelve divisions and complete a season.
2. Coach the same seeded match in watched, skipped, and instant modes with identical commands and obtain identical sporting results.
3. Sign, register, develop, injure, rehabilitate, loan or sell a player with coherent effects in all screens and competitions.
4. Scout an initially obscure prospect, receive uncertain reports, and improve knowledge through observation.
5. Complete a season rollover with promotion/relegation, European entry decisions, contract expiry, youth intake, and sustainable AI rosters.
6. Export and restore a multi-season or mid-match save without changing its world, obligations, pending commands, or random state.
7. Explain a board decision, morale change, training outcome, or transfer rejection through stored reasons.
8. Match photos/fallback portraits to recognizable court appearance while keeping appearance independent of ability.

## 13. Research and implementation decisions

The eighteen product discovery questions are resolved. Historical rating knowledge, exact start-date reconstruction and source coverage require evidence from the data audit; the current recommendation is documented in [decisions](decisions.md). One youth coach is a proposed capacity because the user requested the role without specifying a maximum.

The implementation plan starts with the shared simulation foundation while the historical database is investigated. Do not describe partial development milestones as the completed first release.
