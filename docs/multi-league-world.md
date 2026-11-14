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
| **Background club** | Clubs of leagues not chosen that play a European competition, and European clubs from countries outside the six | A real squad of twelve from the data pack, colours and arena; European games with the match engine (box scores, injuries, fitness); no finances, staff, academy, board, contracts or transfers. Their players cannot be signed in this sprint. Squads stay as in the pack during a season; at rollover they age like everyone else |
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

- **Finished seasons are sealed:** a season is checked in full when it ends, and later loads check its fingerprint and summaries instead of replaying it, so loading time stops growing with every season.
- **Lighter records for clubs the manager does not run:** weekly academy reports in detail only for the manager's club (other clubs keep their outcomes); past seasons keep full box scores for the manager's games and season totals for the rest.
- **Targets to measure:** a world of three full leagues plus Europe should load in about 5 seconds and stay well inside the 32 MB save limit after five seasons.

## League selection at career start

- The player chooses the countries to run in full (at least one). A country brings both of its divisions where it has two, so promotion and relegation always work within the full world. The three European competitions are always included.
- The screen shows an estimate of speed and save size for the selection, as FM does.
- The manager then chooses a club from the selected leagues; real clubs only, as decided.
- Below a second division (and below the German and Greek top divisions), relegated clubs leave the full world as background clubs and can return; promoted clubs come from the real next division's clubs, with squads generated where the data has no players (step 3.4 records the details).

## Steps

| Step | What | Status |
| --- | --- | --- |
| 3.1 | Data: import the other eight domestic divisions, the EuroCup and the BCL (2025-26 and 2026-27); club identities; ratings that compare every league with the European level (rating-3); a new private pack with all thirteen competitions | Done |
| 3.2 | Save checks that scale: sealed seasons and lighter records for clubs the manager does not run | In progress: validated checkpoint fast loads and lossless format 41; bounded history/write scaling remains |
| 3.3 | One calendar for several leagues: competitions in the world, game days, days without the manager's game, a table per league, amounts per week or home game | Planned |
| 3.4 | Domestic playoffs, titles, and promotion and relegation (real formats, checked per league) | Planned |
| 3.5 | European competitions in their real formats on midweek dates, with background clubs and background tables; European places for the next season | Planned |
| 3.6 | League selection at career start, with the speed and size estimate | Planned |
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

## Not in this sprint (suggestions)

- Signing players from background clubs, and background clubs signing players.
- Domestic cups and super cups (the data has them; they are not in the agreed scope).
- A full real-world licence and coefficient system for European places.
