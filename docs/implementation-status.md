# Implementation status

Updated: 6 November 2026.

## Design

The product discovery has eighteen answers. Core design, world/match specifications, source strategy, architecture and milestone plan are recorded in this repository. Coefficients are proposals and require calibration. The historical database audit is incomplete.

## Implemented: exhibition and rules increment

Milestone 1 is complete. Milestone 2 has a working, tested FIBA 2024 rules subset; its full rules and calibration acceptance gate is still open.

- React/TypeScript/Vite application with working Overview, Squad and Match center screens. Double-click **Start game.cmd** to launch the local development game.
- Two explicitly fictional ten-player teams, seven active 1-20 attributes, centimetres/kilograms, and consistent code-drawn portraits and court appearance.
- Deterministic, serializable action engine: four ten-minute quarters, five-minute overtime, shared watched/stepped/quarter/instant progression, and a bounded overtime guard.
- Explicit live-ball, dead-ball, free-throw and period-end states; 24-second possessions, 14-second offensive-rebound resets, defensive-foul clock handling, clock-aware shot decisions, held balls and a FIBA possession arrow. Attacking direction changes after halftime.
- Offensive, nonshooting defensive and shooting personal fouls; fifth-team-foul penalty, fourth-quarter foul carryover into overtime, and personal exclusion at five fouls. Free throws resolve individually while the game clock is stopped.
- Substitutions and timeout requests queue for their permitted opportunities, with cancellation, timeout budgets, late-game restrictions and substitution reversal locks.
- Mandatory home replacements pause watched play, quarter skips and instant simulation. Excluded/injured players receive no further playing time. Short-handed teams can continue with at least two eligible players; default results preserve an official score separately from earned player statistics.
- Saved assistant substitution policy handles fatigue and foul trouble consistently in every playback mode. Basic exposure-based match injuries use standard/reduced/off settings equally for both teams; incidence remains uncalibrated and this does not implement career rehabilitation.
- UI shows the shot clock, team fouls, timeout allowances, pending changes, injury settings, assistant policy and required decisions. Court graphics illustrate recorded actions, not continuous player movement.
- Local IndexedDB saves and JSON import/export use format 2 / rules-2. They preserve queued commands, pending free throws, injuries, timeouts, random state and critical decisions. Legacy prototype saves are rejected with a clear explanation; loading does not rewrite them.

## Implemented: official reference data acquisition

- Downloaded official 2025-26 EuroLeague and EuroCup records: 40 clubs, 727 unique players, 741 registrations and 651 player/competition statistical totals.
- Reproducible Node.js importer with pagination checks, validated references and shooting totals, cached source snapshots and SHA-256 provenance.
- Local JSON and four spreadsheet exports, plus an offline searchable browser with player details, competition/club filters, sorting and pagination. Double-click `Open real data.cmd` to open it.
- Missing values remain unknown; multi-club season totals remain single records. These are all-season registrations, not verified opening-day rosters. Domestic divisions and BCL are not covered.
- The downloaded records stay under ignored `.local-data/`, outside the application bundle. Game reuse permission remains unresolved. See [real data](real-data.md).

## Verification completed

- `npm.cmd test`: **101 tests pass** (38 engine/rules, 54 persistence, 9 data importer).
- `npm.cmd run build`: type checking and production build pass.
- Browser QA in headless Microsoft Edge: **16 current journey checks pass**, including queued and cancelled commands, legal application, foul-out pause/replacement, assistant completion, actual IndexedDB continuity, downloaded export/import, legacy-save recovery, navigation and tablet layout. The prior foundation also passed 13 journey checks.
- Visually inspected desktop and tablet screenshots; corrected overlapping court labels and improved control/table text sizes. Checked 1024px and 768px tablet widths without page overflow.
- Browser journey produced no uncaught exceptions or console errors. Local documentation links were checked.
- Offline real-data browser: **13 checks pass**, including actual source counts, search, filters, selected-player totals, sorting, pagination, four CSV exports and desktop/tablet layout. No automatic HTTP requests or JavaScript errors; screenshots visually inspected.
- All eight stored source documents match their recorded hashes and byte counts; a cached importer rerun produces identical normalized JSON. All 651 statistical records pass shooting arithmetic and identity checks.

The browser QA was a local development check; its generated screenshots, downloaded test saves and browser profile are ignored under `.artifacts/`.

## Simulation diagnostic, rules-2

Run `npm.cmd run benchmark:match -- --matches 100 --injury-matches 20` to reproduce the current diagnostic. It writes `.artifacts/match-benchmark.json`, including source hashes, distributions, approximate intervals for mean outcomes and optional comparisons with the downloaded official reference pack. It makes no network requests.

The 6 November run used seeds 1-100, the two fictional clubs, assistant substitutions for both teams and injuries off for the baseline. Repeating the run produced identical results. The engine source hash starts `5511adcae7a2`.

| Metric | Current baseline |
| --- | ---: |
| Mean team score | 78.00 |
| Approximate 95% interval for the mean team score across simulation seeds | 76.24-79.76 |
| Mean estimated possessions per team | 72.59 |
| Field-goal / three-point / free-throw percentage | 45.23% / 32.61% / 77.49% |
| Mean fouls / turnovers per team | 15.39 / 11.46 |
| Shot-clock violations across 100 games | 72 |
| Games requiring overtime | 6 |
| Default results / accounting failures | 0 / 0 |

This is a diagnostic baseline, not validated basketball realism. The possession count uses the box-score estimate `FGA + 0.44 × FTA - offensive rebounds + turnovers`. Aggregate official-source shooting rates are compared descriptively; no player-rating fit or held-out validation has been completed. The fictional player population, near-even assistant minutes, foul-out distribution, injury hazard and tactical effects still require broader calibration. The separate 20-match standard-injury diagnostic recorded zero injuries over 133.33 player-hours, which is too small a sample to establish incidence. Generated injury and mandatory-replacement scenarios are covered separately by the rules and save tests.

## Explicit limits of this milestone

This is a FIBA 2024 exhibition subset, not certification for all planned competitions. EuroLeague has verified differences in jump balls, period possession and technical-foul totals. The [rules evidence matrix](design/rules-coverage.md) separates tested scenarios from partial or missing coverage.

Technical/unsportsmanlike/disqualifying fouls, combined penalties, reviews, lane violations, goaltending, detailed release/flight geometry, three-/five-/eight-second violations, all throw-in locations and the late-game frontcourt advance choice remain unimplemented. Possession creation and shot resolution are coarse actions. The deterministic injury and fatigue models, tactical coefficients and player strength require statistical calibration.

There is no playable league/career, complete game-ready historical database, commercial/facilities system, training, academy, staff hiring, transfer market, board/press, or season rollover yet. Those sidebar entries are labeled Planned. Acquired reference records have not been converted into career squads or skill ratings. The first-release requirement remains twelve domestic divisions and three European competitions.

The prototype runs short match simulations on the main thread. Workers, career save migrations, revision recovery, autosaves and multi-tab write coordination remain future work. Current saves contain one exhibition snapshot and are not a stable long-term career format. Format-1 prototype matches cannot be resumed under rules-2.

## Next dependencies

1. Extend the downloaded reference data to the missing competitions, reconstruct opening-day rosters, and resolve intended-use permissions before bundling a career database. The [data acquisition plan](data-acquisition.md) records immediate free and paid routes.
2. Expand the remaining action/rules scenarios and calibrate statistical behavior using the repeatable match benchmark and verified competition evidence. Complete continuous event-driven match presentation afterward.
3. Extend the world, competition and career layers following the [implementation plan](implementation-plan.md).

## First-release scope still required

Twelve playable domestic divisions across Turkey, Spain, Greece, Germany, Italy and France; EuroLeague, EuroCup and Basketball Champions League; multi-season careers; full management/AI systems; verified historical data; coherent player portraits and 2.5D appearance.
