# Implementation status

Updated: 6 November 2026.

## Design

The product discovery has eighteen answers. Core design, world/match specifications, source strategy, architecture and milestone plan are recorded in this repository. Coefficients are proposals and require calibration. The historical database audit is incomplete.

## Implemented: exhibition, possession actions and court playback

Milestone 1 is complete. Milestone 2 has a working, tested FIBA 2024 rules subset, and Milestone 3 has animated court playback. Both remain partial; their full action-model, calibration and presentation acceptance gates are still open. Milestone 4 now has the playable season foundation described below.

- React/TypeScript/Vite application with working Overview, Squad, Match center and Competitions screens. It opens at a manager's desk showing the current fixture/result, eligible players, active lineup, stamina, real decisions, instructions and recent match activity. Player links open the selected profile; alerts lead to the relevant coaching control. Double-click **Start game.cmd** to launch the local development game.
- Shared club navigation contains only working screens. Promotional panels, slogans and roadmap content were removed from gameplay. The squad workspace includes search, all/on-court/bench/unavailable filters and live stamina. The interface direction is recorded in [repository guidance](../AGENTS.md).
- A compact charcoal/slate interface with amber selections, flat panels, a small club rail and command header, dense roster/competition tables and joined match stamina strips. Team instructions can be changed directly on the overview using Tempo, Outside emphasis, Defensive pressure and Manual/Assistant rotation sliders. Overview and match controls share managed-side commands and save state; completed matches disable edits.
- Two explicitly fictional ten-player teams, seven active 1-20 attributes, centimetres/kilograms, and consistent code-drawn portraits and court appearance.
- New exhibitions use deterministic `possession-3`: separate advances/setups, passes, drives and shots; four ten-minute quarters, five-minute overtime, shared watched/stepped/quarter/instant progression, and a bounded overtime guard. Existing `rules-2` saves retain their original engine.
- Live possessions save the handler, most recent passer, action count, player positions and defensive assignments. A completed pass precedes its later shooting outcome and can lead to a miss. Assists follow the actual last pass, including a made shooting-foul basket, and clear after an intervening drive, whistle, substitution or possession change.
- Formation spacing, shot distance, defender separation, assigned defensive ability/height, shooter skill and fatigue influence shot outcomes. Rebounds consider proximity to the landing point. Tempo affects action timing; outside emphasis changes spacing and choices; pressure affects contests, disruption, fouls and exertion. These coefficients remain provisional.
- Compact shot-creation feedback beneath coaching reports completed passes, drives, open/contested attempts and three-point attempts from recorded home-team events. It follows the displayed action boundary, avoiding premature results during playback.
- Explicit live-ball, dead-ball, free-throw and period-end states; 24-second possessions, 14-second offensive-rebound resets, defensive-foul clock handling, clock-aware shot decisions, held balls and a FIBA possession arrow. Attacking direction changes after halftime.
- Offensive, nonshooting defensive and shooting personal fouls; fifth-team-foul penalty, fourth-quarter foul carryover into overtime, and personal exclusion at five fouls. Free throws resolve individually while the game clock is stopped.
- Substitutions and timeout requests queue for their permitted opportunities, with cancellation, timeout budgets, late-game restrictions and substitution reversal locks.
- Mandatory home replacements pause watched play, quarter skips and instant simulation. Excluded/injured players receive no further playing time. Short-handed teams can continue with at least two eligible players; default results preserve an official score separately from earned player statistics.
- Saved assistant substitution policy handles fatigue and foul trouble consistently in every playback mode. Basic exposure-based match injuries use standard/reduced/off settings equally for both teams; incidence remains uncalibrated and this does not implement career rehabilitation.
- The match screen gives the court the full content width immediately below the scoreboard. The separate shot-clock/possession rules panel has been removed; playback stays with the court, and coaching controls and match settings sit below it. Required replacement decisions remain explicit.
- A lineup dock switches between home and away players and expands to show the bench. Current stamina appears as a visual bar, percentage and fatigue label beside each player, with injury/foul-out indicators. Box scores also show stamina. Bars read live match condition, rather than the player's permanent stamina attribute.
- The engine records court scenes with actor identities, start/end positions, ball paths and presentation durations. The diagonal viewer interpolates setup, completed passes, drives, shots, free throws, rebounds, turnovers and substitutions. Shot scenes share the release positions and defender separation used by the simulation. Movement between action endpoints remains interpolated; there is no continuous physics model, and the viewer does not invent unrecorded passes.
- Court playback has pause/resume, speed controls, reduced-motion and text-only views. Presentation time does not consume sporting randomness, change game clocks or grant recovery. Critical replacement decisions take precedence over playback.
- Local IndexedDB saves and JSON import/export retain format 2 with an explicit `possession-3` or `rules-2` identifier. Old matches are never silently migrated. Modern saves validate live handlers, geometry, matchups, historical shot defenders and assist chains. Optional scenes may be absent in either engine, using a static fallback without affecting sporting results. Saves preserve resolved action state, queued commands, pending free throws, injuries, timeouts, random state and critical decisions; the partial visual playhead is not serialized. Format-1 prototype saves remain unsupported and are not rewritten on load.

## Implemented: first playable season foundation

- **Competitions** opens club selection for a clearly fictional six-club development league with sixty players. The simulated calendar starts on 5 September 2026 and has ten weekly rounds / thirty fixtures; each club hosts and visits every opponent once. This is not a historical competition configuration.
- The managed club can be home or away. Scoreboard ownership, squad/profile selection, tactics, substitutions, timeouts, mandatory decisions, stamina and creation feedback all follow that club without reversing the fixture venue.
- Every game uses `possession-3`. Fixture seeds depend only on the season seed and fixture ID. Other clubs' games use assistant substitutions; the manager chooses manual or assistant control for their club. Match probability coefficients are unchanged by this increment.
- **Continue** requires the current match to finish, resolves the other two fixtures in a Web Worker, and commits all three results together. Cancellation preserves the finished match and posts no partial results. Repeated progression cannot post the same round twice.
- Dates advance by seven days. Final lineups, instructions, assistant policy and match condition carry forward. Every club receives the same provisional three condition points per rest day, capped at 100; recovery happens once. Match fouls and box scores reset at the next kickoff.
- New seasons default to **Standard** injuries, with **Reduced** and **Off** choices during setup. The saved setting applies to every club and is locked during the season. Valid old season saves retain their injury-off setting. The exhibition retains its separate injury options.
- Standings derive from committed results, ranked by wins, overall point difference, points scored and stable club ID. These published development-league tie-breaks are not claimed to reproduce any real league. Current-day results remain marked pending until Continue commits the round.
- Fixture filters show one/all matchdays and all/the managed club. Completed games have compact player box scores, official scores and overtime/default details. A completed season retains its final table and results; starting another run is explicit. There is no season rollover yet.
- Separate format-2 season saves use an 8 MB limit and their own IndexedDB slot; exhibition saves keep their existing envelope and slot. Import validates the canonical clubs/calendar, current fixture, result arithmetic, recovery boundary and embedded match. Old asynchronous loads cannot overwrite newer state. Switching to an exhibition saves the season first.

## Implemented: persistent health foundation

- Match injuries now produce deterministic recovery episodes for every club, with player/club identity, originating fixture, injury type, onset date and return date. Current-match incidents appear immediately in the overview and squad report; the worker commits history with the whole matchday.
- Recovering players are excluded from starting lineups and substitutions, take no court exposure, and retain their original return date through later fixtures. Healthy reserves fill vacancies in a stable order. Fouls reset each game independently of medical availability.
- Recovery advances only with the simulated calendar. Clearance begins on the return date; the next scheduled fixture then admits the player. Pausing, reading reports and loading saves grant no recovery. Finishing the final round does not advance beyond its date.
- Squad includes a compact medical report with Recovering/History filters, expected return dates and working player links. The selected profile shows the injury and days remaining. Availability and stamina remain distinct.
- Season format 2 validates committed injury provenance and recovery boundaries. Valid format-1 seasons migrate in memory to injury mode Off and empty health history, without changing their current match, RNG or results. Local saves remain separate from exhibitions.
- This is a health foundation, not the full rehabilitation system: durations are provisional (ankle 7-28 days; muscle 7-21 days), with no staff effect, treatment choice, modified training, recurrence model or medical assessment uncertainty yet. Injury incidence remains uncalibrated. Severely depleted squads retain the development engine's existing two-player threshold: 2-4 eligible players may start; fewer than two produces a default at zero exposure. Full competition-specific pregame forfeiture rules remain open.

## Implemented: official reference data acquisition

- Downloaded official 2025-26 EuroLeague and EuroCup records: 40 clubs, 727 unique players, 741 registrations and 651 player/competition statistical totals.
- Reproducible Node.js importer with pagination checks, validated references and shooting totals, cached source snapshots and SHA-256 provenance.
- Local JSON and four spreadsheet exports, plus an offline searchable browser with player details, competition/club filters, sorting and pagination. Double-click `Open real data.cmd` to open it.
- Missing values remain unknown; multi-club season totals remain single records. These are all-season registrations, not verified opening-day rosters. Domestic divisions and BCL are not covered.
- The downloaded records stay under ignored `.local-data/`, outside the application bundle. Game reuse permission remains unresolved. See [real data](real-data.md).

## Verification completed

The season increment adds the world loop while preserving the existing match model. The following checks passed:

- `npm.cmd test -- --maxWorkers=1`: **291 tests pass across 12 files**. The 11 new season tests cover full seasons for each of six managed clubs, schedule conservation, away-side control, progression equivalence, atomic result commits and fatigue carryover. The 57 new persistence tests cover exact season resumption, all ten matchdays, required replacements, official default awards and malformed files. All 223 prior checks remain passing, including the original 100-seed `rules-2` hash.
- `npm.cmd run build`: type checking and production build pass, with a separate season worker bundle. A browser smoke test of the production bundle completed a matchday through that worker.
- Browser QA in headless Microsoft Edge: **88 journey checks pass** (the existing 71 plus 17 season journeys). Season coverage includes club selection, away tactics/substitutions, separate local save slots, valid/invalid import, downloaded export, an intentionally paused/cancelled worker, exact round commits, delayed-import protection, standings/fixture filters, result-review focus, completing all ten matchdays, retained final results and mandatory away replacements.
- Desktop/tablet season and match screens were visually inspected. Standings row labels and result-player names use explicit readable body typography. The large court remains directly below the score with stamina alongside active players. Layouts fit 1440px, 1024px, 768px and 390px viewports without page overflow. Browser journeys produced no uncaught exceptions or console errors.
- A full 30-result season with its final replay serialized to **950,883 bytes**, below the 8 MB limit. Only the current game retains full animation history; completed fixtures keep compact statistics. Local documentation links were checked.
- Offline real-data browser: **13 checks pass**, including actual source counts, search, filters, selected-player totals, sorting, pagination, four CSV exports and desktop/tablet layout. No automatic HTTP requests or JavaScript errors; screenshots visually inspected.
- All eight stored source documents match their recorded hashes and byte counts; a cached importer rerun produces identical normalized JSON. All 651 statistical records pass shooting arithmetic and identity checks.

The subsequent interface refresh passed the production build, 11 targeted instruction journeys (keyboard input, both managed sides, state invariants, local/file persistence, mandatory replacements, completed matches and next-fixture carryover), and all 13 match/stamina UI regression journeys. The four main screens were checked at 1440, 1024, 768 and 390 pixels; completed-season tables and result reviews were also inspected. These UI checks produced no page overflow, uncaught exceptions or console errors. No match probability or persistence-format changes were introduced by the interface refresh.

The persistent-health increment passes **343 tests across 15 files**, including 13 carried-fixture checks, six world-health checks and 33 additional persistence/migration checks. Nine browser journeys cover all injury modes, a naturally generated managed-away injury, mandatory replacement, next-fixture exclusion and later clearance, medical reports at 1440/1024/768/390 pixels, real downloaded export/import, rejected recovery-date tampering and an actual old-format save. The production build and bundled worker also imported that injury and carried it into the next matchday. No browser exceptions, console errors or page overflow occurred. Documentation links were checked.

The browser QA was a local development check; its generated screenshots, downloaded test saves and browser profile are ignored under `.artifacts/`.

## Simulation diagnostic, possession-3

Run `npm.cmd run benchmark:match -- --matches 100 --injury-matches 20` to reproduce the current diagnostic. It writes `.artifacts/match-benchmark.json`, including source hashes, distributions, approximate intervals for mean outcomes, action/shot context, 30 paired seeds for each tactical control, and optional comparisons with the downloaded official reference pack. It makes no network requests. `--tactic-matches 0` disables the paired comparisons for a shorter diagnostic.

The possession increment's 6 November run used seeds 1-100, the two fictional clubs, assistant substitutions for both teams and injuries off. That run recorded engine source hash `8aabc3babcb0` and possession-helper hash `7c2f1561ac7c`. The subsequent generic fixture factory changes construction, without changing the probability model.

| Metric | Current diagnostic |
| --- | ---: |
| Mean team score | 88.42 |
| Approximate 95% interval for mean team score across simulation seeds | 86.95-89.89 |
| Mean estimated possessions per team | 72.16 |
| Field-goal / three-point / free-throw percentage | 48.81% / 32.76% / 78.35% |
| Mean fouls / turnovers per team | 12.15 / 4.97 |
| Completed passes / drives per game, both teams | 68.97 / 52.89 |
| Recorded shots lacking defender/contest context | 0 |
| Shot-clock violations across 100 games | 26 |
| Games requiring overtime | 0 |
| Default results / accounting failures | 0 / 0 |

An initial timing diagnostic exposed roughly 100 estimated possessions and 124 points per team. Longer setup and decision windows, a smaller tempo timing range, and earlier shot-clock urgency corrected that volume without changing shooting coefficients. This is an engineering correction, not an empirical fit.

The isolated comparisons change only the named control, using the same 30 seeds at its minimum and maximum. Tempo changes both teams; outside emphasis and pressure change home only. Other instructions stay at their defaults:

| Control | Minimum | Maximum |
| --- | ---: | ---: |
| Tempo: combined field-goal attempts per 40 minutes | 129.38 | 152.10 |
| Outside emphasis: home three-point attempt share | 22.84% | 67.11% |
| Home pressure: home fouls per 40 minutes | 8.50 | 16.46 |
| Home pressure: away turnovers per 40 minutes | 3.03 | 6.56 |
| Home pressure: mean final home-roster condition | 92.51% | 90.94% |

These results establish responsive controls and consistent accounting, not validated basketball realism. The possession estimate is `FGA + 0.44 * FTA - offensive rebounds + turnovers`. Paired tactics change later random draw sequences; the report describes simulation-seed variability, not real-world causal estimates. Aggregate official-source shooting rates are compared descriptively; no player-rating fit or held-out validation has been completed. Pass/assist frequency, turnovers, foul mix, shot selection, rotations, fatigue and injury incidence remain calibration targets. The separate 20-match standard-injury diagnostic recorded zero injuries over 133.33 player-hours, too little exposure to establish incidence; generated injury and replacement scenarios are tested separately.

Legacy `rules-2` compatibility remains pinned to its original 100-seed hash, `960af650db6c2c013ef37690b3dbdcbf874cf43b358b1dff8efa2a3262a5b9aa`. Its previous mean score was 78.00 and estimated possessions 72.59. Existing matches continue with that engine; new exhibitions intentionally produce different actions and outcomes.

## Explicit limits of this milestone

This is a FIBA 2024 exhibition subset, not certification for all planned competitions. EuroLeague has verified differences in jump balls, period possession and technical-foul totals. The [rules evidence matrix](design/rules-coverage.md) separates tested scenarios from partial or missing coverage.

Technical/unsportsmanlike/disqualifying fouls, combined penalties, reviews, lane violations, goaltending, separately timed release/flight adjudication, three-/five-/eight-second violations, all throw-in locations and the late-game frontcourt advance choice remain unimplemented. Possession creation and shot resolution remain discrete actions. Authoritative spacing and assigned defenders now affect outcomes, but continuous movement, collisions, screens, help rotations, switches and zone defense remain unimplemented. The current three-point classification uses basket distance and authored perimeter positions that avoid the corner-line exception; full arbitrary-location court adjudication remains open. The deterministic injury and fatigue models, tactical coefficients and player strength require statistical calibration.

The fictional development season is playable. There is no configured real domestic/European league, full career, complete game-ready historical database, commercial/facilities system, training, academy, staff hiring, transfer market, board/press, detailed rehabilitation or season rollover yet. Unimplemented management systems are omitted from navigation. Acquired reference records have not been converted into career squads or skill ratings. The first-release requirement remains twelve domestic divisions and three European competitions.

Watched and skipped managed matches still run on the main thread; background matchday completion now runs in a cancellable worker. Career save migrations, revision recovery, autosaves and multi-tab write coordination remain future work. Season and exhibition saves are separate development formats, not stable long-term career formats. Format-1 prototype matches cannot be resumed under either supported engine.

## Next dependencies

1. Extend the downloaded reference data to the missing competitions, reconstruct opening-day rosters, and resolve intended-use permissions before bundling a career database. The [data acquisition plan](data-acquisition.md) records immediate free and paid routes.
2. Calibrate the new possession model against verified team/game denominators, broaden off-ball creation and defensive decisions, and implement competition-specific rules. Repeatable diagnostics now expose action counts, shot context and isolated tactical effects; they do not complete these acceptance gates.
3. Extend the working season and health foundation with validated real competition rules/calendars and registration, followed by season rollover and the management layers in the [implementation plan](implementation-plan.md).

## First-release scope still required

Twelve playable domestic divisions across Turkey, Spain, Greece, Germany, Italy and France; EuroLeague, EuroCup and Basketball Champions League; multi-season careers; full management/AI systems; verified historical data; coherent player portraits and 2.5D appearance.
