# Courtside: European Basketball Manager

A browser basketball management game in development. The design targets the top two men's divisions in Turkey, Spain, Greece, Germany, Italy and France, plus EuroLeague, EuroCup and Basketball Champions League.

The playable development version includes a **fictional six-club league with season rollover** and standalone exhibitions. Choose a club, coach its home and away games, complete ten matchdays, and continue into the following year. Review current box scores and previous seasons' tables and results. The possession engine includes passing, drives, defensive matchups, a tested subset of FIBA 2024 rules, a large animated diagonal court and live stamina bars. The game opens at a manager's desk with working squad and coaching actions. The full historical management career remains in development.

Real reference data is now available separately: **double-click `Open real data.cmd`** in this folder to browse 40 clubs and 727 players from official 2025-26 EuroLeague/EuroCup records. No account or payment is needed. Search, player statistics and spreadsheet exports work offline after downloading. See [coverage and source details](docs/real-data.md); these records are not yet integrated into the career game.

## Run locally

Requires Node.js 24.14 or newer.

On Windows, double-click **Start game.cmd** to launch the game in your browser. Keep its window open while playing; closing it stops the local server. It installs the locked dependencies if they are missing.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Choose **Competitions**, select a club and press **Start season**. After each finished match, **Continue** records the matchday results and prepares the next fixture. After finalizing the last matchday, **Next season** keeps your club and starts the following year; the Season selector in Competitions opens earlier tables and results. **Autosave** records a checkpoint when a new game starts, after each completed matchday, and after season rollover. **Save season** also saves during a match. Open **Save history** in the footer to restore one of the five most recent checkpoints; **Load saved season** opens the latest. Export/import still works for file backups. Choose Standard, Reduced or Off injuries when starting a game; the setting applies to every club. Injuries carry between fixtures, recovering players are kept out of the lineup, and Squad shows a medical report with return dates and history. Original format-1 season saves retain injuries off when loaded.

**Training** opens weekly plans for your club. Delegate to the assistant or choose Recovery, Light, Standard or Heavy workload, a team focus, and individual player focuses. The week runs after you finish a matchday and press Continue; heavier work trades freshness for development. Injured players miss unavailable days. The latest report shows participation, gains and condition changes. Older careers have an **Enable training** button. Use **Save season** to save plan edits before the next automatic checkpoint.

**Squad → Season statistics** shows sortable per-game, total and per-40-minute figures. Select a player to review their match history, including injury absences and unused games. **Competitions → League player statistics** compares all clubs with position, club, name and participation filters; player reports link to match box scores. These figures use committed current-season results, so they update after Continue. Archived years retain team results but not player statistics.

**Staff** manages up to three training coaches. Review their skills and season fees, recruit within the coaching allocation, assign a specialty or Balanced coverage, and choose whether their contract renews next season. Releasing a coach keeps that season's fee committed. Coaching improves future training gains; weekly reports show its contribution. Older careers have an **Enable coaching** button. Save season keeps staff edits before the next automatic checkpoint.

Build static assets with `npm run build`; the output is `dist/`. Deployment remains under the project owner's control.

In Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy blocks `npm.ps1`.

```sh
npm test
npm run typecheck
npm run build
npm run benchmark:match
```

## Design documents

- [Game design](docs/game-design.md): product scope, play loop, interface, requirements and acceptance stories.
- [Decision record](docs/decisions.md): the eighteen discovery answers and proposed engineering defaults.
- [Club and world mechanics](docs/design/club-and-world.md): players, training, injuries, staff, scouting, finances, facilities, business, youth and AI.
- [Match simulation](docs/design/match-simulation.md): the target rules/action engine, tactics, shared playback and calibration.
- [Rules evidence and coverage](docs/design/rules-coverage.md): pinned FIBA articles, competition differences, scenario checks and remaining omissions.
- [Data and sources](docs/design/data-and-sources.md): historical roster reconstruction, official source candidates, estimated ratings and asset provenance.
- [Data acquisition](docs/data-acquisition.md): free/paid supplier shortlist, sample checks and a ready-to-send enquiry.
- [Real data available now](docs/real-data.md): downloaded official EuroLeague/EuroCup records, local browser/CSV exports, and measured coverage limits.
- [Architecture](docs/architecture.md): state, workers, persistence, versioning and browser boundaries.
- [Implementation plan](docs/implementation-plan.md): milestones and their acceptance conditions.
- [Current status](docs/implementation-status.md): implemented behavior, checks and remaining work.

## Project boundaries

The exhibition supports watching/pausing, quarter skipping, instant simulation, tactical changes, queued substitutions and timeouts, foul-outs, team penalties, shot-clock resets, basic injuries, assistant rotations, squad profiles, box scores, and local save/import/export. Mandatory replacements pause every playback mode until resolved. New exhibitions resolve separate advances, completed passes, drives and shots. Court spacing, the assigned defender, player attributes and fatigue influence shot creation. Completed passes can lead to makes or misses; qualifying made baskets credit the actual passer with an assist. The court animates those recorded actions alongside free throws, rebounds, turnovers and substitutions; reduced-motion and text-only views use the same events. Coaching feedback reports completed passes, drives and shot contests. These are discrete action sequences; full movement physics, competition-specific rules and statistical calibration remain later work. See the status document for precise limits and verification results.

Exhibition saves use format 2. New matches use `possession-3` and save the live handler, passing context, positions and defensive assignments. Earlier `rules-2` matches retain their original engine and deterministic continuation; starting a new exhibition selects the new engine. Court scenes remain optional presentation metadata, with a static fallback for events without scenes. Saves restore the resolved sporting state; a partly watched animation resumes at that action's completed state. Format-1 prototype saves remain unsupported and are not overwritten on load. This development save format is not yet a stable career format.

Season files use a separate format-5 `basketball-manager-season` envelope. Local season storage retains five transactional checkpoints, separate from exhibitions. They retain the active match, club instructions, lineup, condition, career injury history, current schedule, completed box scores, training and coaching contracts. Prior seasons retain all scores and final standings; their player box scores are not retained. Valid formats 1–4 migrate without changing their active match or random state. Formats 1–3 keep training disabled until enabled; format 4 retains its existing training state. All older careers keep coaching disabled until enabled. Season saves do not overwrite the exhibition slot. Matchdays and season transitions run in a cancellable worker and commit once. Each new year begins on the first Saturday of September, with offseason recovery applied to every club. **New game** opens a separate club selection. Player rosters currently remain fixed across years. Aging, full finances, player recruitment and detailed rehabilitation remain in development. Injury incidence and recovery durations remain provisional game models.

If another tab saves newer progress, this tab cannot overwrite it: load the latest checkpoint to continue, or export the current game to preserve a different timeline. Failed automatic saves leave the current game open and show a persistent recovery message. The five checkpoints share one local season slot across clubs; use file exports to retain separate careers. Autosave happens at game creation and calendar boundaries, not after every match action.

The initial training model is provisional: 100 practice points raise a skill by one, with a maximum gain of two per skill and a rating ceiling of 20. Assigned coaches can add bounded practice gains; facilities, age, latent potential and training injuries do not affect it yet. Training runs between matchdays 1–10; offseason rollover grants recovery but no skill points. Coaching uses fictional season fees and a separate allocation, not a complete club cash/payroll simulation. Assistant, fitness, physio, scout and youth-coach recruitment remain future systems.

The agreed first release includes all twelve domestic divisions and the three European competitions. Smaller development fixtures do not reduce that scope. Realistic statistical behavior, the historical data pack and full competition rules require validation before release.

The code's Apache license does not grant rights to third-party player photos, club marks or datasets. The development fixture uses fictional identities and code-drawn appearance. Real data and images need separate source/asset manifests; estimates must be labeled.
