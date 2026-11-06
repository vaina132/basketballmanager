# Courtside: European Basketball Manager

A browser basketball management game in development. The design targets the top two men's divisions in Turkey, Spain, Greece, Germany, Italy and France, plus EuroLeague, EuroCup and Basketball Champions League.

The playable development version includes a **fictional six-club league season** and standalone exhibitions. Choose a club, coach its home and away games, complete ten matchdays, and review the league table, results and box scores. The possession engine includes passing, drives, defensive matchups, a tested subset of FIBA 2024 rules, a large animated diagonal court and live stamina bars. The game opens at a manager's desk with working squad and coaching actions. The full historical, multi-season management career remains in development.

Real reference data is now available separately: **double-click `Open real data.cmd`** in this folder to browse 40 clubs and 727 players from official 2025-26 EuroLeague/EuroCup records. No account or payment is needed. Search, player statistics and spreadsheet exports work offline after downloading. See [coverage and source details](docs/real-data.md); these records are not yet integrated into the career game.

## Run locally

Requires Node.js 24.14 or newer.

On Windows, double-click **Start game.cmd** to launch the game in your browser. Keep its window open while playing; closing it stops the local server. It installs the locked dependencies if they are missing.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Choose **Competitions**, select a club and press **Start season**. After each finished match, **Continue** records the matchday results and prepares the next fixture. **Save season**, export/import and **Load saved season** preserve progress. Season mode currently uses injuries off for every club while persistent health is being built.

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

Season saves use a separate format-1 `basketball-manager-season` envelope and IndexedDB slot. They retain the active match, club instructions, lineup, condition, schedule and compact completed box scores. They do not overwrite the exhibition slot. Other matches run in a cancellable worker; the complete matchday is committed once. Completed seasons retain their results; **New season** starts a separate run. Rollover, aging, finances, recruitment and persistent health are not implemented yet.

The agreed first release includes all twelve domestic divisions and the three European competitions. Smaller development fixtures do not reduce that scope. Realistic statistical behavior, the historical data pack and full competition rules require validation before release.

The code's Apache license does not grant rights to third-party player photos, club marks or datasets. The development fixture uses fictional identities and code-drawn appearance. Real data and images need separate source/asset manifests; estimates must be labeled.
