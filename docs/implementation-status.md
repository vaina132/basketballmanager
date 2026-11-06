# Implementation status

Updated: 6 November 2026.

## Design

The product discovery has eighteen answers. Core design, world/match specifications, source strategy, architecture and milestone plan are recorded in this repository. Coefficients are proposals and require calibration. The historical database audit is incomplete.

## Implemented: exhibition, rules and court playback

Milestone 1 is complete. Milestone 2 has a working, tested FIBA 2024 rules subset, and Milestone 3 has animated court playback. Both remain partial; their full action-model, calibration and presentation acceptance gates are still open.

- React/TypeScript/Vite application with working Overview, Squad and Match center screens. It opens at a manager's desk showing the current fixture/result, eligible players, active lineup, stamina, real decisions, instructions and recent match activity. Player links open the selected profile; alerts lead to the relevant coaching control. Double-click **Start game.cmd** to launch the local development game.
- Shared club navigation contains only working screens. Promotional panels, slogans and roadmap content were removed from gameplay. The squad workspace includes search, all/on-court/bench/unavailable filters and live stamina. The interface direction is recorded in [repository guidance](../AGENTS.md).
- Two explicitly fictional ten-player teams, seven active 1-20 attributes, centimetres/kilograms, and consistent code-drawn portraits and court appearance.
- Deterministic, serializable action engine: four ten-minute quarters, five-minute overtime, shared watched/stepped/quarter/instant progression, and a bounded overtime guard.
- Explicit live-ball, dead-ball, free-throw and period-end states; 24-second possessions, 14-second offensive-rebound resets, defensive-foul clock handling, clock-aware shot decisions, held balls and a FIBA possession arrow. Attacking direction changes after halftime.
- Offensive, nonshooting defensive and shooting personal fouls; fifth-team-foul penalty, fourth-quarter foul carryover into overtime, and personal exclusion at five fouls. Free throws resolve individually while the game clock is stopped.
- Substitutions and timeout requests queue for their permitted opportunities, with cancellation, timeout budgets, late-game restrictions and substitution reversal locks.
- Mandatory home replacements pause watched play, quarter skips and instant simulation. Excluded/injured players receive no further playing time. Short-handed teams can continue with at least two eligible players; default results preserve an official score separately from earned player statistics.
- Saved assistant substitution policy handles fatigue and foul trouble consistently in every playback mode. Basic exposure-based match injuries use standard/reduced/off settings equally for both teams; incidence remains uncalibrated and this does not implement career rehabilitation.
- The match screen gives the court the full content width immediately below the scoreboard. The separate shot-clock/possession rules panel has been removed; playback stays with the court, and coaching controls and match settings sit below it. Required replacement decisions remain explicit.
- A lineup dock switches between home and away players and expands to show the bench. Current stamina appears as a visual bar, percentage and fatigue label beside each player, with injury/foul-out indicators. Box scores also show stamina. Bars read live match condition, rather than the player's permanent stamina attribute.
- The engine records court scenes with actor identities, start/end positions, ball paths and presentation durations. The diagonal viewer interpolates setup, credited-assist passes, shots, free throws, rebounds, turnovers and substitutions. Formation and ball paths are coarse action descriptions, not a continuous physics model; unrecorded passes are not invented by the viewer.
- Court playback has pause/resume, speed controls, reduced-motion and text-only views. Presentation time does not consume sporting randomness, change game clocks or grant recovery. Critical replacement decisions take precedence over playback.
- Local IndexedDB saves and JSON import/export retain format 2 / rules-2, including optional scene metadata. Earlier format-2 saves without scenes remain loadable, with a static fallback for those events. Saves preserve the resolved action state, queued commands, pending free throws, injuries, timeouts, random state and critical decisions; the partial visual playhead is not serialized. Format-1 prototype saves remain unsupported and are not rewritten on load.

## Implemented: official reference data acquisition

- Downloaded official 2025-26 EuroLeague and EuroCup records: 40 clubs, 727 unique players, 741 registrations and 651 player/competition statistical totals.
- Reproducible Node.js importer with pagination checks, validated references and shooting totals, cached source snapshots and SHA-256 provenance.
- Local JSON and four spreadsheet exports, plus an offline searchable browser with player details, competition/club filters, sorting and pagination. Double-click `Open real data.cmd` to open it.
- Missing values remain unknown; multi-club season totals remain single records. These are all-season registrations, not verified opening-day rosters. Domestic divisions and BCL are not covered.
- The downloaded records stay under ignored `.local-data/`, outside the application bundle. Game reuse permission remains unresolved. See [real data](real-data.md).

## Verification completed

The latest manager-desk and squad increment changes presentation only; the sporting engine and save format remain unchanged. The following checks passed against the updated interface:

- `npm.cmd test`: **156 tests pass** (57 engine/rules/court, 86 persistence, 9 data importer, 4 playback). These include nine new focused rule scenarios and backward compatibility for format-2 events without court scenes.
- `npm.cmd run build`: type checking and production build pass.
- Browser QA in headless Microsoft Edge: **59 journey checks pass** (16 coaching/save, 14 animated-playback, 13 layout/stamina and 16 manager-desk/squad journeys). Coverage includes queued commands, required replacements, local save/export/import, player and ball movement, pause/resume and speed changes, withholding shot results until presentation, reduced-motion/text-only views, matching results across playback modes, the final action, navigation, court placement, active/bench/opponent stamina, fatigue labels, actor/card synchronization during assistant substitutions, and responsive layout. Manager-desk checks cover linked player selection, squad filters/search, instruction edits, critical-decision navigation, loading saved state, completed results and pausing when leaving the court.
- Visually inspected the revised desktop and tablet screens. At a 1440px viewport, the court spans the content width directly below the score with a 14px gap. Checked 1024px, 768px and 390px widths without page overflow; player bars match saved condition and remain stable while paused.
- Browser journey produced no uncaught exceptions or console errors. Local documentation links were checked.
- Offline real-data browser: **13 checks pass**, including actual source counts, search, filters, selected-player totals, sorting, pagination, four CSV exports and desktop/tablet layout. No automatic HTTP requests or JavaScript errors; screenshots visually inspected.
- All eight stored source documents match their recorded hashes and byte counts; a cached importer rerun produces identical normalized JSON. All 651 statistical records pass shooting arithmetic and identity checks.

The browser QA was a local development check; its generated screenshots, downloaded test saves and browser profile are ignored under `.artifacts/`.

## Simulation diagnostic, rules-2

Run `npm.cmd run benchmark:match -- --matches 100 --injury-matches 20` to reproduce the current diagnostic. It writes `.artifacts/match-benchmark.json`, including source hashes, distributions, approximate intervals for mean outcomes and optional comparisons with the downloaded official reference pack. It makes no network requests.

The 6 November run used seeds 1-100, the two fictional clubs, assistant substitutions for both teams and injuries off. The court-scene increment preserves the previous rules-only statistical results. The current engine source hash starts `151662b5c79b`.

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

Technical/unsportsmanlike/disqualifying fouls, combined penalties, reviews, lane violations, goaltending, separately timed release/flight adjudication, three-/five-/eight-second violations, all throw-in locations and the late-game frontcourt advance choice remain unimplemented. Possession creation and shot resolution are coarse actions. The court's saved trajectories illustrate those resolved actions; collision, spacing and continuous defensive movement do not yet determine their outcomes. The deterministic injury and fatigue models, tactical coefficients and player strength require statistical calibration.

There is no playable league/career, complete game-ready historical database, commercial/facilities system, training, academy, staff hiring, transfer market, board/press, or season rollover yet. Unimplemented management systems are omitted from navigation. Acquired reference records have not been converted into career squads or skill ratings. The first-release requirement remains twelve domestic divisions and three European competitions.

The prototype runs short match simulations on the main thread. Workers, career save migrations, revision recovery, autosaves and multi-tab write coordination remain future work. Current saves contain one exhibition snapshot and are not a stable long-term career format. Format-1 prototype matches cannot be resumed under rules-2.

## Next dependencies

1. Extend the downloaded reference data to the missing competitions, reconstruct opening-day rosters, and resolve intended-use permissions before bundling a career database. The [data acquisition plan](data-acquisition.md) records immediate free and paid routes.
2. Expand engine-authored possession actions, spacing, defensive matchups and shot creation beyond the current coarse court scenes. Continue competition-specific rules and statistical calibration using the repeatable match benchmark and verified evidence. The screen redesign does not complete these engine dependencies.
3. Extend the world, competition and career layers following the [implementation plan](implementation-plan.md).

## First-release scope still required

Twelve playable domestic divisions across Turkey, Spain, Greece, Germany, Italy and France; EuroLeague, EuroCup and Basketball Champions League; multi-season careers; full management/AI systems; verified historical data; coherent player portraits and 2.5D appearance.
