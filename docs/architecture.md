# Technical architecture

Design baseline: 5 November 2026. Implement progressively; this document describes the target, not features already present.

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

The development league uses `SeasonState` (`schemaVersion: 5`, `engineVersion: possession-3`, `dataPackId: development-league-1`). It owns the clubs, plans, conditions, career injury mode and committed injury history, training, coaching contracts, season number, prior season archives, deterministic current schedule, compact results and one active match. App holds a discriminated exhibition/season session; in season mode its match view is a projection of `season.activeMatch`, not a second authoritative match copy.

Each fixture has an independent seed derived from the career seed and fixture ID. Season 1 retains its original IDs; later fixtures include the season number, providing distinct yearly streams. Round completion computes the other two matches in a module Web Worker, then returns one new immutable season snapshot. The same worker handles rollover after the final round is committed. A request identifier rejects stale replies. Cancellation terminates the worker and retains the previous completed match or season. Loading another session invalidates the worker; asynchronous reads also have a generation guard so they cannot overwrite later commands.

The fictional calendar advances seven days after a committed round. With training disabled, condition recovers by a provisional three points per day for every club, once; enabled training applies the workload and availability rules in section 12. Recovery episodes use a separate deterministic hash of career seed, fixture, player and injury kind, without consuming sporting RNG. The first recovery model uses 7-28 calendar days for ankle incidents and 7-21 for muscle incidents; these are uncalibrated game parameters. A player becomes eligible on returnOn. Pausing, reloading and opening a report do not advance recovery. After all ten rounds are finalized, rollover archives that season once and prepares the following year's first Saturday in September. The exact offseason interval determines recovery; history is retained even after clearance. The four-digit save calendar supports season numbers 1-7974, with rollover beyond year 9999 rejected. Clubs and rosters remain unchanged by rollover; training plans and earned development persist.

Season files use the distinct `basketball-manager-season` format/version 5 and an 8 MB limit. Versions 1–4 are checked against their original constraints, then migrated in memory while preserving their active match exactly. Versions 1 and 2 gain season 1 with no archived seasons; later formats retain their existing career history. Formats 1–3 gain disabled training with zero development; format 4 retains its training plans, points and outcomes. All earlier formats gain disabled coaching with no contracts, and retained training reports gain zero coaching attribution. Version 1 also receives injury mode off with empty injury history and result injury maps. No stored file is rewritten until a save. Full events are retained only for the active game, and compact player statistics only for current-season fixtures. Each prior season retains its canonical schedule, earned and official scores, winner, outcome, periods and injury map; standings are derived from those results. Archives are contiguous and never silently truncated. Validation checks fixture order/dates, membership, result arithmetic, the condition-recovery boundary and the active match. It rebuilds career health history from archived and current fixture injury maps and rejects altered dates, diagnoses, overlaps, missing carried absences or exposure by unavailable players. Modern scheduled matches may contain optional preExistingInjuries metadata; those players have injury entries at zero elapsed time, zero match exposure and no fabricated new injury events. The UI projects current uncommitted incidents from the active match; only atomic matchday completion appends them to world history.

IndexedDB uses `basketball-manager-seasons`, separately from the exhibition database. IndexedDB version 2 retains the compatible current string and adds a revision counter and checkpoint store. Each save compares the caller's expected revision within a strict read/write transaction, writes the current snapshot and metadata, and prunes to five checkpoints atomically. The first new write preserves a previous single-slot save as revision 0. A tab remembers its revision; browsing history does not refresh write authority. A stale write fails without changes, and an explicit latest/older checkpoint load accepts the observed revision for a future save. This is optimistic conflict detection, not an exclusive writer lease.

New games, completed matchdays and rollover create automatic checkpoints; manual saves can capture live matches. Restoration validates the selected snapshot and changes only the in-memory session until the next save. A damaged current payload opens recovery history; invalid entries are visible but cannot be restored. Failed writes retain prior checkpoints and keep the live game available for retry/export. Checkpoint timestamps describe device time and never enter sporting state or RNG. The five records share one local season slot, so separate careers still need exported files; per-action autosaves, named career slots and exclusive writer leases remain future work. Extremely long careers can still reach the 8 MB limit; export/save fails explicitly rather than dropping history.


## 12. Initial training model

`SeasonTraining` owns the model identifier, activation season/round, every club's plan, per-player integer practice points and the latest weekly report. Canonical `season.clubs` stays equal to the authored data pack; `developClub` projects integer skill ratings when preparing a fixture. Live and finished match snapshots retain the ratings they started with. Changing a plan or enabling training never rebuilds that match or draws from sporting RNG.

After all three results are committed, the calendar interval processes each of seven days in stable player order. Health eligibility controls participation; workload affects condition and practice points through the same function for human and AI clubs. Cumulative points are bounded to 200 per skill, reduced where the authored rating is already near 20. Every 100 points grants one rating point. Balanced plans divide a fixed practice budget, rotating any remainder by matchday. Condition below 70 halves that day's practice budget. These parameters are explicit provisional models, not calibrated age/potential curves.

`lastWeek` retains the applied plans, dates, eligible days, condition inputs/outputs and gains. Save validation checks those inputs against the preceding committed fixture statistics, reconstructs prior points by subtracting recorded gains, and replays the exact interval with the committed health history. Current plan edits are independent of that report. Activation before the first processed interval and round 1 after rollover have no report; the former retains legacy recovery conditions and the latter retains offseason recovery. Final round 10 has no following training week; its conditions still match the final box score. Rollover clears the report but retains points, plans and activation. Older interval reports are not archived, so cumulative development is bounded owned state rather than a fully replayable training ledger.

## 13. Derived season performance

`world/performance.ts` derives player totals and newest-first game logs from committed current-season `FixtureResult` records. It does not read the active match, modify the world, consume random numbers or add persisted data. The same projection drives squad statistics and league leaders. Imported older results work after their existing migration. Rollover naturally clears the projection because the next schedule has no results. Archived seasons have no player box scores and therefore expose no player leaderboard.

An appearance requires court time or a nonzero personal statistic; condition alone does not count. Zero-exposure players are marked injured when the committed injury map lists them, otherwise did not play. Per-game denominators use appearances, per-40 counting rates use actual seconds including overtime, and shooting percentages divide combined makes by combined attempts. Zero denominators display no value. Minutes remain MPG in the per-40 view; normalized rates are not forecasts. Game outcomes and scores use the official result, while player totals retain only earned statistics.

Sorting copies the rows, places unavailable values last in either direction, and breaks ties by player name, player ID and club ID without locale-dependent ordering. The optional development-league participation filter requires appearances in at least half of completed club games, rounded up, and total minutes of at least five times those games. This is a visible UI filter, not an official competition award rule. Opponent reports expose public results, identity and participation rather than hidden skill ratings. Filters and selection remain presentation state; opening reports never changes the save.

## 14. Coaching staff foundation

`SeasonCoaching` pins `coaching-1`, its activation boundary and current-season contracts. A fixed catalog supplies thirty fictional identities, seven skill ratings from 1–10 and estimated full-season fees in euro cents. Each club has three training-coach slots and a EUR 150,000 season allocation. This models staffing commitments, not bank cash or a payroll ledger. Appointment reserves the full catalog fee, including midseason recruitment. Release makes a coach available but retains that fee in the old club's current-year commitments. The shared command validates coach availability, club membership, slots and remaining allocation before creating a sequential contract ID. Assignment and renewal edits affect only future processing; prepared matches and retained training reports remain unchanged.

New careers begin with one balanced coach per club. Earlier careers gain no contracts or bonuses until coaching is enabled, independently of training activation. AI clubs recruit after committed rounds 1–9 and on rollover using the same fee/slot/availability checks; candidates are evaluated by marginal coverage of their training focuses per season fee, with stable tie-breaking. Rollover renews active contracts marked for renewal, opens a new season allocation, drops prior-year obligations, and fills AI vacancies. Renewals are processed before recruitment so another club cannot take a renewing coach. Completed seasons reject new appointments. Prior-year staff contract history is not archived in this initial model.

Training freezes the contracted coach IDs and assignments for each club in `lastWeek.coaching`. Each attribute takes the strongest applicable skill rating: full strength for a specific assignment, half strength for balanced coverage, with no stacking. The fractional bonus is base practice times effective rating divided by 40. Integer bonuses share the floored combined budget using largest remainders and a rotating tie order, so balanced coaches contribute even when each separate attribute has less than one bonus point. The maximum is 25% of base practice, at most eight extra points in a 35-point week. Base practice consumes development headroom first; only the remaining actual bonus is stored in `coachingGains`, already included in total gains. Unavailable days and recovery-only plans earn no practice, and coaches do not alter condition or injury return dates.

Format 5 validation reconstructs appointments by round, checks full fees including releases, historical slot limits and exclusive coach ownership, then replays the retained training week with its frozen assignments. Current assignments may differ from that report. Cumulative practice remains bounded by available base and coached weeks and the existing skill caps; older training weeks and coaching contracts are not a full career audit trail. Assistant, fitness, physio, scout and youth-coach recruitment, negotiations, payroll and coaching quality calibration remain separate work.
