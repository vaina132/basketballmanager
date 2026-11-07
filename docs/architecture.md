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

The development league uses `SeasonState` (`schemaVersion: 3`, `engineVersion: possession-3`, `dataPackId: development-league-1`). It owns the clubs, plans, conditions, career injury mode and committed injury history, season number, prior season archives, deterministic current schedule, compact results and one active match. App holds a discriminated exhibition/season session; in season mode its match view is a projection of `season.activeMatch`, not a second authoritative match copy.

Each fixture has an independent seed derived from the career seed and fixture ID. Season 1 retains its original IDs; later fixtures include the season number, providing distinct yearly streams. Round completion computes the other two matches in a module Web Worker, then returns one new immutable season snapshot. The same worker handles rollover after the final round is committed. A request identifier rejects stale replies. Cancellation terminates the worker and retains the previous completed match or season. Loading another session invalidates the worker; asynchronous reads also have a generation guard so they cannot overwrite later commands.

The fictional calendar advances seven days after a committed round. Condition recovers by a provisional three points per day for every club, once. Recovery episodes use a separate deterministic hash of career seed, fixture, player and injury kind, without consuming sporting RNG. The first recovery model uses 7-28 calendar days for ankle incidents and 7-21 for muscle incidents; these are uncalibrated game parameters. A player becomes eligible on returnOn. Pausing, reloading and opening a report do not advance recovery. After all ten rounds are finalized, rollover archives that season once and prepares the following year's first Saturday in September. The exact offseason interval determines recovery; history is retained even after clearance. The four-digit save calendar supports season numbers 1-7974, with rollover beyond year 9999 rejected. Clubs, rosters and ratings remain unchanged by this initial rollover.

Season files use the distinct `basketball-manager-season` format/version 3 and an 8 MB limit. Versions 1 and 2 are checked against their original constraints, then migrated in memory to season 1 with no archived seasons, preserving the active match exactly. Version 1 also receives injury mode off with empty injury history and result injury maps. No stored file is rewritten until a save. Full events are retained only for the active game, and compact player statistics only for current-season fixtures. Each prior season retains its canonical schedule, earned and official scores, winner, outcome, periods and injury map; standings are derived from those results. Archives are contiguous and never silently truncated. Validation checks fixture order/dates, membership, result arithmetic, the condition-recovery boundary and the active match. It rebuilds career health history from archived and current fixture injury maps and rejects altered dates, diagnoses, overlaps, missing carried absences or exposure by unavailable players. Modern scheduled matches may contain optional preExistingInjuries metadata; those players have injury entries at zero elapsed time, zero match exposure and no fabricated new injury events. The UI projects current uncommitted incidents from the active match; only atomic matchday completion appends them to world history. IndexedDB uses `basketball-manager-seasons`, separately from the exhibition database. This is one manual save slot; transactional revisions, autosaves and multi-tab writer coordination remain target architecture. Extremely long careers can still reach the 8 MB limit; export/save fails explicitly rather than dropping history.
