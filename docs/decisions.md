# Decision record

Updated: 5 November 2026. This records the user's answers, not inferred approval of every proposed formula.

## Confirmed in discovery

| ID | Decision | Source |
| --- | --- | --- |
| D01 | Several domestic leagues plus European competitions in first release | Round 1 |
| D02 | Latest completed verifiable season, opening-day world that diverges through simulation | Round 1 |
| D03 | Diagonal 2.5D viewer with stylized recognizable players | Round 1 |
| D04 | Chosen-club career, unlimited seasons, optional dismissal and job changes | Round 1 |
| D05 | Single-player local saves with import/export; no account | Round 1 |
| D06 | Full managerial control within board budgets | Round 1 |
| D07 | Men's basketball: Turkey, Spain, Greece, Germany, Italy, France | Round 2 |
| D08 | EuroLeague, EuroCup, Basketball Champions League | Round 2 |
| D09 | Fully playable top two divisions in all six countries | Round 2 |
| D10 | Exact own-squad skill ratings; outsiders use scouting ranges; personality/potential described | Round 2 |
| D11 | Verified identities/rosters, labeled missing-value estimates, usable photos with illustrated fallbacks | Round 2 |
| D12 | English, desktop/laptop priority, tablet support | Round 2 |

## Confirmed in discovery round three

| ID | Topic | Confirmed answer |
| --- | --- | --- |
| D13 | Youth development | Academy prospect roster, simplified youth fixtures, development, senior promotion; add youth team coach and youth infrastructure |
| D14 | Facilities/business | Direct facility spending, ticket prices, sponsorship and arena projects, with optional automatic management; arena/stadium, training and youth facilities included |
| D15 | Media/conversations | Meaningful events; routine media delegated |
| D16 | Match decisions | Free pause, critical-event auto-pause, changes applied at legal boundaries |
| D17 | Injury settings | Realistic default, reduced-injury option applied equally to clubs |
| D18 | Visual direction | Restrained dark interface, clear tables, portraits, one accent |

## Subsequent clarification

| ID | Topic | Confirmed preference |
| --- | --- | --- |
| D19 | Real data acquisition | User is willing to pay for high-quality player/club data if justified; free is acceptable. Provide concrete instructions at the relevant milestone. No spending limit or purchase authorization has been supplied. See [acquisition plan](data-acquisition.md). |

## Engineering defaults proposed by the design

These can be resolved through implementation evidence without another general permission round. Escalate only material changes to agreed behavior.

- Versioned, deterministic match/world engines; seeded randomness and saved random state.
- One sporting engine for every playback mode; club AI subject to the same constraints.
- React and TypeScript management interface; Vite build; PixiJS court renderer; worker-based simulation; IndexedDB storage.
- Explicit source/schema/calibration/rules versions; immutable starting data packs.
- Keep all agreed competitions in first-release acceptance; use smaller synthetic fixtures during engineering.
- EUR as the comparable reporting currency, annual gross salary view and monthly payroll by default; preserve native currency and source conventions in data. Label simplified tax/exchange assumptions.
- Historical knowledge uses information available by the career start where obtainable. Full-season results may calibrate aggregate behavior but do not reveal future individual events to the manager. Estimated ratings must disclose their evidence window.
- A truthful common start date follows the actual roster snapshot; do not label end-of-season membership as opening-day membership.
- Third divisions and countries outside the six selected ones can use background representations, sufficient for recruitment, scheduling load, and competition entry.
- Manual saves and reloads are available. No forced irreversible mode is needed for the first release.
- One youth team coach slot is proposed; the role was explicitly requested but its maximum was not specified.
- No deployment, remote repository operation, or new external account is needed for this design phase.

## Development release-clause policy

New player agreements may include an optional release amount from EUR 1,000 to EUR 500,000, in EUR 1,000 steps. No clause is added to existing agreements. Within the fictional development league, agreeing a clause caps the three-season salary premium at 5%, rather than 10%; the one- and two-season requirements remain unchanged. The contract review shows the actual salary requirement. This uniform game rule is provisional and is not a statement of any country's employment law or a claim about a player's personal preferences.

A buyer explicitly chooses a clause approach and reserves its exact amount for full payment when the player accepts. A clause removes the selling club's fee decision; player choice, affordability, registration timing and squad protection still apply. Installments belong to negotiated transfers. A clause on one agreement cannot release a separate future agreement. Existing wages, earlier transfer debt and historical registrations retain their original treatment. Competition-specific clauses and the wider agent/bonus/loan model remain future work.

## Development scout staffing policy

Training coaches and scouts share the existing EUR 150,000 annual staff allocation. Scout contracts charge their full season fee immediately, retain the commitment after release and renew only when the new season's allocation and cash permit. The confirmed limit is three active scouts per club, equally applied to AI. Two baseline club observations remain available; each hired scout supplies one additional named observation per matchday. A person cannot observe two targets on the same matchday. Releasing a scout cancels their queued observation explicitly; completed club reports remain.

Scouts have fictional judging and reporting skills on a 1-10 scale. The overall half-star display summarizes those skills and is not another bonus. A successful club observation supplies 100 evidence points; a scout supplies 100 plus five times the sum of their two skills. Report depth is the whole number of accumulated hundreds, capped at three. No minutes supplies no evidence. Existing uncertain ranges, systematic bias and aging still apply, so even the best report does not expose an outsider's exact ratings. This is a provisional development coefficient, not a calibrated scouting accuracy claim.

Scout contracts and frozen observation attribution are retained for the career. New careers enable scout recruitment when finance and scouting are enabled. Older saves opt in prospectively; no report or pending baseline observation receives a retroactive benefit. AI aims for one affordable scout before hiring extra training coaches; existing coach renewals precede scout renewals at rollover. Regional travel, potential and personality reports await their supporting world and player models. The later discovery policy below adds a provisional visible player pool.

## Development fitness coaching policy

Each club may appoint one fitness coach. The role shares the EUR 150,000 annual allocation with training coaches and scouts, charges the full season fee on appointment, and retains paid commitments after release. New hires require remaining cash after wages and transfer holds and settled arrears. Appointments are available on matchdays 1-9; matchday 10 has no remaining weekly training interval. The same rules apply to AI clubs.

On medically available days within a normal training week, the recovery skill adds `skill / 10` condition points per day, capped at one. The workload skill reduces the chosen plan's practice condition cost by `skill * 2.5%`, capped at 25%. Daily condition remains within 35-100. Injured days retain their original recovery, with no fitness bonus, no practice, and unchanged injury return dates. There is no offseason bonus or direct skill-rating multiplier. Improved condition can affect the existing readiness threshold for useful practice. These are provisional development coefficients, not medical claims or calibrated real-world staff effects.

The weekly report stores the applied appointment and compares the actual final condition with the same week, workload and availability without fitness coaching. It reports the actual capped difference, including zero for players who already finish fully rested. Hiring, release and renewal cannot rewrite a completed week. New careers opt in; older saves retain absent report fields and unchanged training until activation.

Rival clubs seek one fitness coach after scout coverage and before extra training coaches. On opening day, existing training coaches renew first, then scouts, then fitness coaches if the shared budget and cash permit. This order is deterministic and gives no club an additional budget.

## Development physiotherapy and rehabilitation policy

Each club may appoint one physio under the same EUR 150,000 annual staff allocation, protected cash and arrears rules as every other staff role. The full season fee is paid on appointment and remains committed after release. Recruitment requires enabled finances and an active matchday from 1 to 9; training may remain disabled. The physio automatically treats medically unavailable players registered to that club during the completed interval. Current registration, rather than the club where the injury originated, determines the treating club.

Original injury identity, diagnosis and return date remain immutable. A separate dated rehabilitation history records the actual appointment, registered squad, eligible treatment days, accumulated credit and effective return dates. Each day strictly between matchdays earns `10 + 2 * rehabilitation rating` integer credits, with 100 credits representing one potential day of earlier recovery. The total credit for an episode is capped at `floor(original duration / 5) * 100`, so no injury can improve by more than 20% of its original duration in whole days. Only unavailable days count. All patients receive the same rule; no medical randomness is added.

Credits settle at the next matchday, before training and new registrations. A revised return can never precede that settlement date or delay a previously earned return. Historical availability always uses the records already effective on the date being evaluated. This can make a player eligible on the final day of a training interval, but never rewrites earlier training, fixtures or the already prepared match. Earned improvements and their staff attribution remain after release, replacement or a transfer; replacement cannot reset the episode cap. No treatment is invented during the offseason.

The Medical workspace distinguishes the original diagnosis, current expected return, actual days saved and calendar recovery progress. Credit that has not produced an earlier return is not advertised as a realized benefit. These are explicit provisional game coefficients and fictional staff identities, not a clinically calibrated rehabilitation model. More detailed diagnosis, return-to-play risk, treatment choices and facilities remain later work.

## Player ability, match ratings and MVP

Overall ability is the arithmetic mean of the seven 1-20 skills divided by four, rounded to half-star steps and bounded to 1-5 stars. It summarizes current ability, not position fit or potential. Own-player knowledge supplies exact stars; outsider reports supply lower/upper star estimates. Rounded bounds are widened by a half-star when they would otherwise collapse into an apparently exact value. Unknown ability remains unknown, even when raw catalog attributes are available to the caller.

The current game PIR is `PTS + REB + AST + STL + BLK - (FGA - FGM) - (FTA - FTM) - TO - PF`. Three-point misses already belong to field-goal misses. The [official EuroLeague statistics criteria manual](https://ftpserver.euroleague.net/general/EB_Statistics_Criteria_Manual.pdf) distinguishes fouls drawn and shots rejected; the current engine retains neither category, so this explicitly labeled game variant omits them. It must not be presented as full official EuroLeague PIR.

Match rating is `clamp(1, 10, 6 + PIR / 10)`, rounded to one decimal. It measures accumulated box-score contribution without extrapolating a short appearance to a full game; it does not grade every off-ball or tactical action. Live ratings are provisional. A player with no recorded exposure has no rating. The highest-PIR participant receives MVP even if every candidate has a negative PIR. Ties resolve by winning club, points, assists, rebounds, fewer turnovers and stable player ID. Unplayed defaults and historical results without player statistics cannot have an invented award.

Ratings and MVPs are derived from existing statistics and historical roster snapshots. They do not alter simulation, save format or random state. The displayed live snapshot controls ratings during animation; the final award waits until playback has completed. Calibration against richer performance evidence remains future work.

## Development scouting discovery policy

A club discovers its own squad plus 20 outside identities, ordered by a fixed club/player identity hash. Each active scout adds `2 + floor((judging + reporting) / 2)` outside identities: 3-12 for current 1-10 staff skills. Additions use a stable prefix and cap at the actual outside population. This means higher-quality or additional scouts widen reach without hiding existing prefix members. Current reports, former-squad memories, shortlist entries and pending observations are always included, even after staff release.

Coverage reveals identity only. The existing observation process still supplies uncertain ability evidence. Discovery filters the browsing pool without adding geography, travel expenses or permission barriers to direct known-player links. Existing AI/delegation policies and command guards stay unchanged; this is a player-facing discovery foundation, not completed regional AI scouting. Age sorting uses current calendar ages; ability sorting uses only known star bounds, with unknown values last in either direction. The interface previews each scout's reach and offers a direct hiring route.

## Development assistant coaching policy

One assistant per club shares the EUR 150,000 annual staff allocation and actual cash with training coaches, scouts, fitness coaches and physios. Appointments pay the entire catalog season fee; releases do not refund cash or restore that season's allocation. Hiring requires settled arrears, protected wage/transfer reserves and remaining match advice this season. Matchday ten is eligible before the final whistle. Staff negotiations, prorated fees and monthly staff payroll remain future work.

An assistant's single Assessment skill is 1-10. Advice reads owned squad skills rounded in steps of `1 + floor((10 - assessment) / 3)`, bounded back to 1-20. Assessment 8-10 uses full integer skill detail; equal precision bands have equal fees. Current condition, fouls, participation and eligibility are never estimated. This is a transparent provisional model of recommendation precision, not additional scouting knowledge or a passive player-stat bonus.

For eligible players in the current five, tactical advice targets `tempo = .5 + (passing - 10) * .02 + (condition - 85) * .008`, `outsideShare = .45 + (threePoint - twoPoint) * .04`, and `pressure = .5 + (defense - 10) * .025 + (staminaSkill - 10) * .01 - (100 - condition) * .006 - averageFouls * .05`. Inputs are lineup means; outputs are bounded to .20-.75 and rounded to the existing five-point slider increments. These are own-squad recommendations, not opponent-specific predictions or guaranteed optimal tactics.

Rotation first addresses injury/exclusion, then condition below 75 with an eligible reserve at least eight points fresher, then four fouls (or three before the fourth quarter) with a reserve on fewer fouls. Candidate comparison then uses assessed position-weighted skills, position distance, condition and foul risk. After five minutes of actual exposure, recorded PIR contributes at most plus/minus two fit points. Optional fit changes require an improvement above 1.5 pre-match or 3 during play. Only one change is suggested at a time; an existing pending substitution stays authoritative. Eligibility and ordinary engine rules determine when a requested change can actually occur.

Managers review and apply recommendations explicitly. Existing generic delegation controls remain usable without an appointment. Advice does not itself advance the match, consume randomness or read hidden opponents' skills. Commands recompute recommendations from current state and annotate the ordinary event with the assistant's name. AI uses the same tactical calculation when preparing future fixtures; human instructions and already prepared matches remain unchanged by hiring. First-time new-career preparation includes initial AI staffing. AI budget/renewal rules are identical, with current staff renewals preceding assistant renewals.

## Academy foundation and population boundary

The fictional academy starts with three prospects per club aged 16-18. Each real seven-day playing-season interval awards 28 practice points across the existing seven skills; a youth coach adds up to 50%. A skill gains one point per 100 practice points, with three academy improvements per skill and a ceiling of 20. Development focus is a direct manager decision, and reports freeze actual contributions rather than projecting unseen potential.

Promotion uses the remaining-season offer and registration pipeline: next-matchday reply, salary and cash reservations, the same twelve-player roster ceiling and a normal senior contract on acceptance. The current prepared match remains unchanged. Graduates retain their academy skill baseline but start ordinary senior practice at zero. Annual intake adds up to two within six academy places, after players aged 21 or older become free agents. These are explicit provisional game rules, not claims about real competition registration regulations.

A separate career-local catalog replaces fixed-population assumptions without mutating the original development pack. Earlier saves opt in prospectively. Subsequent increments add senior aging, retirement and youth fixtures. Hidden potential, facility effects and sustainable long-run population calibration remain separate work.

## Senior aging and retirement foundation

Senior learning scales actual practice rather than granting an annual birthday bonus: 125% at 16 to 100% at 23, flat through 29, then down to 50% at 39. Calendar decline uses separate skill-family rates, internally retaining fractional loss and applying whole-point changes within 1-20. Medical availability, workload, coaching and the original training cap still determine the earned gains. No extra match randomness or hidden condition penalty is added.

Retirement target ages 37-40 use a separate deterministic identity stream. Public notices preserve signed contracts and live proposals and provide at least the current and following season before retirement. New terms must respect the announced final season. A reserve of sixty seniors without notices and a limit of two outstanding future departures per current club protect replacement capacity. Testing rejected an earlier remaining-current-squad rule because it could indefinitely prevent eight-player AI clubs from retiring veterans. The corrected policy permits recruitment to supply replacements while retaining immutable notices. These are provisional game rules, not calibrated predictions of real athletes' careers.

Retired identity remains available for financial and sporting history. Normal recruitment, new observations and discovery exclude retired players, while old reports retain their original evidence. Earlier saves opt in prospectively; the player catalog and already prepared match remain unchanged by activation. The subsequent youth competition increment adds fixtures and records minutes. Match-exposure skill gains, hidden potential, facilities and broader career dynamics remain separate work.

## Youth competition foundation

Youth matches use a separate fictional six-club competition on the actual development-season calendar. Each round settles with Continue, before that interval's practice and next-matchday senior registrations. Enabling it partway through a career schedules only remaining fixtures. The existing possession engine and career injury setting apply equally to all youth clubs, with separate fixture random streams and retained lineups, statistics and diagnoses. Managers continue to control training and promotions; automatic selection and rotation handle the youth matches in this foundation.

Participating academies have eight places. Existing intake identities and rules stay intact; explicit supplemental intake records fill remaining places at activation and each subsequent opening day. Supplemental prospects use a separate deterministic identity namespace and a spread of ages from 16 to 20. There are no automatic arrivals after midseason promotions. Fewer than five available players produces an unplayed default; if neither side can field five, the fixture is a no-contest. No minutes or MVP are invented for unplayed decisions.

Youth condition follows actual playing workload and calendar recovery, with a modest daily practice cost on medically available training days. Injury reduces eligible academy practice rather than awarding missing sessions. Match minutes are development exposure information; this increment adds no extra fixture experience bonus. A currently injured prospect cannot be promoted, and a pending offer is rechecked on the reply date. Successful promotion carries actual recovered condition into the senior registration. Historical youth results retain the original players and skills after subsequent practice, promotion and aging.

The roster size, supplementary population, workload and result policies are provisional development rules. This foundation does not claim real-world youth league eligibility, full youth match coaching, hidden potential, facility effects or calibrated population balance.

## Funded club facilities foundation

Arena, senior training and youth infrastructure use four levels with diminishing practice benefits and one concurrent project per club. The provisional cost schedule is EUR 100k/160k/240k for arena upgrades, 75k/120k/180k for training and 60k/100k/150k for youth. Durations are 21/28/42 calendar days. Payment is upfront from protected available cash; cancellation has no refund. Borrowing, leases and board financing are separate future systems. Base-level upkeep stays within existing operations; completed upgrades add explicit matchday expenses.

Completion is an actual calendar command, dated at the first processed boundary on or after the due date. Merely viewing a future date or reading a quote cannot grant a building. Training effects are 5/8/10% of medically eligible ordinary practice, with senior age/workload/condition applied first; coaches and facilities contribute separately under the same caps. Arena expansion adds a cumulative 500/1,400/2,600 seats. Construction temporarily closes 10% of seats only for future prepared matchdays, preserving current prices, capacity and historical receipts.

Automatic management is optional for the manager, enabled for AI clubs, and may immediately approve the cheapest eligible upgrade while retaining EUR 150,000 beyond existing cash reservations. It shares manual funding/arrears guards and records the same project terms and expenses. One conservative policy is a foundation, not a claim of complete board strategy or a calibrated club economy. Earlier saves opt in prospectively.

## Playing-time relationships and bounded focus

The first squad-dynamics model uses explicit senior roles rather than inventing undocumented personalities. Reserve (0-8), Rotation (12-20) and Starter (24-32) expectations are assessed over up to four eligible committed games, with three required for a concern. A healthy DNP counts zero; injury, disqualification and default results are exempt. All defaults are excluded in this foundation because even a played default may end before normal opportunities were available. Future competition-specific models can refine that policy.

Agreements apply after the current matchday. Conversations and role changes share a four-completed-matchday cooldown, and an active promise cannot be erased by another role decision. New commitments cannot increase an overcommitted 200-minute plan. New signings may reveal an existing overcommitment, which is displayed honestly and resolved by an explicit reduction rather than a silent downgrade. Increasing the role of a dissatisfied player cannot erase their current concern.

Promises commit to the current role minimum over three future eligible games within six club fixtures. Success adds a capped +10 contribution; failure -15; insufficient eligible games or a departure closes the promise without penalty. Explanations add +2 with a 21-day half-life, reduced-role agreements -4 with a 42-day half-life, and resolved promises use a 42-day half-life. Conversation effects cap at -8/+8 and promise effects at -20/+10. Trust is baseline 50 plus these contributions; morale also includes bounded actual role satisfaction and recent results. The last four team results contribute +/-2 each with a 21-day half-life and a combined cap of +/-6, after three recorded games. These are transparent provisional game rules, not calibrated psychological claims.

Morale affects future decision consistency only: the existing possession error chance gains `(50 - morale) / 10000`, bounded to half a percentage point in either direction and the existing action range. It never multiplies every skill or draws extra randomness. A unique round preparation freezes all clubs before any matches, so a later conversation cannot benefit or penalize an already prepared fixture. Contract bargaining, teammate chemistry, personalities and broader relationship consequences remain separate future work.

## Board expectations and confidence foundation

Board objectives are communicated before their evidence window: a frozen wins target from the registered squad and no increase over starting unpaid costs, including overdue transfer fees. The upper, middle and lower thirds of squad assessment target 60%, 50% and 40% wins, rounded up over eligible fixtures. The strongest eight registered players determine the comparison; later arrivals and skill changes do not rewrite it. Exact squad-strength ties share the best rank and target; tied expectations may be collectively aspirational. The initial pack has distinct ranks and targets of 6/6/5/5/4/4 wins. Existing-career opt-in excludes today's match; no retrospective target is imposed.

Each committed eligible matchday produces one dated review for all clubs. After three eligible games, wins above or below target pace beyond a half-win tolerance contribute ten points per win, capped at +/-30. Carried medical absences may offset up to six negative sporting points. Financial improvement or deterioration contributes five points per EUR 10,000, capped at +10/-25, relative to the mandate's inherited unpaid amount. Disabled finance is unassessed. Confidence moves at most eight points toward `50 + components` per review and retains its previous value across the season boundary. Short assessment windows still show objective outcomes but do not bypass the three-game sporting grace.

These coefficients are provisional and visible in review evidence. This increment records board assessment without spending money, adding a match bonus, changing recruitment authority or dismissing the manager. Funding requests and president traits followed in Level 7 (see [Board funding policy](#board-funding-policy)); development/culture objectives, employment consequences and press require subsequent work.

## Sponsorship negotiation policy

Approved by the project owner on 12 November 2026 as provisional development rules. Each club has one exclusive main-sponsor slot. On activation (new careers, or **Enable negotiations** in Club for older saves during an active season), each club's existing sponsor becomes an inherited agreement for the current season, already funded by the fixed EUR 200,000 payment; nothing changes for that season.

On matchday six of a club's final contracted season, three fictional sponsors make offers for the following one to three seasons: the incumbent's two-season renewal first, then available sponsors in a seeded order. A club's current sponsor negotiates only with that club until its agreement ends, and a sponsor makes offers to one club at a time, so club processing order grants no advantage. Offer value is the former EUR 200,000 multiplied by a club appeal bounded to 75%-125%: venue demand relative to the league average, `0.8 + 0.4 x win share` this season and `1 + 0.2 x (home fill - 0.8)`; each factor is neutral for an average club. Sponsors then vary by +/-5%, each extra season lowers the annual fee by 3% in exchange for security, and about half add a top-half bonus of 10%. Fees round to EUR 1,000.

The manager may ask each sponsor once for 10% more. A deterministic, hidden flexibility of 0-12% decides at once: at least 10% accepts; otherwise the sponsor counters with its flexibility, or rarely withdraws (flexibility below 3% and appeal below 0.9). Accepting signs immediately for future seasons and closes the club's other offers; declining closes one offer. Clubs still without a next-season sponsor after the final matchday receive a second round. Open offers expire when the season they would start begins; an unsold slot earns nothing that season. Automatic control and every AI club sign the largest guaranteed total (annual fee x seasons), then the larger fee and bonus.

Agreements pay half the annual fee on the opening matchday and the rest on matchday six, as dated ledger income booked only when due; bonuses follow the final matchday only after a top-half finish. There is no early termination in this foundation. Six-season diagnostics with every club automatic (seeds 227 and 71) kept the league's mean agreement fee at EUR 190,000-203,000, ranged EUR 154,000-277,000 per club-season, and left no unsold slots or unpaid costs. These coefficients are game rules, not claims about real sponsorship markets or companies.

## Board funding policy

Approved by the project owner on 12 November 2026 as provisional development rules. Each club has a fictional president with a generosity trait from 1 (reluctant) to 5 (generous) and owner capital for facility projects each season (EUR 120,000-250,000). Board capital pays only for facility upgrades; the staff and player salary allocations keep their existing rules.

A club may ask when money is the only obstacle to an upgrade: facilities, finances and board reviews are enabled, no other project is running, no costs or transfer installments are overdue, and committed wages and fees do not already exceed cash. The manager asks for the upgrade cost minus the cash the club can spend; automatic control and rival clubs also ask for their EUR 150,000 cash cushion. The board approves when its latest reviewed confidence is at least `65 - 5 x generosity` (60 to 40) and the amount fits the owner's remaining capital for the season; otherwise it refuses and states which condition failed. After a refusal, the club waits two matchdays before asking again. An approval books the capital and starts the upgrade at once, paying its full cost, so board capital never becomes general spending money. Automatic control and every rival club ask only when the rules approve, choosing the cheapest such upgrade. The facility review shows the amount, the confidence needed and the expected answer before the manager asks.

New careers enable requests; older saves opt in from Club > Board. A seed-227 exploration over about two seasons saw eight automatic approvals among rival clubs (EUR 132,000-337,000 per club in total), bounded by owner capital and the three available upgrades per facility. These coefficients are game rules, not claims about real club owners.

## Board verdict policy

Provisional development rules for Level 7 step 7.3, chosen as the recommended default under the owner's delegation on 12 November 2026 ("board consequences when dismissal is off"); dismissal itself follows in step 7.5. The final review of each season (after matchday ten) gives every club a verdict from its board confidence, reusing the labels shown throughout the game: Confident (65 and above), Steady (45-64), Concerned (30-44) and Under pressure (below 30).

While season verdicts are switched on, the previous season's verdict sets two budgets for the following season: the shared staff allocation for coaches, scouts, fitness coaches, physios, assistants and youth coaches (110%, 100%, 90% or 80% of EUR 150,000) and the president's owner capital for facility upgrades (150%, 100%, 50% or none). Rewards come mainly as investment and penalties as tighter budgets, so no club gains spending cash. Signed staff contracts are never cut; staff renewals on the new season's opening day must fit the new allocation, in the usual renewal order. The coaching-only limit stays EUR 150,000. A club without a final review that season keeps standard budgets. Rival clubs follow the same rules.

New careers start with season verdicts on; older saves switch them on from Club > Board, and they then govern the following season. The player salary budget is deliberately unchanged: next season's contracts are signed during the current season, so changing that budget part-way would be confusing and hard to validate. A three-season automatic exploration (seed 227) produced all four verdicts and kept every club within its allocation. These coefficients are game rules to be calibrated, not claims about real club boards.

## Press and Inbox policy

Provisional development rules for Level 7 step 7.4, chosen as the recommended default under the owner's delegation on 12 November 2026, following the design rules that press interrupts only for material events, uses short authored choices whose effects depend on the people addressed, never hides a right answer and can be left to the assistant. A press question appears when the managed club's latest matchday completes a run of exactly three wins or three defeats. It names the five players with the most minutes in those games ("regulars") and stays open until the next result or the end of the season.

After defeats the manager can back the squad (+3 morale for everyone), demand more from the regulars (-3 for them, +2 for the rest) or keep it routine (no change); after wins, credit the whole squad (+2), praise the regulars (+3 for them, -1 for the rest) or keep it routine. Effects are morale contributions that halve every 21 days and are capped at +/-6 per player; they apply from the next prepared match and never change the current one. An unanswered question is treated as the assistant's routine answer. Rival clubs have no press. Two-season explorations produced one or two questions per club-season.

The Inbox lists dated messages built only from recorded events and links each to the screen where the manager can act. Contract-future requests from players with expiring deals were deferred: judging whether a renewal offer was made in time needs offer records that the relationship replay does not yet reconstruct at past boundaries.

## Rivalry policy

Provisional development rules for Level 7 step 7.6, chosen as the recommended default under the owner's delegation on 12 November 2026, following the design rule that rivalries amplify fan, board and player reactions within capped, decaying limits and that fictional rivalries are clearly distinguished from historical facts. Every development-league club has one fictional rival: the River derby (Rhine Falcons and Danube Lynx, intensity 3), the Sea derby (Aegean Waves and Adriatic Comets, 2) and the Summit rivalry (Alpine Stags and Atlantic Pilots, 1).

Derby crowd demand rises by 5% per point of intensity, still limited by capacity and price. Each derby win in the board's counted games adds 3 assessment points and each loss removes 3, capped at +/-6. A derby result counts double in the recent-results part of player morale, which keeps its existing cap and decay. Effects apply only from the matchday rivalries take effect: a new career's opening matchday, otherwise the matchday after activation, so earlier gates, reviews and morale never change. Intensity does not yet evolve with results; that remains a later refinement.

## Facility upkeep policy

Provisional development rules for Level 7 step 7.7, chosen as the recommended default under the owner's delegation on 12 November 2026, following the design rule that deterioration creates an upkeep decision rather than weekly maintenance clicks. Each upgraded facility has a condition from 0 to 100, set to 100 when an upgrade completes. A club chooses one upkeep plan: full upkeep costs the existing upkeep and recovers 10 condition per senior matchday (to at most 100); reduced upkeep costs 50% and loses 5 per matchday. A change applies from the next matchday.

Condition scales the facility's benefit: the training and youth practice bonus and the extra arena seats are multiplied by condition / 100 (rounded to whole percent and whole seats). Standard (level-one) facilities have no condition. Automatic facilities control and rival clubs reduce upkeep only while committed wages and fees exceed cash or costs are unpaid, and restore it once EUR 75,000 is spendable; an earlier rule tied to the EUR 150,000 automation cushion cut upkeep at every season opening, when a full season of wages is reserved, and was rejected.

## Career move policy

Provisional rules for Level 7 step 7.5, chosen as the recommended default under the owner's delegation and approved by the owner on 12 November 2026 ("go ahead with 7.5"). Boards decide only at the end of a season, never mid-season: with dismissal and job changes enabled, a season verdict of Under pressure (final confidence below 30) dismisses the manager. At the same moment, clubs replacing their own coach can offer the job according to the manager's reputation; a dismissed manager always receives at least one offer. The manager decides before the offseason: take an offer and run that club at once, including its offseason recruitment, or (if not dismissed) stay. An unemployed career that sits out seasons is not part of this step, because the design documents disagree on it; it is listed as a suggestion. New careers start with the setting on; older careers opt in, effective from the next season.

Groundwork (part a): a club change happens only at the end of a season, after its final board review and before its offseason opens, so the new club runs that offseason and later seasons while the former club's final match stays the manager's last match there. The former club continues under automatic control in every area (match substitutions, ticket prices, payroll, scouting, sponsorship, facilities and training; its current academy prospects return to balanced work). The new club starts like a new career: the manager controls ticket prices, payroll, scouting, sponsorship and facilities, training stays delegated as for every club, and the manager's own recruitment delegation and substitution preference carry over. Contracts, staff, players, results and history are unchanged. Dismissal, reputation and offers follow in the next parts; until then no screen offers a move.

Dismissal and offers (part b): the final review's verdict for the club managed that season decides, and Under pressure (below 30) dismisses. Clubs whose own season ended Under pressure replace their coach; if the manager is dismissed and no other club did, the club whose board has the least confidence makes a change. Reputation is the weighted mean of the manager's final board confidence in the last three seasons (weights 3, 2 and 1, most recent first; 45 before any final review). A club needs a reputation of 25 if it finished last, plus 6 for each place higher (55 for the champion of six clubs), and offers its job when the manager's reputation meets that. A dismissed manager always receives at least one offer: below every requirement, the job asking the least. Until the choice screen exists, a dismissed manager who makes no choice joins the best offer (the highest requirement); a manager who was not dismissed stays. Exploration with an all-automatic Rhine Falcons manager: over seeds 1-12, 10 of 72 first seasons ended Under pressure across the six clubs, the manager was dismissed in 3 and always had an offer, and 5 of the 9 managers who kept their job were offered another; three-season careers on seeds 1-6 and 11 saw 4 dismissals in 21 seasons, every career continued and every save validated. Format 38 records these decisions; careers saved in format 37, before dismissal existed, are judged only from their next season end.

Screens (part c): when the manager continues after the final match of a governed season, the board's verdict and any offers appear before the matchday is recorded. A dismissed manager chooses among the offers; a manager who kept the job may join an offering club or stay; Decide later records nothing, so the same choice reappears. Club > Board shows the manager's reputation, today's outlook (job safe or at risk) and the clubs managed so far; older careers switch the setting on there, effective from the end of the next season. The manager's desk warns once a reviewed confidence falls below 30 in a governed season, and the Inbox records club changes and declined offers. A new coach takes over the board's current confidence, which moves at most 8 points per review towards the assessment, so it recovers within a few matchdays of average results. Suggestions outside this step: careers that sit out unemployed seasons, a protected first season at a new club, a fresh confidence start for a new coach, and mid-season dismissals.

## Evidence still required

1. Which season pack can meet field-level roster and rules coverage across all fifteen competitions?
2. What are the actual formats, registration constraints, qualification rules, and calendars for that pack?
3. Which portrait/data bundles have a documented basis for the intended distribution?
4. Which parameters can be fitted to reliable statistics, and which remain transparent game assumptions?
5. What performance targets are sustainable with the full player and fixture population on a representative laptop/tablet?

These are research and validation tasks. They should not be turned into questions asking the user to supply facts that can be investigated.
