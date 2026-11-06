# Courtside: European Basketball Manager

A browser basketball management game in development. The design targets the top two men's divisions in Turkey, Spain, Greece, Germany, Italy and France, plus EuroLeague, EuroCup and Basketball Champions League.

The playable development version is a **fictional exhibition simulation**. It includes a deterministic action engine, a tested subset of FIBA 2024 rules, a large animated diagonal court, live stamina bars, coaching controls and local saves. The game opens at a practical manager's desk with current match information, lineup condition and direct coaching actions. The full club-management career remains in development.

Real reference data is now available separately: **double-click `Open real data.cmd`** in this folder to browse 40 clubs and 727 players from official 2025-26 EuroLeague/EuroCup records. No account or payment is needed. Search, player statistics and spreadsheet exports work offline after downloading. See [coverage and source details](docs/real-data.md); these records are not yet integrated into the career game.

## Run locally

Requires Node.js 24.14 or newer.

On Windows, double-click **Start game.cmd** to launch the game in your browser. Keep its window open while playing; closing it stops the local server. It installs the locked dependencies if they are missing.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Build static assets with `npm run build`; the output is `dist/`. Deployment remains under the project owner's control.

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

The exhibition supports watching/pausing, quarter skipping, instant simulation, tactical changes, queued substitutions and timeouts, foul-outs, team penalties, shot-clock resets, basic injuries, assistant rotations, squad profiles, box scores, and local save/import/export. Mandatory replacements pause every playback mode until resolved. The court animates recorded setup, credited-assist passes, shots, free throws, rebounds, turnovers and substitutions; reduced-motion and text-only views use the same events. These are coarse action sequences. Full movement physics and competition-specific rules remain later work. See the status document for precise limits and verification results.

Exhibition saves use format 2 (`rules-2`). Court scenes are optional event metadata, so earlier format-2 saves still load and use the static fallback for events without scenes. Saves restore the resolved sporting state; a partly watched animation resumes at that action's completed state. Format-1 prototype saves remain unsupported and are not overwritten on load. This development save format is not yet a stable career format.

The agreed first release includes all twelve domestic divisions and the three European competitions. Smaller development fixtures do not reduce that scope. Realistic statistical behavior, the historical data pack and full competition rules require validation before release.

The code's Apache license does not grant rights to third-party player photos, club marks or datasets. The development fixture uses fictional identities and code-drawn appearance. Real data and images need separate source/asset manifests; estimates must be labeled.
