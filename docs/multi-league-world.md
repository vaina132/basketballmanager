# Multi-league world (sprint 3)

Approved by the owner on 14 November 2026: "1) European competitions use their real format 2) leagues you don't select their clubs should appear in european competitions, just like in Football manager or any other managerial game. They had the same thing, they were having players generated somehow and the clubs play in the game but the unselected countries/clubs are not so deeply detailed."

Scope (decided 13 November 2026, `docs/decisions.md#first-release-league-scope-and-league-selection`): the top and second divisions of Turkey, Spain, Italy and France, the top divisions of Greece and Germany, and the EuroLeague, EuroCup and Basketball Champions League. The owner asked for continuous work within this plan: choices not settled here are taken with the recommended default, recorded as reversible in `docs/decisions.md` and reported.

## How Football Manager handles leagues

- **Playable leagues** are simulated in full: every club, player and match, with the competition's real rules.
- **View-only leagues** keep their rules and produce results, but their players are not loaded in full, which keeps the game fast and the save small. Clubs from these leagues still take part in continental competitions. When a league is made playable later, missing players are generated ("newgens").
- **Continental competitions** run every season, their entries decided by domestic results under each competition's rules.
- More playable leagues make the game slower and the save larger; FM shows an estimate when leagues are chosen.

Sources: Sega support, [Which leagues are playable in FM24](https://support.sega.com/hc/en-gb/articles/19452936071313) and [FM26](https://support.sega.com/hc/en-us/articles/31629731464593); [FM Scout, FM26 leagues and licences](https://www.fmscout.com/a-fm26-leagues-and-licences.html).

## Levels of detail in this game

| Level | Who | What runs |
| --- | --- | --- |
| **Full** | Every club of the leagues chosen at career start (the manager's league is always one) | Everything that runs today: finances, staff, academy, board, contracts, transfers, training and health; every game with the match engine; the league's real format with playoffs; promotion and relegation between a country's two divisions |
| **Background club** | Clubs of leagues not chosen that play a European competition, and European clubs from countries outside the six | The real club roster from the data pack, with a legal matchday selection, colours and arena; European games with the match engine (box scores, injuries, fitness); no finances, staff, academy, board, contracts or transfers. Their players cannot be signed in this sprint. Squads stay as in the pack during a season; at rollover they age like everyone else |
| **Background table** | Leagues of the six countries that were not chosen | No games are played. At each season end a final table is estimated from squad strength with a seeded random element and shown as "estimated". It decides only European places |

Clubs from countries outside the six (for example Žalgiris, Partizan or Maccabi) have no domestic data: they keep their European place each season.

## Competition formats

**European competitions, 2026-27 (real formats):**

- **EuroLeague:** 20 clubs, home and away, 38 rounds (24 September 2026 to 16 April 2027). Places 1-6 reach the playoffs; 7-10 play the Play-In (7 v 8: winner is seed 7; 9 v 10: loser is out; the loser of 7 v 8 meets the winner of 9 v 10 for seed 8; single games at the higher seed). Playoffs best of five (1 v 8, 2 v 7, 3 v 6, 4 v 5; games 1, 2 and 5 at the higher seed). Final Four: single-game semi-finals, third-place game and final at one venue. Sources: [EuroLeague format](https://www.euroleaguebasketball.net/euroleague/news/format-el), [EuroLeague 2026-27 schedule](https://eurohoops.net/en/euroleague/1994855/euroleague-releases-full-schedule-for-the-2026-27-season), [20-team field confirmed](https://www.eurohoops.net/en/euroleague/1984894/euroleague-confirms-20-team-field-expansion-plans-and-franchise-roadmap/).
- **EuroCup:** expanded to 32 clubs in four groups of eight, home and away within the group (14 rounds from 29 September 2026). The top four of each group reach the eighth-finals; eighth-finals, quarter-finals, semi-finals and finals are all best of three. Sources: [32-team field](https://www.eurohoops.net/en/eurocup/1984959/eurocup-confirms-32-team-field-for-2026-27-season-two-rome-clubs-among-participants/), [2026-27 schedule](https://eurohoops.net/en/eurocup/1994861/bkt-eurocup-announces-the-2026-27-schedule).
- **Basketball Champions League:** two single-game qualification tournaments (14-20 September 2026) send two winners to a regular season of 32 clubs in eight groups of four, home and away (six rounds from 6 October 2026); clubs from one country are never drawn together. Group winners reach the Round of 16; second and third play best-of-three Play-Ins (home advantage to the second-placed club); the Round of 16 is four groups of four, home and away; the top two reach best-of-three quarter-finals; Final Four in May 2027. Sources: [BCL competition system](https://www.championsleague.basketball/23-24/competition-system), [2026-27 draw](https://www.eurohoops.net/en/fiba-champions-league/1988559/all-you-need-to-know-ahead-of-2026-27-season-draw-basketball-champions-league/).

**Domestic leagues:** a double round robin, then each league's own playoffs (and play-in where the league has one), and promotion and relegation by its own counts. Each league's 2026-27 format is checked against its regulations at step 3.4 and recorded there with sources; club counts come from the data.

**European places in later seasons (reversible default; the real rules mix licences, wildcards and country rankings):** each country of the six keeps as many places in each competition as it had in 2026-27, filled from its final domestic order (EuroLeague first, then EuroCup, then the BCL; second-division clubs cannot enter). EuroLeague clubs holding long-term licences keep their place; its one-year places (Paris and Beşiktaş in 2026-27) go to the EuroCup winner and the best domestic finisher not yet qualified. Clubs from outside the six countries keep their places.

## One calendar

- The career calendar is a list of game days. **Domestic games are on Saturdays**, weekly from the first Saturday in September; leagues with fewer matchdays pause on evenly spread weekends so that every regular season ends on the same weekend, and the playoffs follow on shared dates. **European games are midweek:** EuroCup and BCL on Tuesdays and Wednesdays, the EuroLeague on Thursdays (and also Tuesdays in its double-round weeks).
- A club never plays twice on one day and always has at least a day between games; an impossible calendar is refused when the career starts rather than overlapping games.
- On a game day when the manager's club plays, the match screen opens as today; on other game days, **Continue** plays the day's other games.
- Playoff series reserve dates for every possible game; games not needed are not played.
- Amounts that are counted per matchday today (running costs, upkeep, facility wear, training gains, ticket income) become per week or per home game, so a club with more games is not charged or paid more for days that do not exist. This also answers part of the pilot's open point on long seasons.

## Records that scale

These are targets, not completed behavior. A local checkpoint fingerprint may skip repeat checks only for already validated, unchanged text; an imported fingerprint cannot authenticate omitted historical evidence. Portable summaries need explicit, independently checked invariants.

- **Finished seasons are sealed:** a season is checked in full when it ends, and later loads check its fingerprint and summaries instead of replaying it, so loading time stops growing with every season.
- **Lighter records for clubs the manager does not run:** weekly academy reports in detail only for the manager's club (other clubs keep their outcomes); past seasons keep full box scores for the manager's games and season totals for the rest.
- **Targets to measure:** a world of three full leagues plus Europe should load in about 5 seconds and stay well inside the 32 MB save limit after five seasons.

## League selection at career start

- The player chooses the countries to run in full (at least one). A country brings both of its divisions where it has two, so promotion and relegation always work within the full world. The three European competitions are always included.
- Put a country flag and readable country name first, with league name and division underneath. Use flag assets that render on Windows; flags supplement accessible country labels and never replace them. Keep keyboard and tablet selection usable.
- The screen shows an estimate of speed and save size for the selection, as FM does.
- The manager then chooses a club from the selected leagues; real clubs only, as decided.
- Show squad strength with a compact labeled bar or stars, based on the actual position-weighted ratings, with the numeric value available as detail. Show the actual full-club player count, distinct from the selected matchday squad. Keep this a compact game setup screen.
- Below a second division (and below the German and Greek top divisions), relegated clubs leave the full world as background clubs and can return; promoted clubs come from the real next division's clubs, with squads generated where the data has no players (step 3.4 records the details).

## Steps

| Step | What | Status |
| --- | --- | --- |
| 3.1 | Data: import the other eight domestic divisions, the EuroCup and the BCL (2025-26 and 2026-27); club identities; ratings that compare every league with the European level (rating-3); a new private pack with all thirteen competitions | Import complete; roster fidelity/freshness follow-up below remains |
| 3.2 | Save checks that scale: sealed seasons and lighter records for clubs the manager does not run | In progress: validated local reads, historical checks, academy/youth outcomes and logical-ledger groundwork; financial archives and bounded total history remain |
| 3.1 follow-up / 3.3 prerequisite | Distinguish full club rosters, competition registration and matchday selection; preserve variable real roster sizes and audit fresh API memberships | Planned after the current 3.2 work, before selection acceptance |
| 3.3 | One calendar for several leagues: competitions in the world, game days, days without the manager's game, a table per league, amounts per week or home game | Planned |
| 3.4 | Domestic playoffs, titles, and promotion and relegation (real formats, checked per league) | Planned |
| 3.5 | European competitions in their real formats on midweek dates, with background clubs and background tables; European places for the next season | Planned |
| 3.6 | League selection at career start: country flags/names, league/division, visual squad strength, actual roster counts and the speed/size estimate | Planned; includes owner feedback of 14 November |
| 3.7 | Final check: a multi-league season with Europe in the browser, save and load, rollover into season two, measurements | Planned |

Order as approved on 14 November 2026. Each step is tested and recorded in `HANDOVER.md`; the owner commits.

## Step 3.1: all thirteen competitions imported, rated and packed (14 November 2026)

**Import** (`npm.cmd run data:import`; scope in `COMPETITIONS`, `--only` imports named leagues, `--refresh-stats` requests stored box scores again): the other eight domestic divisions, the EuroCup and the BCL for 2025-26 and 2026-27, in 731 API requests (Pro plan: 7,500 a day; no extra cost): 211 new clubs, 3,615 new players, about 78,000 box-score lines. The database now holds 4,517 players, 8,775 squad places and 97,124 box-score lines (free Supabase plan).

Club counts in 2026-27: BBL 18, ACB 18, BSL 16, Lega A 16, LNB Élite 16, Greek Basket League 14; Primera FEB 18, Serie A2 20, Élite 2 20, **TBL 17** (an odd number: step 3.3 adds a bye); EuroLeague 20, EuroCup 33 listed (32 plus one extra listing), BCL 54 listed (the 32 regular-season clubs plus the qualification rounds' entrants).

**Data problems found and fixed:**
- The provider writes Italian Serie A minutes as whole minutes ("28") rather than "28:14"; the importer read none of them, which made every Italian rating far too high. The importer now reads both forms, and the Italian box scores were requested again (53 requests).
- 27 of 7,129 Liga ACB lines hold impossible shooting (one shows 67 three-pointers made from one attempt). Migration `20261114090000_valid_shooting_totals.sql` adds shooting totals that skip lines with more made than attempted; the ratings use them.
- The provider lists some countries wrongly (Hapoel Jerusalem as USA, VEF Riga as Russia); `real-data/club-identities.csv` corrects them.

**Club identities:** 185 new rows (display names, three-letter short names, countries, cities); colours only where well known (10 clubs, marked "likely"), the rest empty for the owner's check, as before. 189 of the 223 pack clubs still have no verified colours (grey in the game).

**Ratings rating-3** (`scripts/real-data-ratings.mjs`, `competitionLevels`): every competition is converted to the EuroLeague level statistic by statistic. Players who played two competitions in one season link them; players who moved between domestic leagues from 2025-26 to 2026-27 link them at half weight; all links are solved together, so second divisions (which play no European games) are measured through the top divisions. Each competition starts from a default for its kind and tier worth 1,500 minutes of links. The 1-20 scale is set by players whose main competition is a top division or the EuroLeague, and small samples are pulled towards the average of the player's own league. Version `2026.11-world-1` rates 4,259 players.

League strength in 2026-27 (average overall rating of each club's best eight; median club): EuroLeague 80.8, Liga ACB 70.9, EuroCup 69.6, BSL 68.9, Lega A 66.6, BBL 63.5, BCL 62.1, LNB Élite 62.1, Greek Basket League 61.8; Élite 2 43.8, Serie A2 45.3, Primera FEB 39.5, TBL 39.1. The strongest second-division clubs (Gran Canaria 60.6, Fortitudo Bologna 54) sit near the weakest top-division clubs. **For the owner's check:** the second divisions are measured only through 20-38 players who moved up, and players who move up after a good season tend to do less well afterwards, so the gap may be somewhat too large; match calibration in sprint 4 will show it.

**Pack `2026.11-world-1`:** 13 competitions, 223 clubs, 3,087 players; the earlier packs were confirmed unchanged and `data:verify` passes. A club now needs eight real players (was ten); four provider squads list nine (APU Udine, Ruvo di Puglia, AS Monaco, Landstede Hammers Zwolle), which the pack notes.

**Generated reserves** (`withReserves` in `src/world/real-world.ts`): when a club has fewer than twelve players, the career world fills the missing places with young fictional reserves (fictional names by the club's country, one point below the average of the club's three weakest real players in every ability, in the positions the squad has fewest of; profile source `generated-reserve`). With this pack, 32 reserves fill short squads across seven leagues. A private check built every career league from the pack (nine leagues with an even number of clubs) and played two matchdays of an APU Udine career with every system on: 1.7 seconds, a 0.44 MB save that reloads identically.

Tests: `tests/real-data-import.test.js` (scope and `--only`), `tests/real-data-ratings.test.js` (rating-3: direct, chained and default levels; a second division rates lower; second-division players cannot move the scale), `tests/real-data-pack.test.js` (eight-player minimum), `tests/real-world.test.ts` (generated reserves).

### Roster fidelity and freshness follow-up (owner feedback, 14 November 2026)

The identical twelve-player squads are an implementation restriction, not what the API supplies. `REAL_WORLD_RULES.squadSize` uses `MAX_ROSTER_SIZE = 12`; `matchdayTeam` trims large squads and `withReserves` fills small ones. The unchanged private pack has **9–25 players per club**: 149 of 223 clubs have more than twelve, 29 have fewer; Fenerbahçe has 17 and Beşiktaş 15. Removing only the truncation would violate current registration, contract, payroll and match validations.

Before league selection acceptance, separate full club membership from competition eligibility and the twelve-player matchday roster. Preserve real players outside the matchday selection; do not add fictional players merely to make every club twelve. Handle genuinely incomplete coverage explicitly, label any generated fallback, and test roster sizes through transfers, academy promotion, injuries, rollover, save/load and historical reviews. Existing careers retain their embedded world and results; a new pack does not silently rewrite them.

The pack was built at **2026-11-14 08:05:37 UTC** from observed 2026–27 memberships. It is a latest-observed snapshot, **not a verified opening-day roster**, although careers start on opening day. Expose the season and snapshot date and preserve that distinction. The importer currently upserts memberships without expiring absent entries: a refresh needs a scoped, reviewed reconciliation of provider/season/competition membership, not deletion on one missing response or a blind union.

Three fresh read-only API-Sports requests on 14 November checked two clubs: Fenerbahçe's domestic endpoint returned the same 17 identities as the pack; Beşiktaş's domestic and European endpoints each returned 14, with different coverage. Their union exactly matches the pack's 15 (Y. Aksu appears only domestically, DaQuan Jeffries only in Europe). No stale identity was established in these samples; they do not certify all thirteen competitions or imply those fifteen are eligible in every competition. All calls succeeded without provider errors; no database or pack was changed. Evidence: `.artifacts/api-roster-freshness-2026-11-14T11-09-54-394Z.json` and `.artifacts/api-roster-freshness-besiktas-europe-2026-11-14T11-12-48-836Z.json` (ignored, no credentials).

**Sprint 4 rating calibration:** the owner's Beşiktaş/Fenerbahçe comparison is an explicit review case. Audit provider statistics, minutes, positions, sample sizes, cross-league conversion, squad-depth aggregation and simulated results. Ratings remain estimates pending this work; do not hardcode a preferred club order by reputation. Country flags and visual strength belong to 3.6 and are not implemented in this save increment.

## Step 3.2: save scaling (14 November 2026)

The resumed session found an unfinished optimization that fingerprinted checkpoints without first checking their gameplay state. That path has been removed. Every new checkpoint now passes the same full validation as an export, then optionally stores a SHA-256 integrity fingerprint beside the text in IndexedDB. A matching current checks-version fingerprint allows a local reload to unpack the already validated text without repeating historical replay. Imports always validate in full. Missing, stale or mismatched fingerprints, or unavailable/rejected Web Crypto, use full checks. The unfinished version-1 fingerprints are explicitly invalidated; checks version 2 starts from validated saves.

**Lossless storage first:** format 41 (`compact-2`) shares repeated object/array subtrees as well as strings and field-name shapes. It preserves every historical record and reconstructs independent objects, so editing one decoded record cannot alter another. Formats 1–40 still import, including format-40 `compact-1` files. The decoder rejects forward/cyclic/malformed references and checks expanded value counts, depth, collection sizes and UTF-8 size before allocation. Stored files remain capped at 32 MiB; expanded JSON has a separate 256 MiB guard. Genuine format-40 fixtures captured before this work cover continuation, rollover and migration.

This is an incremental change to the planned archive approach: retaining replay evidence is safer while historical academy, finance, contracts and job changes still depend on it. **3.2 is not yet complete.** Write/export/import validation still grows with history, and the five-season target for three full leagues plus Europe is not yet measurable. Bounded summary records and incremental checks remain the next scaling work; do not remove rival histories without replacing their validation and preserving the club managed in each historical season.

The opt-in `npm.cmd run benchmark:saves -- --pack <private-pack-path>` creates three completed seasons and a fourth opening, retains identical fixtures in an ignored output directory, then measures each in a fresh Node process. It records strict cold/warm parsing, validated writes, fingerprinted reloads and same-state compact-1/compact-2 byte sizes separately. Equality and deterministic continuation checks run outside timings. `--fixture` works with committed public fixtures; `--reuse` remeasures saved careers; `--warm 3` requests three warm samples. Reports include code/input hashes. These timings exclude browser worker messaging and IndexedDB and must not be presented as whole-interface load times.

**Measured on the corrected code:** Bundesliga, Bayern, seed 31, standard injuries, all career systems on and delegated contracts; 918 senior games over three seasons. Decimal MB below are UTF-8 bytes, not string length. The compact-1 comparison encodes the *same state* with the earlier encoding; it is not a different simulated career. One warm sample per operation, so these are observations, not statistical performance guarantees.

| State | Earlier encoding | Format 41 | Reduction | Full load, cold / warm | Previously validated local reload | Validated write + fingerprint |
| --- | --- | --- | --- | --- | --- | --- |
| Season 1 complete | 3.80 MB | 2.96 MB | 22.2% | 3.12 / 2.78 s | 0.24 s | 2.74 s |
| Season 2 complete | 6.85 MB | 5.50 MB | 19.7% | 7.81 / 6.87 s | 0.46 s | 7.41 s |
| Season 3 complete | 9.83 MB | 7.88 MB | 19.9% | 19.20 / 17.91 s | 0.63 s | 13.58 s |
| Season 4 opening | 9.52 MB | 7.85 MB | 17.5% | 15.29 / 22.64 s | 0.57 s | 27.09 s |

Every fixture passed exact-state and independent next-matchday/rollover comparison; the real pack and fixture bytes were unchanged, and the final measurement source hash was stable. Peak Node resident memory across the retained-fixture runs was about 1.0 GiB: file compression does not solve in-memory history growth. The 27-second fourth-opening write reinforces that 3.2's historical-validation work remains necessary.

Local evidence: `.artifacts/save-benchmark-2026-11-14T10-24-53-860Z/report.json`; inputs are retained in `.artifacts/save-benchmark-2026-11-14T10-15-28-454Z/`. The initial generation/timing run was intentionally stopped after retaining all four checked fixtures so writer/reader size guards could be aligned, then the final run used `--reuse` against corrected code. A separate real Edge/Vite integration check passed seven worker/IndexedDB checks: genuine format-40 migration, format-41 storage, exact page reload, Blob export/import, stale-write rejection, damaged-current recovery and strict invalid-import rejection. This was storage integration, not acceptance of future competition gameplay. Browser/server helpers were closed.

**Next implementation inside 3.2:** design a versioned historical summary that preserves financial anchors, effective registrations, academy outcomes and the club managed at each season; validate and seal completed boundaries, then validate current-season changes against those anchors. Keep compatibility and corruption tests, and remeasure the retained careers before advancing to 3.3. Do not reinstate unchecked checkpoint writing to hide the cost.

**Verification:** build passed; the full serial suite passed 2,207 tests in 141 files (563.57 seconds). The new compact-codec, validation-fingerprint, legacy-continuation and importer tests are included, with no private pack required for the ordinary suite. The existing Vite large-chunk advisory remains. Source was unchanged between the final benchmark, build/browser checks and full regression; later edits only document the result.

### Step 3.2b: faster strict historical checks (14 November 2026)

Following the owner-committed `1b7e14a`, strict validation now reuses temporary ledger, academy and financial-boundary indexes during one synchronous check. Relationship evidence is collected once per squad calculation. Prefix checks still examine every relevant row; unordered or malformed inputs retain the previous rejection semantics. None of the new validation-scoped indexes survives into a new validation, and they never cache acceptance verdicts; modifying the same object requires fresh checks. Recruitment avoids rebuilding the player catalog for each player. Every checkpoint write and portable import/export remains fully validated; the format stays **41**, with identical state and bytes.

The audit also fixed a schema/league-size mix-up: archived rosters were gated by `version >= worldRounds - 1` instead of the original format-9 threshold. Long-league careers now validate their original historical squads correctly. Local checks certificates are **version 3**; version-2 certificates require a strict recheck before a new validated save can use the fast path. A genuine simulated 24-club, 46-round career covers transfer, rollover, historical reviews and roster corruption rejection.

Remeasuring the same retained careers, with one warm sample and no concurrent heavy jobs:

| State | Format 41 bytes | Full load, cold / warm | Validated write + fingerprint | Previously validated local reload |
| --- | --- | --- | --- | --- |
| Season 1 complete | 2,957,021 | 2.60 / 2.12 s | 2.10 s | 0.25 s |
| Season 2 complete | 5,502,472 | 4.81 / 4.18 s | 4.13 s | 0.45 s |
| Season 3 complete | 7,877,419 | 8.61 / 6.85 s | 6.58 s | 0.59 s |
| Season 4 opening | 7,848,316 | 7.26 / 7.25 s | 9.57 s | 0.86 s |

Third-season warm strict loads fell from 17.91 to 6.85 seconds; fourth-opening validated writes fell from 27.09 to 9.57 seconds. These are Node observations, excluding worker messaging and IndexedDB. Byte counts are unchanged, and exact-state, independent continuation and input/source hash checks all passed. Report: `.artifacts/save-benchmark-2026-11-14T10-59-59-384Z/report.json`. A separate profile showed essentially unchanged heap use; this is a speed improvement, not bounded memory or save growth.

Build/typecheck and the focused 24-club/index/academy/relationship checks passed. Eight real Edge/worker/IndexedDB checks passed, including old-certificate fallback and reissue at checks version 3 (`.artifacts/step32b-browser-smoke-report.json`); helpers were closed. The full serial regression passed **2,232 tests across 145 files in 526.36 seconds**, with no failed or skipped cases (`.artifacts/step32b-full-tests-20261114-121005.log`). Only documentation changed after source verification.

**Still open before 3.3:** versioned bounded historical summaries and strict portable-summary validation. Finance still has its own 20,000-row limit despite the generic 200,000-entry guard; do not silently raise it. Preserve absolute journal/prefix references, academy/health/development outcomes, scouting and relationship evidence, original rosters and `managedClubFor(state, year, false)` when summarizing earlier seasons. A job change before rollover must not erase the previous club's records. Recheck memory and growth, then run the multi-league target once those systems exist.

### Step 3.2c: historical academy outcomes (14 November 2026)

The owner committed 3.2b as `11a02a9` and approved continuation. Format **42** introduces the first smaller historical domain record: older rival academy player reports retain `{ detail: 'outcome', clubId, focus, pointsAfter }` instead of repeated derived before/gain/coach/facility/availability fields. Every week, prospect membership, instruction, exact accumulated point total and week-level coach assignment remains. Youth match evidence, graduate identities and source points, senior results, finances and journal prefix counts are unchanged.

Rollover reduces reports only from completed seasons and only for clubs the manager did not manage in that season. Full detail remains for the current season, the historical managed club, the globally latest week and each club's latest nonempty week. A manager changing clubs before rollover keeps their former club's reports. Eligible full reports are also valid; ordinary continuation does not have to rewrite every older row.

**Strict migration and validation:** genuine formats 1–41 are validated in full before eligible report detail is removed; the resulting format-42 state validates again. Every strict load/write reconstructs the full weekly development from retained instructions, staff, facilities and youth health/results, then compares its projected outcome exactly. Replay advances from independently calculated points, never unverified imported totals. Wrong outcomes, extra fields, missing players/weeks, forbidden summaries and damaged legacy detail are rejected. No externally supplied seal stands in for missing evidence. Format 42 still uses `compact-2`; the schema in the local fingerprint salt invalidates format-41 certificates automatically.

This is a reduction in the historical objects retained by the running game, not just a different wire encoding. The UI still receives detailed latest reports; the academy workspace and player report contents are checked against their pre-summary presentation. The change does **not** bound the total number of weeks, replace youth fixture history, summarize finance, or eliminate all replay work. Those remain 3.2 work before the registration/calendar changes.

Genuine public format-41 fixtures were captured from unchanged `11a02a9` before editing; their hashes and provenance are in `tests/fixtures/README.md`. Independent pre-change second/third-season states are retained under `.artifacts/academy-summary-baseline-41/`. The new-format migration and continuation comparison restores discarded detail only from those original reference records, after checking every retained field, and compares the entire state. Measurements and final acceptance are recorded in the latest handover.

**Measured against the same original Bayern/Bundesliga career**, using independently verified migrated fixtures and one warm sample per operation:

| State | Previous format 41 | Format 42 | Reduction | Full load, cold / warm | Validated write + fingerprint | Previously validated local reload |
| --- | --- | --- | --- | --- | --- | --- |
| Season 1 complete | 2.96 MB | 2.96 MB | 0% | 1.74 / 1.79 s | 1.97 s | 0.21 s |
| Season 2 complete | 5.50 MB | 4.71 MB | 14.3% | 3.95 / 3.73 s | 3.43 s | 0.33 s |
| Season 3 complete | 7.88 MB | 6.39 MB | 18.9% | 6.25 / 5.34 s | 5.28 s | 0.44 s |
| Season 4 opening | 7.85 MB | 5.63 MB | 28.3% | 6.28 / 6.01 s | 5.46 s | 0.38 s |

No completed previous season exists at the first boundary, so it has no eligible summaries. At the fourth opening, 12,948 rival player-week reports become outcomes. Exact bytes decrease from 7,848,316 to 5,630,117; the academy's ordinary JSON representation decreases from 11,650,221 to 4,753,936 bytes (a structural size measure, not a measured heap guarantee). Peak Node resident memory in this benchmark remains about 0.9 GiB; bounded total history is still necessary. Timing differences are observations from separate single-sample runs, excluding browser messaging and IndexedDB.

Original fixture hashes, complete state outside the declared projection and independent original-runtime continuations all passed. The original manifest was not rewritten: `.artifacts/academy-history-42-fixtures-2026-11-14T11-33-06-980Z/comparison.json` proves migration against it and supplies a new manifest for `benchmark:saves --reuse`. Timings: `.artifacts/save-benchmark-2026-11-14T11-35-20-575Z/report.json`. Production code did not change during or after measurement; the UI test's file extension was corrected afterward to use the project's JavaScript fixture-test convention.

**Final verification:** production build passed; the full serial suite passed **2,262 tests across 149 files in 454.09 seconds**, with no failures or skips (`.artifacts/step32c-full-tests-20261114-123911.log`). Ten real Edge/worker/IndexedDB checks passed, including retained report protections, strict corrupt-outcome rejection without altering the saved career, migration, reload/recovery, stale-write rejection and certificate fallback (`.artifacts/step32c-browser-smoke-report.json`). Browser helpers were closed. The existing large-chunk build advisory remains; no source changes followed final verification.

### Step 3.2d: historical youth fixture outcomes (14 November 2026)

The owner committed 3.2c as `76fa3bd` and approved continuation. Format **43** reduces redundant frozen squad and starting-condition snapshots in eligible older rival youth fixtures. An explicit `detail: 'outcome'` record keeps the fixture's calendar and club IDs, ordered `playerIds.home`/`playerIds.away`, and the complete original result. Its `home`, `away` and `startingConditions` fields are null. Every player statistic, injury episode, score, winner and unplayed default/no-contest reason remains; even unplayed squads retain their ordered memberships.

Full records remain for the current season, fixtures involving the club managed during their season, and each club's latest completed fixture. The protection applies to both clubs in a fixture, including after a job change. Eligible older full fixtures remain valid. Rollover summarizes immutably after academy report summarization, without removing fixtures or changing sporting random state.

Historical reviews rebuild the original teams from immutable prospect identities and `academyAtBoundary` at the fixture's actual season and round. Live and historical teams share the same membership and shirt-number construction; the review verifies the retained ID order. This preserves attributes before later practice, excludes promotions already effective that matchday, and handles the final round without assuming a subsequent practice report. Reviews do not replay possessions or compute new player health. Boundary views remove the outcome marker and memberships when hiding results that had not happened yet.

**Strict migration and validation:** genuine formats 1–42 validate under their original rules before migration. Formats below 42 receive the academy projection; existing format-42 academy records keep their exact representation. Youth projection then produces format 43 and the entire upgraded state validates again. Current-format imports do not normalize optional full old fixtures. Strict replay independently prepares the original teams and starting conditions, compares the outcome's calendar/membership projection, and applies the existing full result, participation, injury and default checks. Format 43 still uses `compact-2` and checks version 3; the schema in the fingerprint salt prevents an old format-42 seal from bypassing the new validation.

The four public format-42 fixtures were captured from unchanged `76fa3bd` before editing; provenance and hashes are in `tests/fixtures/README.md`. Independent original-runtime continuations are retained under `.artifacts/youth-history-baseline-42/`. This increment made no provider API requests and changed no database or data pack.

The independently retained Bayern/Bundesliga career compares as follows. These are exact compact save bytes; the existing `compact-2` encoding already shares repeated snapshots, so the portable saving is modest even when the domain records shrink substantially.

| State | Format 42 bytes | Format 43 bytes | Reduction |
| --- | --- | --- | --- |
| Season 1 complete | 2,957,021 | 2,957,021 | 0% |
| Season 2 complete | 4,713,865 | 4,683,972 | 0.6% |
| Season 3 complete | 6,390,127 | 6,298,114 | 1.4% |
| Season 4 opening | 5,630,117 | 5,497,279 | 2.36% |

At the fourth opening, 808 youth fixtures become outcomes. The youth competition's ordinary JSON representation decreases from **10,597,942 to 6,580,498 bytes (37.9%)**. This measures structural size, not heap improvement. All result statistics and injury evidence remain. Fixture count, total memory and replay time are not bounded by this change.

All four real-career boundaries passed independent original-state/projection comparisons: `.artifacts/youth-history-43-fixtures-2026-11-14T12-16-45-457Z/comparison.json`. Five fictional original format-42 states passed both direct legacy import and ordinary continuation comparisons, including older academy representation retained exactly: `.artifacts/youth-history-baseline-42/comparison-2026-11-14T12-16-32-777Z.json`. The focused suite passed **117 tests across 10 files** (`.artifacts/step32d-focused-tests.log`).

The completed benchmark used the same migrated real fixtures and one warm sample per operation:

| State | Full load, cold / warm | Validated write + fingerprint | Previously validated local reload |
| --- | --- | --- | --- |
| Season 1 complete | 2.54 / 2.00 s | 2.19 s | 0.22 s |
| Season 2 complete | 4.81 / 4.87 s | 4.68 s | 0.38 s |
| Season 3 complete | 7.34 / 7.68 s | 7.10 s | 0.59 s |
| Season 4 opening | 6.74 / 7.06 s | 7.44 s | 0.47 s |

Report: `.artifacts/save-benchmark-2026-11-14T12-18-39-720Z/report.json`. Exact state/continuation, source hashes and seal checks passed at every boundary. These Node timings exclude browser messaging and IndexedDB. Maximum measured process resident memory was about 1 GiB; smaller JSON does not establish lower heap use.

The slower single samples compared with the preceding session prompted a paired old/current diagnostic. Across three samples, median strict read was **6.57 → 6.43 seconds** and fully validated write **6.67 → 6.62 seconds**. Both versions' first samples were much slower and subsequent samples overlapped: timings were effectively unchanged, with no meaningful speed improvement or sustained regression observed. Source, fixture and pack hashes and state equivalence all passed. Report: `.artifacts/youth-history-43-paired-2026-11-14T12-31-37-157Z/comparison.json`.

The production build passed with the existing large-chunk advisory. **Thirteen real Edge/worker/IndexedDB checks passed**, including 18 migrated youth outcomes with reconstructed original squads/jerseys/attributes, 12 protected full matches, unchanged statistics/injuries, strict member-order/stat/academy corruption rejection without changing the checkpoint, old-format seal rejection, reload/recovery and stale-write handling. Report: `.artifacts/step32d-browser-smoke-report.json`; the isolated browser/server helpers closed cleanly. The full serial suite passed **2,302 tests across 153 files in 524.50 seconds**, with no failures or skips (`.artifacts/step32d-full-tests-20261114-132303.log`). Production code remained unchanged after the source freeze; only documentation was updated after verification.

**Next within 3.2:** address financial-history growth and the separate 20,000-row finance guard without silently raising it; design independently verifiable summaries or incremental validation that preserve absolute journal prefixes, recruitment/board/facility anchors and historical manager reviews. Senior statistics, youth statistics and diagnoses, and other replay-dependent evidence remain retained. Re-measure actual memory, save growth and strict write cost before accepting 3.2. Then proceed to the roster/registration prerequisite and steps 3.3–3.7 in the table; the multi-league performance target cannot be accepted before those competitions exist.

### Step 3.2e: logical financial history and prefix accounting (14 November 2026)

The owner committed 3.2d as `3ca0e94` and approved continuation. This increment prepares financial history for archiving: it introduces one logical-ledger interface and temporary indexes for repeated accounting at historical transaction boundaries. **The save format remains 43, the encoding remains `compact-2`, and `SAVE_CHECKS_VERSION` remains 3.** The stored ledger is still the same complete array; the **20,000-row finance limit remains in force**. This step does not make saves smaller or make career history bounded.

`world/finance-ledger.ts` centralizes transaction count, absolute lookup, ordered range iteration, fresh slices/prefix views and guarded append. Prefixes retain original zero-based positions and sequential `finance-N` identities. A boundary is an exact transaction count, including transactions on the same day; it is not inferred from a calendar date. Staff appointments/releases, recruitment, scouting observations, board/commercial/facility decisions and activation records must keep those exact positions.

`world/finance-ledger-index.ts` derives club cash/unpaid/net values and per-agreement gross/net/discount/prepayment totals. Inside one synchronous `withCalculationCache` scope, fresh prefix arrays can share an index of their original ledger. Nested prefixes keep their own end position; nonzero slices remain independent. Replay-array length participates in cache keys. Aliases and indexes do not persist between validation calls, and returned totals are fresh values. Outside validation, a local payroll reader represents the ledger snapshot for that operation. No cached accounting result accepts a save or replaces strict replay.

The retained 18-club real career contains **2,515 / 4,930 / 7,313 ledger rows** after seasons 1 / 2 / 3, and **7,538 rows** at the fourth opening. Its current ledger uses 37.69% of the finance limit. The fourth-opening state contains **6,089 persisted absolute-index references across 538 distinct offsets**, including recruitment's `ledgerIndexBefore`. The largest repeated groups are 2,464 payroll rows (1,648 with zero amount), 1,836 operations rows and 1,683 facility-upkeep rows. Zero-value payroll rows still mark completed payment boundaries and cannot simply be deleted. Audit: `.artifacts/finance-growth-audit-43/report-complete.json`. At the observed later-season rate, the existing cap would be reached around season nine; this is an extrapolation, not a simulated long-career acceptance result.

Before source edits, the original `3ca0e94` runtime captured **19 states** covering ordinary second/third-season continuation, wage prepayment, paid transfers and installments, a sale after prepayment, disabled finances and a real job change. Each has original complete-state, compact-byte and accounting-output hashes. The same capture retained original balance/payroll fingerprints at all **538** real-career offsets and full fourth-opening accounting outputs. Evidence and comparison scripts: `.artifacts/finance-ledger-baseline-43-2026-11-14T12-43-21-299Z/`. The four existing real format-43 fixtures and their independent continuation hashes remain unchanged under `.artifacts/youth-history-43-fixtures-2026-11-14T12-16-45-457Z/`.

**Verification:** typecheck passed, and the focused suite passed **245 tests across 10 files** (`.artifacts/step32e-focused-tests.log`). Portable tests cover strict range boundaries, ordered appends, exact accounting against independent scans, nested prefixes, source mutation between scopes, appendable replay arrays and genuine public-fixture histories. All **19 independently captured original states** matched complete state, exact compact bytes, financial read models and ordinary continuation; all **538 real-career prefix fingerprints** matched too. Report: `.artifacts/finance-ledger-baseline-43-2026-11-14T12-43-21-299Z/comparison-2026-11-14T12-57-38-774Z.json`. The production build passed with only the existing large-chunk advisory. Thirteen real Edge/worker/IndexedDB browser checks passed with no errors, preserving budgets and financial read models through import, checkpoints, reload, Blob export and recovery. Report: `.artifacts/step32e-browser-smoke-report.json`; isolated browser/server helpers closed and their ports were released. The full serial suite passed **2,329 tests across 156 files in 492.34 seconds**, with no failures or skips (`.artifacts/step32e-full-tests-20261114-140630.log`). Production source and tests stayed frozen through the final comparisons, measurements, build, browser checks and full regression; subsequent edits only documented results.

The completed benchmark reuses the untouched original format-43 fixtures. Exact bytes, state and independent continuation passed at all four boundaries:

| State | Unchanged compact bytes | Full load, cold / warm | Validated write + fingerprint | Previously validated local reload |
| --- | --- | --- | --- | --- |
| Season 1 complete | 2,957,021 | 2.43 / 1.95 s | 2.24 s | 0.25 s |
| Season 2 complete | 4,683,972 | 4.66 / 4.30 s | 4.26 s | 0.40 s |
| Season 3 complete | 6,298,114 | 7.07 / 6.09 s | 7.90 s | 0.63 s |
| Season 4 opening | 5,497,279 | 9.57 / 9.35 s | 9.13 s | 0.54 s |

Report: `.artifacts/save-benchmark-2026-11-14T12-58-13-274Z/report.json`. These are single warm samples in Node, excluding worker messaging and IndexedDB; cold loads start in a fresh process after module loading. Maximum process resident memory across the runs was about **1.16 GiB**. This does not establish a speed or memory improvement. Total history growth and the finance cap remain unresolved.

The paired `3ca0e94`/current diagnostic passed with the same fixture, exact state/bytes and unchanged source/evidence/pack hashes. After warmup, three alternating samples measured median strict read **6.450 → 6.197 seconds** and validated write **6.571 → 6.716 seconds**. Write ranges overlapped; the earlier 9.35-second strict-read sample was not repeated. These small differences do not establish a meaningful overall speed improvement. Report: `.artifacts/finance-ledger-43-paired-2026-11-14T13-02-09-220Z/comparison.json`. Both module graphs ran in one Node process with explicit garbage collection outside timed intervals; this is still not a browser latency or bounded-memory guarantee.

**Next within 3.2:** implement proposed format-44 lossless financial archive blocks behind this interface. Preserve ordered transaction evidence, logical positions and every external anchor; do not replace old transactions with an unverified closing balance. Transaction ownership after an offseason move must use `managedClubAtLedger` at the actual ledger boundary, since decisions on the same date can belong to different managed clubs. Review per-season archive limits, active-history limits, decoder expansion limits and strict migration together before fixing new limits. No final capacity or performance guarantee is chosen here. Then measure the growing career again and finish remaining 3.2 work before the roster/registration prerequisite and steps 3.3–3.7. The owner's flags, visual strength, roster fidelity/freshness and sprint-4 rating calibration remain queued in their existing steps.

## Not in this sprint (suggestions)

- Signing players from background clubs, and background clubs signing players.
- Domestic cups and super cups (the data has them; they are not in the agreed scope).
- A full real-world licence and coefficient system for European places.
