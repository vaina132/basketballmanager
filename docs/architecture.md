# Technical architecture

Design baseline: 5 November 2026. Implementation notes updated: 9 November 2026. The opening sections describe the target; the implementation sections distinguish working behavior from remaining systems.

## 1. Runtime choice

Use TypeScript for a browser-independent domain/simulation core and a React management interface. Vite produces static assets compatible with the user's intended hosting. The application initially needs neither accounts nor a game server. Pin compatible package versions and a lockfile at setup rather than treating a documentation example as a permanent latest version.

[Vite's guide](https://vite.dev/guide/) documents its development server and static production build. [React's installation guidance](https://react.dev/learn/creating-a-react-app) discusses both framework and build-tool approaches. The client-only choice here is a project decision based on the confirmed local single-player scope.

Use a renderer adapter for the diagonal court. The first fixture can use SVG or Canvas 2D for a minimal view; the target animated presentation can use [PixiJS](https://pixijs.com/8.x/guides/getting-started/intro), a 2D scene renderer supporting WebGL and WebGPU. Rendering never determines scores or consumes gameplay random numbers. Keep a readable scoreboard and event feed when graphics are unavailable.

## 2. Ownership boundaries

```text
Management interface / court renderer
                 |
          validated commands
                 v
       application coordinator
          |              |
          v              v
 simulation worker   persistence adapter
          |              |
   world + match core    IndexedDB / save files
          |
 versioned data and competition configuration
```

Suggested folders:

```text
src/domain/       identifiers, player/team/contract/rules schemas
src/engine/       pure RNG, match reducer, world progression, policies
src/data/         fictional fixtures and pack validation
src/application/ commands, worker protocol, save orchestration
src/storage/     IndexedDB, migrations, import/export validation
src/ui/          management screens and shared components
src/viewer/      projection, court rendering, event animation
src/workers/     simulation execution adapter
tests/           behavioral scenarios, invariants, statistical harness
docs/            design, decisions, implementation status
```

An initial increment may colocate small modules, but dependencies point inward: engine code must not import React, browser storage, or animation APIs.

## 3. Authoritative state

Entities use stable IDs. Store identities once and reference them across domestic, European, youth, scouting, and finance contexts. A player transfer changes membership and contracts; it does not create a new player.

Core entities: World, Season, Competition, CompetitionEntry, Ruleset, Club, Team, Player, StaffMember, Contract, Registration, Fixture, MatchState, TrainingPlan, Injury, ScoutingAssignment, Report, Promise, InboxEvent, Facility, CommercialAgreement, LedgerEntry and Career.

Each record declares what owns it. The health subsystem owns recovery; matches produce exposure and incidents. Finance owns obligations; transfer completion requests validated accounting transactions. Scouting stores knowledge separately from player truth. UI selectors expose the information appropriate to the managed club.

Local single-player storage cannot securely hide attributes from a determined file inspector. Scouting secrecy is a gameplay rule, not an anti-cheat guarantee.

## 4. Commands and events

Commands contain an ID, expected state revision, payload, and requested boundary. Validate against authoritative state before accepting. Repeating an accepted command ID returns its previous result rather than applying it twice.

Examples: AdvanceToNextEvent, SetTeamInstructions, QueueSubstitution, RequestTimeout, SubmitOffer, AcceptContract, SetTrainingPlan, AssignScout, SetTicketPrice, ProposeFacilityProject, SetDelegationPolicy.

Events record facts already resolved, with stable IDs and world/match timestamps. Examples: ShotResolved, MatchCompleted, ContractSigned, PayrollPosted, InjuryDiagnosed, ScoutReportDelivered, PromotionConfirmed. Store essential reasons so the interface can explain changes without reverse-engineering them later.

Use snapshots plus a bounded event journal. Keeping every animation frame and every historical match action forever is unnecessary. Preserve career history, box scores, important decisions, and selected replays under an explicit retention policy.

## 5. Deterministic simulation

Use explicit seeded random generators with versioned algorithms and separated domains. Save each generator's state. Derive fixture-specific seeds from stable fixture IDs; scheduling work on a different worker must not change the match.

The engine uses integer simulation time and documented rounding. No Date.now(), Math.random(), requestAnimationFrame timing, browser locale, or unordered iteration may influence sporting outcomes. Equal initial state plus equal effective commands must produce equal outcomes across playback modes.

Run a match by stepping authoritative actions or by calling the same step function until a stop condition. Quarter skipping is a stop condition, not a different score generator. Mid-action saves retain unresolved penalties, free throws, commands, and random state.

Separate reproducibility from historical compatibility. A new engine version may intentionally change outcomes; an old career must stay pinned to a supported version or undergo an explicit migration with an explanation. Never silently promise identical replay after changing the probability model.

## 6. Worker and world scheduler

Long simulations belong in a Web Worker; [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) documents background execution and message-based communication. UI animation uses separate timing and interpolates already resolved events.

Worker messages include operation ID, command sequence, revision, progress, result, and structured errors. Allow cancellation only at a committed boundary. Terminating a worker must not leave a half-posted result or salary payment.

Define stable world phases per date: scheduled administrative events, health/training, transfer/AI decisions, fixture kickoffs ordered by simulation time, match completion, post-match reactions, and closing bookkeeping. Resolve cross-club negotiations in a stable order or explicit simultaneous batch. Parallel execution may compute independent matches, but authoritative commits remain deterministic.

Fixtures share the same club, player, contract, eligibility and injury records. A world barrier prevents later decisions from observing some same-time results but not others merely because one worker finished earlier.

## 7. Persistence and recovery

Use IndexedDB for saves; it supports indexed structured records and transactions. Storage is local to an origin and subject to browser quota/eviction, so import/export and clear save status are core features. See [MDN's IndexedDB reference](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

Save envelope: formatVersion, schemaVersion, engineVersion, rulesetVersions, dataPackId/version, calibrationVersion, careerId, revision, createdAt, simulatedDate, RNG states, payload checksum, and payload. Wall-clock metadata is permitted in the envelope but not sporting calculations.

Write a new revision transactionally, verify it, then move the active-save pointer. Retain at least a previous known-good checkpoint where quota allows. Never display "saved" before the storage operation succeeds. Handle quota denial with a recoverable state and export action, preserving the in-memory game.

Import treats files as untrusted data: size limits, JSON/schema validation, finite/ranged numbers, entity references, allowed versions and identifiers. No executable script, HTML insertion, arbitrary asset fetch, or prototype mutation from a save. Validate entirely before replacing the active world. A checksum detects accidental corruption, not malicious authenticity.

Multi-tab play uses one writer lease with conflict detection; a second tab can view or take over explicitly. Reload, canceled simulation and season rollover must recover from a completed revision rather than repeat an event.

## 8. Data and assets

Import tools run separately from the production gameplay client. Ship a versioned pack; do not have each browser scrape league sites during play. Preserve original source values and derivation metadata; normalize units and identities into the domain schema.

Store portrait and court appearance references together. Load images lazily and provide consistent illustrated fallbacks. Future full portraits and sprite artwork can replace development primitives without changing player identity or skills.

Third-party data and image permissions are independent of this repository's Apache software license. Maintain a separate data/asset manifest and distribution status.

## 9. Performance budgets and evidence

Initial measurement goals, not current guarantees: responsive controls during a simulated day; a representative watched match near display refresh rate; no growing memory allocation per rendered frame; resumable season work with visible progress; bounded historical replay storage.

Measure the full twelve-division population before promising season-simulation times. Record hardware, browser, dataset size, fixture count, median and slow-tail duration. Benchmark both simulated games and off-court AI, which may dominate a large world.

Optimize based on profiles: batch snapshots, virtualize long lists, cache derived read models with revisions, compact completed match events, and limit simultaneous workers. Preserve deterministic ordering throughout.

## 10. Verification strategy

Use scenario and property/invariant tests for engine legality, accounting, eligibility, replay, import/export and rollover. Statistical harnesses examine aggregate behavior with confidence intervals and pinned seeds. They complement rather than replace rule tests.

UI checks cover actual journeys: selecting a lineup, watching/skipping, making a legal substitution, recovering a save, scouting a player, negotiating and registering a signing. Avoid tests that merely duplicate implementation formulas or snapshot large unreviewed trees.

Validate build and types on each implementation milestone. Browser QA should cover both a desktop and tablet layout when tooling is available; record limitations instead of claiming visual checks that were not performed.


## 11. Current season implementation

The development league uses `SeasonState` (`schemaVersion: 11`, `engineVersion: possession-3`, `dataPackId: development-league-1`). It owns the clubs, plans, conditions, career injury mode and committed injury history, training, coaching contracts, finance, player payroll, employment terms, per-club scouting knowledge, season number, prior season archives, deterministic current schedule, compact results and one active match. App holds a discriminated exhibition/season session; in season mode its match view is a projection of `season.activeMatch`, not a second authoritative match copy.

Each fixture has an independent seed derived from the career seed and fixture ID. Season 1 retains its original IDs; later fixtures include the season number, providing distinct yearly streams. Round completion computes the other two matches in a module Web Worker, then returns one new immutable season snapshot. The same worker handles rollover after the final round is committed. A request identifier rejects stale replies. Cancellation terminates the worker and retains the previous completed match or season. Loading another session invalidates the worker; asynchronous reads also have a generation guard so they cannot overwrite later commands.

The fictional calendar advances seven days after a committed round. With training disabled, condition recovers by a provisional three points per day for every club, once; enabled training applies the workload and availability rules in section 12. Recovery episodes use a separate deterministic hash of career seed, fixture, player and injury kind, without consuming sporting RNG. The first recovery model uses 7-28 calendar days for ankle incidents and 7-21 for muscle incidents; these are uncalibrated game parameters. A player becomes eligible on returnOn. Pausing, reloading and opening a report do not advance recovery. After all ten rounds are finalized, rollover archives that season once and prepares the following year's first Saturday in September. The exact offseason interval determines recovery; history is retained even after clearance. The four-digit save calendar supports season numbers 1-7974, with rollover beyond year 9999 rejected and no recruitment window beyond the final supported year. Clubs remain stable; when employment is enabled, roster changes, lineup repair and training-plan membership are applied atomically at rollover. Earned development persists by player ID.

Season files use the distinct `basketball-manager-season` format/version 11 and an 8 MB limit. Versions 1–10 are checked against their original constraints, then migrated in memory while preserving their active match exactly and adding disabled scouting. Formats 1–9 also gain disabled employment; format 10 preserves its employment state. Versions 1 and 2 gain season 1 with no archived seasons; later formats retain their existing career history. Formats 1–3 gain disabled training with zero development; format 4 retains its training plans, points and outcomes. Formats 1–4 gain disabled coaching with no contracts, and retained training reports gain zero coaching attribution. Formats 1–5 gain disabled finances with default plans and an empty ledger. Existing coaching and training state is retained. Formats 1–6 gain disabled player payroll; format 6 retains its financial history. Formats 1–7 gain a null manager profile; later formats retain it. Version 1 also receives injury mode off with empty injury history and result injury maps. Formats 1–8 reconstruct known roster membership but cannot recover discarded archive box scores; format 9 retains its snapshots and archived player records. No stored file is rewritten until a save. Full events are retained only for the active game. Compact player statistics are retained for current fixtures and new archives; old imported archives explicitly lack those statistics. Each prior season retains its canonical schedule, earned and official scores, winner, outcome, periods and injury map; standings are derived from those results. Archives are contiguous and never silently truncated. Validation checks fixture order/dates, historical membership, result arithmetic, the condition-recovery boundary and the active match. It rebuilds career health history from archived and current fixture injury maps and rejects altered dates, diagnoses, overlaps, missing carried absences or exposure by unavailable players. Modern scheduled matches may contain optional preExistingInjuries metadata; those players have injury entries at zero elapsed time, zero match exposure and no fabricated new injury events. The UI projects current uncommitted incidents from the active match; only atomic matchday completion appends them to world history.

IndexedDB uses `basketball-manager-seasons`, separately from the exhibition database. IndexedDB version 2 retains the compatible current string and adds a revision counter and checkpoint store. Each save compares the caller's expected revision within a strict read/write transaction, writes the current snapshot and metadata, and prunes to five checkpoints atomically. The first new write preserves a previous single-slot save as revision 0. A tab remembers its revision; browsing history does not refresh write authority. A stale write fails without changes, and an explicit latest/older checkpoint load accepts the observed revision for a future save. This is optimistic conflict detection, not an exclusive writer lease.

New games, completed matchdays, rollover and employment/scouting decisions create automatic checkpoints; manual saves can capture live matches. Contract and scouting activation, accepted offers, responsibility changes, observation assignments/cancellations and shortlist edits use the existing save/revision path. Restoration validates the selected snapshot and changes only the in-memory session until the next save. A damaged current payload opens recovery history; invalid entries are visible but cannot be restored. Failed writes retain prior checkpoints and keep the live game available for retry/export. Checkpoint timestamps describe device time and never enter sporting state or RNG. The five records share one local season slot, so separate careers still need exported files; automatic saving after every match action, named career slots and exclusive writer leases remain future work. Extremely long careers can still reach the 8 MB limit; export/save fails explicitly rather than dropping history.


## 12. Initial training model

`SeasonTraining` owns the model identifier, activation season/round, every club's plan, per-player integer practice points and the latest weekly report. The stable development catalog owns base identities and ratings; `season.clubs` holds the current registered squads and `developClub` projects integer skill ratings when preparing a fixture. All sixty players retain practice points and condition, including unattached players. Weekly processing trains registered squads only. Live and finished match snapshots retain the ratings they started with. Changing a plan or enabling training never rebuilds that match or draws from sporting RNG.

After all three results are committed, the calendar interval processes each of seven days in stable player order. Health eligibility controls participation; workload affects condition and practice points through the same function for human and AI clubs. Cumulative points are bounded to 200 per skill, reduced where the authored rating is already near 20. Every 100 points grants one rating point. Balanced plans divide a fixed practice budget, rotating any remainder by matchday. Condition below 70 halves that day's practice budget. These parameters are explicit provisional models, not calibrated age/potential curves.

`lastWeek` retains the applied plans, dates, eligible days, condition inputs/outputs and gains. Save validation checks those inputs against the preceding committed fixture statistics, reconstructs prior points by subtracting recorded gains, and replays the exact interval with the committed health history. Current plan edits are independent of that report. Activation before the first processed interval and round 1 after rollover have no report; the former retains legacy recovery conditions and the latter retains offseason recovery. Final round 10 has no following training week; its conditions still match the final box score. Rollover clears the report but retains points, plans and activation. Older interval reports are not archived, so cumulative development is bounded owned state rather than a fully replayable training ledger.

## 13. Derived season performance

`world/performance.ts` derives player totals and newest-first game logs from committed selected-season `FixtureResult` records and their referenced registration snapshots. It does not read the active match, modify the world, consume random numbers or add persisted data. The same projection drives squad statistics and league leaders. Imported older results work after their existing migration. The new current season starts with empty performance totals; retained archived box scores remain selectable. Imported old archives with null statistics expose an unavailable state rather than fabricated zero rows.

An appearance requires court time or a nonzero personal statistic; condition alone does not count. Zero-exposure players are marked injured when the committed injury map lists them, otherwise did not play. Per-game denominators use appearances, per-40 counting rates use actual seconds including overtime, and shooting percentages divide combined makes by combined attempts. Zero denominators display no value. Minutes remain MPG in the per-40 view; normalized rates are not forecasts. Game outcomes and scores use the official result, while player totals retain only earned statistics.

Sorting copies the rows, places unavailable values last in either direction, and breaks ties by player name, player ID and club ID without locale-dependent ordering. The optional development-league participation filter requires appearances in at least half of completed club games, rounded up, and total minutes of at least five times those games. This is a visible UI filter, not an official competition award rule. Opponent reports expose public results, identity and participation rather than hidden skill ratings. Filters and selection remain presentation state; opening reports never changes the save.

## 14. Coaching staff foundation

`SeasonCoaching` pins `coaching-1`, its activation boundary and current-season contracts. A fixed catalog supplies thirty fictional identities, seven skill ratings from 1–10 and estimated full-season fees in euro cents. Each club has three training-coach slots and a EUR 150,000 season allocation. This allocation models staffing commitments separately from bank cash. When finances are enabled, appointments also charge the cash ledger and require sufficient cash with no unpaid costs. Appointment reserves the full catalog fee, including midseason recruitment. Release makes a coach available but retains that fee in the old club's current-year commitments. The shared command validates coach availability, club membership, slots, remaining allocation and financial affordability before creating a sequential contract ID. Assignment and renewal edits affect only future processing; prepared matches and retained training reports remain unchanged.

New careers begin with one balanced coach per club. Earlier careers gain no contracts or bonuses until coaching is enabled, independently of training activation. AI clubs recruit after committed rounds 1–9 and on rollover using the same fee/slot/availability/cash checks; candidates are evaluated by marginal coverage of their training focuses per season fee, with stable tie-breaking. Rollover renews active contracts marked for renewal, opens a new season allocation, retains prior financial obligations, and fills AI vacancies. Annual sponsorship is booked before cash-checked renewals; unaffordable renewals lapse. Renewals are processed before recruitment so another club cannot take a renewing coach. Completed seasons reject new appointments. Prior-year staff contract history is not archived in this initial model.

Training freezes the contracted coach IDs and assignments for each club in `lastWeek.coaching`. Each attribute takes the strongest applicable skill rating: full strength for a specific assignment, half strength for balanced coverage, with no stacking. The fractional bonus is base practice times effective rating divided by 40. Integer bonuses share the floored combined budget using largest remainders and a rotating tie order, so balanced coaches contribute even when each separate attribute has less than one bonus point. The maximum is 25% of base practice, at most eight extra points in a 35-point week. Base practice consumes development headroom first; only the remaining actual bonus is stored in `coachingGains`, already included in total gains. Unavailable days and recovery-only plans earn no practice, and coaches do not alter condition or injury return dates.

Current save validation reconstructs appointments by round, checks full fees including releases, historical slot limits and exclusive coach ownership, then replays the retained training week with its frozen assignments. Current assignments may differ from that report. Cumulative practice remains bounded by available base and coached weeks and the existing skill caps; older training weeks and coaching contracts are not a full career audit trail. Assistant, fitness, physio, scout and youth-coach recruitment, staff negotiations, monthly staff payroll and coaching quality calibration remain separate work.

## 15. Club cash and ticketing foundation

`SeasonFinance` pins `finance-1`, the activation boundary, club ticket policies, locked matchday prices and the complete chronological ledger. Entries use integer euro cents, a sequential ID and a unique club/kind/source origin. Opening funds, sponsorship, operating costs, gate receipts and coaching fees are separate categories. Balances are derived: expenses consume cash then create unpaid obligations; income settles those obligations before adding cash. No balance cache or implicit credit line exists. The ledger view derives each transaction's cash and obligation movements from the same fold.

Every club receives EUR 500,000 once on activation, prorated current-year sponsorship from an annual EUR 200,000, and full sponsorship in later years. Activation books all current-year coaching contracts, including released appointments. Each committed round receives three gate entries and six EUR 15,000 operating-cost entries. Round 10 posts finances before completing the season. The worker commits results and finances together; cancellation cannot leave partial receipts. Rollover preserves the ledger, receives sponsorship, renews affordable selected staff, fills AI vacancies and prepares the next match.

Ticket policies choose manual or automatic pricing from EUR 0–60 in whole-euro steps. Prices lock at matchday preparation. Plan edits preserve that lock, the current match and its RNG. The forecast uses only results from rounds earlier than the fixture: demand is reference attendance times `(0.85 + 0.3 * homeWinRate)`, times `(0.9 + 0.2 * opponentWinRate)`, times `(18 / priceEuros)^1.4`. Both form factors are one before any results. Attendance is floored and capped at capacity; free tickets fill the venue. Automatic policy evaluates the same price range and chooses greatest revenue, breaking ties toward the cheaper price. Future-home forecasts can change as intervening results commit. These are provisional development coefficients, not estimated real-club demand curves.

Formats 1–5 gain disabled finance with no ledger, preserving previous behavior until activation. The current format validates exact field sets, activation dates, integer prices, sequential entry IDs, source uniqueness and expected transaction coverage from activation through every committed round. Required sponsorship/cost amounts are pinned; gate attendance and revenue are recalculated from current/archived fixtures. Current-year coaching payments reconcile with retained contracts. Historical coach entries validate catalog fees, contract ID/year, uniqueness and allocation bounds, but prior contracts are not retained for a complete appointment audit. Editable policies cannot establish how an earlier locked price was chosen; prices are bounded and committed gate records must agree. File and collection limits are explicit; no financial history is silently pruned.

Player payroll is implemented below. Transfer installments, capital spending, debt recovery and board sanctions remain unimplemented. Future systems must request transactions through shared accounting and affordability rules. Venue/sponsor identities and financial amounts are fictional development estimates.

## 16. Player payroll and spending reserves

`SeasonPayroll` pins `payroll-1`, an activation season/round and the exact finance-ledger index at activation, club delegation policies and full-career wage agreements. Each agreement identifies a stable player, that season's club, a prospective starting round and the annual wage in euro cents. Annual records represent payment schedules; employment duration belongs to `SeasonEmployment`. With employment enabled, opening-day schedules use the effective contract's salary and registered ownership. Earlier years and careers with employment disabled retain their authored wage behavior. The short development calendar divides wages across ten matchdays using prefix differences so every cent is accounted for. Real monthly payroll and variable bonuses remain separate dependencies.

Finance entries gain a nullable `payroll` payload. An installment posts one club entry per committed matchday with individual agreement/player identities, gross charges, zero discounts and net costs. Already settled players are omitted; an all-settled club still receives an auditable zero-value installment entry. Prepayment records one player's remaining gross obligation, a floored 5% discount and an immediate net charge, covering the current uncommitted round through round ten. Unique origins reject duplicate postings. Agreement history and frozen ledger details remain intact across rollover.

Future wage reserves derive from agreements minus the gross obligation covered by ledger entries. Previously charged but unpaid costs belong to the existing unpaid balance, not future reserves. Prepayment requires cash covering the net settlement plus other players' remaining wage commitments, with no unpaid costs. Coach hiring and renewal also retain future wages. Mandatory expenses are still charged when cash is insufficient; reserves do not create a separate bank balance or borrowing facility. The UI labels charged amounts accurately rather than claiming every obligation was paid. Individual arrears allocation and wage-dispute consequences are not yet modeled.

Automatic policy uses the same prepayment service and retains an additional EUR 100,000 cash cushion. It runs at new-matchday preparation and when the user explicitly turns delegation on. Midseason activation creates commitments prospectively; automation then waits for preparation. Processing order is gates and operations, wage installments, AI coach recruitment, weekly training and next-round preparation. At rollover sponsorship precedes new wage commitments, staff renewals/recruitment and automatic settlement. The match snapshot and sporting RNG remain unchanged by payroll commands.

Format 11 validates agreement coverage and salary against each year's recorded ownership and effective employment terms, alongside activation indices, mandatory installment origins, per-player arithmetic, discounts, chronological settlement and affordability with the reserve active at each transaction. Current rosters cannot rewrite old wage obligations. Formats 1–6 validate their original fields first, then receive disabled payroll. Format-6 finance entries gain null payroll metadata after validation; their original money and future financial behavior are preserved. File and collection limits apply to complete history; no wage agreement or payment is silently discarded.

Staff, Club, Wages, Transfers and Scouting are separate lazy UI modules. Their code and styles load when requested, with a brief workspace status inside the persistent game shell. Domain commands, the authoritative session and the worker remain shared; navigating between workspaces does not replace game state.

## Implemented career entry and identity

The application starts at a menu, with any live session retained separately while entry screens are open. New-career setup emits a validated manager profile, club, injury mode and seed; the coordinator creates the season and saves its first checkpoint. Menu entry pauses playback and saves an active career before leaving its workspace. Loading, restoring and importing use the existing replacement-request guard; browsing saves does not adopt another writer's revision.

The current season format retains the nullable ManagerProfile (name, dateOfBirth, nationality) introduced in format 8. Formats 1 to 7 migrate to null rather than inventing identity. Commands trim profile text; imports require canonical values. Birth dates are validated against the initial career date, allowing the manager to age beyond the setup limit over later seasons. Identity edits leave simulation state and random streams untouched. Local storage still retains one current season and five recent checkpoints; independent named career slots remain future work.

## Implemented historical roster ownership

Current seasons and archives retain a pool of RosterSnapshot records with stable IDs, club ID, effective round and independent base-player records. Fixture results reference a home/away snapshot pair; the latest training report references a snapshot for each club. Match development remains separate from captured identity. Snapshot teams drive historical result reviews, training attribution and performance rows keyed by season, club and player. Injury club IDs remain origin provenance; current availability follows recovering player IDs in the registered squad.

Format 11 retains the snapshot model introduced in format 9 and validates references, chronology, per-season ownership, jersey allocation, injury provenance and archived box-score arithmetic. Formats 1–8 validate before migration; original pack ownership is reconstructable, but formerly discarded archive statistics become null. Each archive must contain either complete box scores or no box scores. Rollover deep-copies all completed results and snapshots before changing registrations. Historical displays use those snapshots, while ledger names resolve through the stable player catalog. The existing 8 MB/collection limits remain explicit.

## 17. Employment and offseason registration

`SeasonEmployment` pins `employment-1`, its activation season/round, a manual/assistant policy, complete immutable contract history and an optional next-season market boundary. Terms identify the player, club, inclusive start/end seasons, annual salary, signing season/round and initial/renewal/free-agent origin. Sequential IDs and nonoverlapping terms give every player at most one employer in a season. Initial terms cover the activation year and preserve its existing payroll agreement. New careers enable the system; imported formats 1–9 retain disabled employment until explicit activation after finance and payroll are enabled.

During an active season, only the acting club's expiring players may renew. After round ten is committed, market preparation retains at least eight players for each AI club before exposing unsigned next-year players to recruitment. Accepted offers begin next season and last one to three seasons. The current squads, prepared match, historical results and sporting RNG remain unchanged. No separate offseason status is required: the season remains complete, with market metadata identifying the pending registration year.

All clubs use the same offer validation: salary at least the authored asking wage, EUR 5,000–50,000 in EUR 500 steps; no overlapping employment; at most twelve registered players; and a EUR 240,000 allocation in every covered year. The affordability test adds EUR 18,000 for each missing place below eight before accepting an offer. This protects the ability to complete a minimum squad at the highest catalog asking wage. Future salary commitments consume the annual allocation without an upfront cash charge; existing payroll cash reserves remain responsible for current-year spending. The assistant uses the same guards, chooses by positional coverage and authored strength with stable tie-breaking, and signs one-year terms. Switching responsibility to Assistant immediately renews toward ten players and recruits during an open window; switching back never cancels accepted terms.

Rollover archives the completed season, fills every AI club's minimum before optional recruitment toward ten, and requires the human club to have eight to twelve contracted players or use delegation. It then rebuilds next-year memberships in stable catalog order, allocates collision-free jersey numbers, repairs starting lineups, remaps individual training plans, creates new registration snapshots and annual payroll agreements, and prepares the opening fixture as one worker result. Completed-season rosters stay immutable throughout negotiations. Every catalog player's identity, health, condition and earned practice points survive departures or a spell without a club.

Pure policy helpers in `world/employment-policy.ts` serve UI quotes, command validation, roster reconstruction and save audits. `world/employment.ts` owns immutable commands; it never imports the season orchestrator at runtime. Storage audits signing chronology and origin, overlaps, yearly roster/budget limits, retained contracts, deterministic registrations and payroll terms against the stable player catalog and historical snapshots. Training replay preserves points for players outside the current registered squads. Legacy activation leaves existing results, money and RNG unchanged.

This is a finite sixty-player offseason market. The scouting model below now supplies the club's recruitment knowledge. Transfer fees, midseason moves, buyouts, early termination, loans, agents, competing offers, player aging, youth intake and retirement remain unimplemented. Richer negotiation is the next management dependency. Real data integration, real competition configurations and engine calibration remain parallel work.

## 18. Club scouting knowledge and shortlists

`SeasonScouting` pins `scouting-1` and its activation season/round. Each club owns its delegation policy, unique shortlist, up to two pending individual assignments, retained completed reviews and latest own-squad assessments by player ID. Assignments identify the player and current season/round. Reviews retain the target's registered club, roster snapshot, actual matchday date and either a frozen developed-attribute observation or a `no-minutes` outcome with no attributes. Latest own-squad assessments use the same provenance and survive a player's departure. New careers enable scouting; valid formats 1–10 migrate with it disabled, preserving their match, employment and financial continuation until explicit activation.

Assignments are available only during an active season for registered outsiders. The next committed matchday resolves them after results and payroll, before weekly training or final-round recruitment. Positive court time creates an observation; zero exposure records a review without increasing knowledge. The queue clears, and the next matchday refills AI/delegated slots. No new observations resolve during the offseason, and neither requesting a report nor viewing one advances the calendar. Opening-day rollover refreshes squad assessments after registrations change, then prepares new assignments. All commands and processing consume no sporting randomness and create no financial fees.

`getPlayerKnowledge` is the safe UI/AI boundary. Current own players expose exact developed ratings. Outsiders expose only unknown knowledge or ranges derived from the latest frozen observation/retained squad assessment, its age and a stable observer/player/attribute hash. Successful observations increase depth from one through three; previous own-squad knowledge retains depth three. The hash creates a persistent bias of minus one, zero or plus one, with initial half-widths four, three and two. Width grows by one per 28 calendar days and bounds are clipped to 1–20, always retaining at least three possible values. The freshness labels are recent through 28 days, aging through 84 days and stale afterward. Current hidden development never silently refreshes an old report. These are provisional information rules, not calibrated confidence intervals or estimates of potential/personality.

Automatic scouting uses public identity/position, the club's shortlist and saved knowledge, with stable tie-breaking. It applies the same capacity, registration and scheduling guards as manual assignments; recently detailed reports need not occupy another automatic slot. Enabled recruitment uses exact own-squad ratings, outside-range midpoints or a neutral 10.5 per skill for an unknown player. Disabled scouting retains the preexisting recruitment policy for old careers. Shortlisting alone creates no observation, and a shortlisted player remains listed after joining or leaving a club.

Format 11 validates exact field sets, activation boundaries, unique valid shortlists, pending assignment limits, completed-review chronology, per-matchday capacity, target registration and actual court exposure. Recorded attributes must respect the base/current-development bounds; recent observations reconcile exactly where retained training history permits. Own-squad assessments must cover the appropriate historical memberships and latest valid boundary. Earlier complete training histories are not retained, so this is a save-coherence audit rather than a cryptographic proof of every historic rating. All completed reviews remain stored, subject to the existing 8 MB file and 20,000-entry collection limits; nothing is silently discarded.

Scouting is a separate lazy workspace, and Transfers uses the same safe projection in player reviews and offers. Shortlist, assignment, cancellation, activation and responsibility edits create checkpoints through the existing revision guard. The first model has no hired scouts, regional coverage, travel costs, scouting infrastructure, personality/potential reports or independent off-season observation calendar. Those remain explicit dependencies alongside richer negotiations.
