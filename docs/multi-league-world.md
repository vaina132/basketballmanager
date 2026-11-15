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

- **EuroLeague:** 20 clubs, home and away, 38 rounds (24 September 2026 to 16 April 2027). Places 1-6 reach the playoffs; 7-10 play the Play-In (7 v 8: winner is seed 7; 9 v 10: loser is out; the loser of 7 v 8 meets the winner of 9 v 10 for seed 8; single games at the higher seed). Playoffs best of five (1 v 8, 2 v 7, 3 v 6, 4 v 5; games 1, 2 and 5 at the higher seed). Final Four: single-game semi-finals and final at one venue; there has been no third-place game since 2025-26 (research of 15 November 2026 in `competition-rules-2026.md`). Sources: [EuroLeague format](https://www.euroleaguebasketball.net/euroleague/news/format-el), [EuroLeague 2026-27 schedule](https://eurohoops.net/en/euroleague/1994855/euroleague-releases-full-schedule-for-the-2026-27-season), [20-team field confirmed](https://www.eurohoops.net/en/euroleague/1984894/euroleague-confirms-20-team-field-expansion-plans-and-franchise-roadmap/).
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
| 3.2 | Save checks that scale: sealed seasons and lighter records for clubs the manager does not run | Single-league implementation and verification complete. Combined-world capacity/load acceptance remains at 3.7 |
| 3.1 follow-up / 3.3 prerequisite | Distinguish full club rosters, competition registration and matchday selection; preserve variable real roster sizes and audit fresh API memberships | In progress: profile audit and full club/matchday roster separation implemented; membership reconciliation and competition-specific registration remain |
| 3.3 | One calendar for several leagues: competitions in the world, game days, days without the manager's game, a table per league, amounts per week or home game | Domestic regular-season integration implemented: shared weekly careers, real byes, separate tables, weekly settlement, saves and UI. Midweek event processing will extend this at 3.5 |
| 3.4 | Domestic playoffs, titles, and promotion and relegation (real formats, checked per league) | In progress: French regular-season rankings, game days inside a week, every league's postseason and promotion/relegation inside the full world are done (3.4a-c). Tie-break rules done (3.4e): France LNB, Spain ACB, Germany BBL and Italy FIP; the FIBA default elsewhere. Clubs leave and join the full world at season ends where the world lists a next division (3.4d-1 to 3.4d-2). Remaining: screens (3.4d-3) and real next-division names (3.4d-4, local-only) |
| 3.5 | European competitions in their real formats on midweek dates, with background clubs and background tables; European places for the next season | Planned |
| 3.6 | League selection at career start: country flags/names, league/division, visual squad strength, actual roster counts and the speed/size estimate | Multi-country domestic selection, both available divisions, flags, readable division, strength and roster counts implemented. Measured estimates and European inclusion remain |
| 3.7 | Final check: a multi-league season with Europe in the browser, save and load, rollover into season two, measurements | Planned |

Order as approved on 14 November 2026. Each step is tested and recorded in `HANDOVER.md`; the owner commits.

### Plan for step 3.5 (checked 15 November 2026)

The proposed split was checked against "Levels of detail", "Competition formats" and "One calendar" above; it covers them in dependency order. Research of the open questions is in `competition-rules-2026.md` ("European competitions: research for step 3.5").

| Step | What |
| --- | --- |
| 3.5a | The three competitions and their 2026-27 entrants in the world. Entrants from leagues that were not chosen, and from countries outside the six, become background clubs with their real pack squads, colours and arena (like next-division clubs, built into the world outside the full world). New format. |
| 3.5b | Midweek European game days on the shared calendar (EuroCup and BCL Tuesday and Wednesday; EuroLeague Thursday, and Tuesday in double-round weeks), draws at the season start (BCL country protection), and conflict checks with domestic postseason slots. Background clubs play with the match engine (legal matchday selection, box scores, injuries, fitness). |
| 3.5c | EuroLeague: 38 rounds, play-in 7-10, best-of-five playoffs (2-2-1), Final Four without a third-place game. |
| 3.5d | EuroCup: four groups of eight, best-of-three eighth-finals to finals. |
| 3.5e | BCL: two single-game qualification tournaments, eight groups of four, best-of-three play-ins, Round of 16 groups by the draw pattern, best-of-three quarter-finals, Final Four with a third-place game. |
| 3.5f | Estimated background tables for unchosen leagues and next season's European places. Reversible default to confirm then: the EuroCup champion takes a one-year EuroLeague place (the runner-up only if two are open) and keeps it by reaching the playoffs, at most twice; discretionary one-year wildcards (Paris and Beşiktaş in 2026-27) go to the best domestic finisher of the six countries not yet qualified, as the plan's default. |
| 3.5g | A Calendar view of the whole season and the European Competition screens. |

### Plan for the rest of 3.4 (15 November 2026, Claude continuing after Codex)

The owner approved continuing the plan on 15 November 2026 and the recommended source of promoted clubs: real lower-division club names from API-Sports, with generated players (as Football Manager does). Steps, in order:

| Step | What | Status |
| --- | --- | --- |
| 3.4a | **Game days inside a week.** A calendar week can hold several game days. Its Saturday stays the week's decision day (signings, offers, reviews keep their dates), and extra game days follow it in the same week (Tuesday, Thursday). Continue plays one game day at a time. Wages, upkeep, staff, board and the other weekly management still run once per week, after the week's last game day. Players rest between game days (ordinary daily recovery); practice runs from the week's last game day to the next Saturday. Needed by the playoffs and, at 3.5, by midweek European games. | Done (15 November 2026) |
| 3.4b | **Domestic postseason:** each league's sourced 2026-27 format (play-ins, best-of-three/five/seven series, Primera FEB's one-venue final stage, Serie A2's play-outs) on dates reserved after the regular season. A series stops when it is decided; reserved games that are not needed are not played. Champions and final placings; regular-season tables stay separate. | Done (15 November 2026) |
| 3.4c | **Promotion and relegation inside the full world:** between a chosen country's two divisions, by each league's counts, with each season's memberships recorded (the opening `world.domesticLeagues` stays unchanged). | Done (15 November 2026) |
| 3.4d | **Clubs leaving and joining the full world:** relegated clubs leave as background clubs and can return. Promoted clubs come from the real next division (names from API-Sports, generated squads, labelled as generated). Owner decisions (15 November 2026): a manager whose club leaves the full world is treated as dismissed, with at least one job offer at a full-world club; Italy and France have no relegation out of the full world for now. | 3.4d-1 (format 53), 3.4d-2a (next-division clubs in the world, format 54), 3.4d-2b (the exchange, format 55) and 3.4d-3 (screens) done 15 November 2026; real names need 3.4d-4 (local-only) |
| 3.4e | **Tie-break rules for the remaining leagues:** FIBA Official Basketball Rules 2026, Appendix D, as the labelled default; league-specific rules where sourced (France done). | Done 15 November 2026: 3.4e-1 (FIBA default, format 51) and 3.4e-2 (ACB, BBL and FIP rules, format 52; Greece and Turkey keep the default). Moved before 3.4d on 15 November 2026: it needed no private data |

### Step 3.4c: promotion and relegation inside the full world (15 November 2026)

Each season now records its divisions (format 50: `SeasonState.divisions`, copied into the season's archive; `src/world/divisions.ts`). At the end of a season, within each country, the first division's relegated clubs and the second division's promoted clubs change places by the two leagues' postseason outcomes; division sizes are unchanged. France's 15th club stays up when it wins the second division's promotion final. Schedules, league tables, playoffs, youth leagues, board objectives, sponsor bonuses, job offers, the club summary and the Competition screen all use the season's own divisions, archived seasons included. The save checks recompute every season's divisions from the opening leagues and each completed season's outcomes. Careers saved in format 49 begin moving clubs at the end of their current season; a genuine format-49 season-two career (`tests/fixtures/season49-divisions-legacy*`) upgrades and continues exactly. Clubs relegated out of the game's leagues stay until 3.4d, and the playoff panel says so.

Verification: `tests/division-changes.test.js` (3: a two-division career across a season end with strict saves, the new schedule and refusal of divisions that do not follow the results; France's 15th rule and unbalanced counts; the format-49 upgrade). Full serial regression **2,521 tests / 179 files passed**; build passed. **Private real data:** a full Spanish season (ACB and Primera FEB, 36 clubs, every system) took 341 s. FC Barcelona won the ACB; Básquet Coruña and Obradoiro went down and Fundación CB Granada (first) and HLA Alicante (playoff winner) came up. Season two has 18 clubs in each division; its opening save is 3.90 MB and strictly reloads identically (18 s strict check; the game's own sealed loads skip it); two more weeks also reload identically.

### Steps 3.4a-3.4b: game days inside a week and domestic postseasons (15 November 2026)

Every league in scope now ends its season with its real 2026-27 postseason (`src/world/postseason.ts`, sources in [competition-rules-2026.md](competition-rules-2026.md)). After the longest league's regular season, the calendar reserves postseason weeks with three game slots each (Saturday, Tuesday, Thursday). Seeds come from each league's final regular-season table, and the French second division's bracket takes the top division's 15th club as seed 5. Each series is created game by game from results; a decided series plays no further games. Champions, promotions and relegations are derived (`postseasonOutcome`). The divisions themselves do not change yet: that is 3.4c-3.4d.

The live career plays one game day at a time. The week's Saturday stays its decision day and weekly management runs after the week's last game day. Players rest between game days; practice runs from the week's last game day to the next Saturday. League tables, board targets, sponsor bonuses and job positions use regular-season games; gates, injuries, fitness, statistics and morale count every game. Format 49 stores the formats on the world's leagues and the stage on postseason games. The save checks rebuild each season's games from its own results and check fitness through every game day. Worlds from earlier formats keep their regular season only.

The Competition screen shows each league's playoffs: series by stage with seeds, scores, the next game or the club that advanced, and once decided the champion, promotions and relegations. Playoff games carry their stage ("Semi-final · Game 2"). The season progress reads "Playoffs · week 1 of 2" and the current game day. A playoff day without the club's game says "No game today" rather than "Rest week".

Verification:
- **Full serial regression: 2,518 tests / 178 files passed (638 s); typecheck and production build passed.** `tests/postseason.test.ts` (8), `tests/domestic-postseason-career.test.js` (2: a full two-league career with playoffs, strict save/load at every game day, the playoff panel, rollover and season two), `tests/season48-continuation.test.js` (genuine format-48 career continues exactly).
- **Private real data (pack 3):** all six countries build with their formats (seasons of 30-44 weeks: Greece 30, Turkey and Spain 39, Germany 40, France 43, Italy 44). A full German season with every system: 34 weeks and the playoffs in 129 seconds. Seeds were Bayern Munich, Gladiators Trier, MHP Riesen Ludwigsburg and Niners Chemnitz; Rostock beat Chemnitz 3-2 in a quarter-final; **Gladiators Trier won the final 3-2 against Bayern**. Veolia Towers Hamburg and Bamberg Baskets were relegated, and the season ended on 5 June 2027. The season-end save is 3.16 MB and strictly reloads identically, with strict save/load also passing every third step of the playoffs. This run found and fixed one rule mismatch: the capacity of a midweek home game now uses that day's arena capacity in both the game and the checks.
- **Browser (headless Edge, production build):** imported a public playoff-week save; "Playoffs · week 1 of 2" on Tuesday with three series and the managed one highlighted; Tuesday's playoff game played through the match screen, after which the series updated and the club advanced 2-0; Thursday reads "No game today"; reload and Continue saved career gave an identical playoff panel; no overflow at 1024 px; no page errors (an Edge extension's own message was ignored).

Open in this step: player statistics on the Competition screen combine regular-season and playoff games (suggestion: separate views); Primera FEB's one-venue final stage still gives the listed home club its usual advantage.

### Continuation on 15 November 2026

**Latest 3.4 increment:** format 48 stores an optional league ranking rule. New French first/second divisions use LNB win percentage and recursive head-to-head rules, including partial-season isolated clubs and a reproducible final draw. The Competition screen, sponsor decisions, career positions and strict save checks share the same table. Existing worlds retain their original ranking and independent format-47 continuation evidence. Other domestic rules remain provisional. This is the first standings/seeding prerequisite, **not completed playoffs or promotion**; those must extend game-day processing without charging weekly obligations for each extra game. See the latest [handover](../HANDOVER.md) for verification.

**Latest domestic integration:** format 47 connects league membership, aligned weekly schedules, manager byes and league tables to careers, workers, strict save/load and management. All ten real domestic leagues can start, including TBL. The selected country's available divisions are always loaded; more countries can be selected. Legacy embedded worlds keep their original calendar. See the latest [handover](../HANDOVER.md) for verification and limitations. The paragraphs below describe the earlier foundation checkpoint, before this integration.

Final verification for the domestic integration: **2,495 tests / 173 files passed**, production build passed, and six real Edge checks passed without browser errors. All ten real domestic leagues and a 51-club, three-league career passed private opening/advance/strict-save checks. Postseason, Europe and the five-season combined-world performance target remain unimplemented/unaccepted as listed above.

An all-country correctness check also passed (173 clubs, 2,335 players, one completed week, 4,210,677 compact bytes). Its combined creation/advance/repeated strict roundtrip script took roughly ten minutes alongside regression, so this does not establish acceptable loading or turn speed. Large-world phase profiling remains necessary at 3.7.

The owner requested the remaining work up to Sprint 4. **That boundary has not been reached.** The latest pack is a source-correlated membership revision: 27 corrections, 630 unchanged assignments confirmed, EuroCup field corrected to 32. Unresolved membership and registration evidence remains explicit; see [player data quality](player-data-quality.md#membership-revision-15-november-2026).

New competition foundations provide odd/even double round robins, aligned domestic weekends, overlap/rest/offseason checks, weekly calendar boundaries independent of fixtures, nullable manager games, separate tables, play-ins, best-of-three/five series and cancelled unused games. Registration lists are distinct from employment and selection; sourced eligibility is three-state, so missing homegrown/passport facts stay unverified. **These modules are not yet connected to `SeasonState`, saves, budgets, training, scouting or the match viewer.** They do not make the 17-club TBL or Europe playable yet.

The independently usable setup visuals were implemented alongside data review: six offline SVG country flags, country buttons, country/division labels, actual roster counts and a position-weighted best-eight squad-strength bar. No speed/save-size estimate is invented before the integrated measurements exist.

Current rule sources and unresolved questions are recorded in [competition-rules-2026.md](competition-rules-2026.md). In particular, the linked BCL regulation PDF is for 2025–26 despite being linked from the current page; the EuroLeague third-place assumption is not established by the current format page. Those gaps must be resolved before claiming full real-format coverage.

Next is the actual 3.3 career integration, then domestic postseason/promotion, Europe/background leagues/qualification, complete setup and five-season acceptance. Do not mark 3.4–3.7 complete from isolated helpers. Preserve the original format-46 fixture captured from `2b2222a` before calendar integration.

Verification of this increment: 2,489 tests / 172 files passed, production build passed, nine private real-league start/advance/strict-save checks passed, and nine Edge checks passed with no browser errors. Source/tests stayed unchanged through final full regression, build and browser checks. Details and remaining work are in the latest handover.

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

### Profile correctness and hiring fix (14 November 2026)

Following completed single-league 3.2 work, the owner reported incorrect Efes positions and a black screen after hiring a coach. The crash came from three UI workspaces using the small authored coach list while recruitment used the expanded directory. Staff, Training and Club now resolve the full directory, including released staff and saved careers. Regression tests and a real-browser Hire → Training → Club → save/reload → release flow cover the defect.

The next prerequisite has started with a complete 280-endpoint read-only provider audit. A separate private `2026.11-world-2` revision corrects 630 profiles against official evidence, including Kai Jones C and Collin Malcolm SF; broad or missing source positions remain explicitly estimated. Club assignments and ability values are retained. **166 conflicting provider memberships, 199 unmatched official registrations and 17 additional provider identities still need reconciliation.** These categories overlap. Full roster separation, opening-day verification and competition participant reconciliation remain open. See [player data quality](player-data-quality.md) for evidence, limitations and the repeatable workflow.

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

### Step 3.2f: lossless financial archives (14 November 2026)

The owner committed 3.2e as `1826be5` and approved continuation. **Format 44 / compact-2** now archives whole completed financial seasons at rollover, including their offseason decisions. The active tail stays small. All logical transaction IDs, ordering, values, detailed payments and absolute journal anchors remain exact; zero payroll markers are retained. The logical adapter reads blocks without keeping a permanent complete duplicate. Club history and all three budget rules/labels are unchanged.

Strict loading first checks archive structure and expansion limits, then reconstructs a temporary complete ledger for every existing accounting and historical-command check. Formats 1-43 pass their original validation before migration and validate again afterward. Current-format files are never silently repaired. Checks version 3 is unchanged; the new schema changes the local fingerprint salt. Portable imports/exports and checkpoint writes remain strict.

The limits are explicit: **20,000 active-tail rows, 20,000 rows per completed-season block, 100 archive blocks and 200,000 logical rows**, alongside the unchanged 32 MiB file, 16-million-value, 200,000-element collection and depth-40 bounds. Original formats still have their 20,000-total guard before migration. Temporary multi-season validation prefixes can exceed 20,000 rows; appends check the season being written and the logical total. These finite limits do not establish unlimited careers or combined multi-league capacity. Other history limits still apply.

**Independent evidence:** four genuine public format-43 fixtures were captured from unchanged `1826be5` before source edits. All 19 prior-runtime states and financial read models, including paid transfers, salary prepayments and a job move, match after lossless reconstruction. All 538 real financial-prefix fingerprints also match. Final report: `.artifacts/finance-ledger-baseline-43-2026-11-14T12-43-21-299Z/archive-comparison-2026-11-14T14-37-16-299Z.json`. Four retained real-league states also match their original complete logical-state and independent next-step hashes; original fixtures/manifests and the private pack remain unchanged. New measured fixtures and comparison: `.artifacts/finance-archives-44-fixtures-2026-11-14T13-39-44-172Z/`.

| State | Original / new compact bytes | Cold / warm strict load | Validated write + seal | Verified local reload |
| --- | --- | --- | --- | --- |
| Season 1 complete | 2,957,021 / 2,957,021 | 3.19 / 3.20 s | 3.03 s | 0.35 s |
| Season 2 complete | 4,683,972 / 4,610,510 | 5.97 / 5.75 s | 5.81 s | 0.62 s |
| Season 3 complete | 6,298,114 / 6,150,120 | 10.06 / 9.20 s | 8.67 s | 0.75 s |
| Season 4 opening | 5,497,279 / 5,201,096 | 10.10 / 9.24 s | 8.62 s | 0.60 s |

Fourth-opening saving: **296,183 bytes (5.39%)**. Its finance subtree's ordinary JSON falls from 2,389,452 to 1,556,358 bytes (34.87%); that is structural payload, not heap usage. All **7,538 logical transactions** remain: three blocks hold 7,313 old rows and the active tail holds 225. The final benchmark passed exact current state/bytes, original-runtime continuation and source/input guards at every boundary. Report: `.artifacts/save-benchmark-2026-11-14T14-37-17-968Z/report.json`. Peak diagnostic RSS across fresh Node processes was about **1.23 GiB**. These single samples exclude browser messaging/IndexedDB and do not establish a general speed or memory improvement. They supersede the earlier pre-optimization timing samples, which varied even on the unchanged verified-reload path.

**Performance regression caught and fixed:** repeated balance/payroll queries and ticket-price candidate forecasts initially expanded archived rows unnecessarily. A paired ordinary-matchday diagnostic against pinned `1826be5` measured a median increase from 2.898 to 13.006 seconds. Direct tuple amount/payload reads now avoid that reconstruction without caching totals or changing decisions. The final three alternating old/current samples measured medians **2.904 / 2.995 seconds**; all complete next-state hashes and original-input/source guards matched. Report: `.artifacts/finance-archives-advance-paired-2026-11-14T14-31-33-512Z/comparison.json`. The large regression is removed; these samples do not establish a speed improvement.

**Financial capacity passed:** an ordinary 26-club fictional career with finance/payroll enabled reached season 6, round 33: **20,012 transactions**, five archive blocks, 2,356 active rows and a **6,206,322-byte** strict save. Other management systems were disabled to isolate the financial check. Strict roundtrip and identical archived/expanded/reloaded next steps passed. Report: `.artifacts/finance-archives-26-capacity-2026-11-14T14-12-28-625Z-report.json`. The retained file was rechecked after the performance fix, also matching the pinned old engine's equivalent expanded in-memory next state, rejecting altered archived payments and retaining the 20,000-active-tail guard: `.artifacts/finance-archives-capacity-recheck-2026-11-14T14-34-57-297Z.json`. This is not full-management or combined multi-league acceptance.

**Verification:** typecheck and production build passed with only the existing large-chunk advisory. The final focused archive/accounting suite passed **87 tests across five files**; earlier focused storage checks passed 83 tests. **Thirteen real Edge/worker/IndexedDB checks passed without browser or worker errors**, preserving original budgets/accounting through migration, import/export, reload and recovery and rejecting damaged archived evidence. Report: `.artifacts/step32f-browser-smoke-report.json`; helpers closed and ports were released. **Final full serial regression passed all 2,354 tests across 157 files in 727.75 seconds**, with no failures or skips (`.artifacts/step32f-full-tests-final.log`). Source/tests/scripts stayed frozen throughout the final comparisons, measurements, build, browser and regression checks; subsequent edits only document results.

**Open findings from stress diagnostics:** before the direct-read fix, the full-management real career reached the sixth opening (12,304 rows), then was deliberately stopped after roughly 21 minutes. It did not establish >20,000 capacity and does not measure the fixed runtime. Profile the fixed full-management career with progress/checkpointing next. A separate 40-club financial test exposed the existing annual-calendar problem: 78 weekly rounds overlap the next opening and cause negative offseason recovery. Record this for 3.3; the successful 26-club/50-round financial test avoids that calendar conflict.

**Next within 3.2:** assess remaining lifetime history/resource growth and the cost of validating complete careers on each write. Archives remove repeated representation, not the underlying number of records. Do not mark bounded history, incremental validation or the multi-league performance target complete. After the remaining 3.2 work, resolve full rosters versus competition/matchday registration, then 3.3 calendar/byes, 3.4 domestic formats/promotion, 3.5 Europe/background clubs, 3.6 flags/selection/visual strength, and 3.7 integrated acceptance. Rating calibration remains sprint 4.

### Step 3.2g: career calculations and resumable diagnostics (14 November 2026)

The owner committed 3.2f as `5bedc0d` and approved continuation. CPU profiling identified repeated historical squad reconstruction and AI staff affordability queries. Registration reconstruction now shares per-boundary catalogs and contracts grouped by club, preserving catalog/arrival order and jersey assignment. All six AI staff roles evaluate candidates in a short calculation scope on unchanged state; the scope ends before an appointment, whose normal command rechecks funds. No new persistent cache, save-format change, evidence reduction or budget/rule change.

Three alternating comparisons against pinned `5bedc0d` on the real fourth opening measured median matchday progression **2.117 to 1.573 seconds (25.7% lower)**. Strict read remained effectively unchanged (**6.335 / 6.399 seconds**); validated-write medians were **7.106 / 6.366 seconds**, with overlapping ranges. Complete state, exact save bytes, next matchday and all 136 historical registration boundaries matched. Report: `.artifacts/step32g-paired-2026-11-14T14-59-46-128Z/comparison.json`. These Node samples do not establish general loading, browser-latency or memory improvements.

New opt-in command: `npm.cmd run benchmark:career -- --fixture PATH --seasons 2`. It continues the systems already enabled in an existing JSON/gzip save, retains progress, strictly checks and retains each season end/opening, and checks final reload continuation. Resume with a retained checkpoint as the next `--fixture`. `--max-seconds` is checked between synchronous operations; an incomplete run retains earlier checkpoints and reports failure. Outputs default to local/ignored `.artifacts` and may contain private data. Run separately from other heavy checks.

The 18-club full-management career passed **68 matchdays and two rollovers from the fourth opening to the sixth**, with five strict roundtrips and identical reload continuation. Total including checks: **200.18 seconds**, peak process RSS about **1.35 GiB**. Independent simulation of both seasons with the pinned original engine matched every checkpoint's complete state and exact save bytes, plus the final next matchday. Evidence: `.artifacts/career-benchmark-2026-11-14T15-05-14-505Z/report.json` and `original-runtime-comparison.json`. Original inputs, manifests and pack remain untouched.

| Boundary | Compact bytes | Logical financial entries | Strict write / read |
| --- | --- | --- | --- |
| Season 4 end | 7,724,095 | 9,691 | 7.69 / 7.71 s |
| Season 5 opening | 6,753,746 | 9,918 | 9.08 / 7.79 s |
| Season 5 end | 9,303,360 | 12,071 | 10.21 / 10.06 s |
| Season 6 opening | 8,294,537 | 12,304 | 9.98 / 9.80 s |

**Verification:** typecheck and 67 focused tests across seven files passed. The production build passed with its existing large-chunk advisory. Thirteen real Edge/worker/IndexedDB storage checks passed without errors; isolated helpers exited and ports were released. A deliberately tiny diagnostic time budget produced the expected failure report/exit without claiming a completed career. **Full serial regression passed all 2,358 tests across 158 files in 421.16 seconds**, with no failures or skips (`.artifacts/step32g-full-tests.log`). Source/tests remained unchanged during the final build, browser and regression run.

**Remaining 3.2 work:** full-history validation/write cost and retained evidence still grow. This demonstrates five completed seasons in one full domestic league, not three leagues plus Europe, unlimited careers or full-management capacity above 20,000 transactions. Use retained checkpoints for subsequent replay/history work instead of regenerating inputs. The 40-club calendar issue remains for 3.3. Roster fidelity/freshness, calendar, domestic formats, Europe, selection and rating calibration retain their existing place in the plan.

### Step 3.2h: registration replay boundaries (14 November 2026)

The owner committed 3.2g as `2f9c899` and requested the next increment. Profiling the retained sixth opening found recruitment validation rebuilding identical squads for every past matchday. Storage now reconstructs opening squads and the registration engine's existing contract/transfer effective-start boundaries. Complete player records determine whether a snapshot is added; exact snapshot arrays, final squads and every original journal check still apply. Boundaries are derived fresh for each historical prefix, with no acceptance cache. Save format 44, compact-2, checks version 3, retained history, UI and gameplay rules are unchanged.

Three alternating old/current samples on the untouched six-season career measured strict-read medians of **9.863 / 8.118 seconds (17.7% lower)** and validated-write medians of **9.523 / 8.712 seconds (8.5% lower)**. Strict-check ranges did not overlap in this run. Matchday advancement medians were **1.479 / 1.635 seconds**, with overlapping ranges; no matchday performance improvement is claimed. These are fixture-specific Node timings, not browser latency, memory acceptance or a broad performance guarantee. The save remains **8,294,537 bytes**.

All state, exact save bytes, next-matchday outcomes and **204 registration boundaries across seasons 1-6** match pinned `2f9c899`. Source and input hashes are unchanged. The input hash also matches its independently retained original report. Evidence: `.artifacts/step32h-paired-2026-11-14T18-49-48-040Z/comparison.json`; CPU profile: `.artifacts/step32h-profile-2026-11-14T18-40-48-780Z/`. No original fixtures, reports or manifests were regenerated.

Thirteen new tests compare genuine old careers with exhaustive every-matchday reconstruction, preserve original roster data, roundtrip current saves and reject damaged contracts/transfers/rosters after prior validation. **164 focused tests / 7 files passed** in 15.87 seconds. Typecheck and the production build passed with the existing large-chunk advisory. **13 real browser/worker/IndexedDB checks passed without errors**; helpers exited and ports were released. **Full serial regression passed all 2,371 tests across 159 files in 458.06 seconds**, without failures or skips. Logs: `.artifacts/step32h-focused-tests.log`, `step32h-build.log`, `step32h-browser-smoke-report.json` and `step32h-full-tests.log`. Source/tests/scripts stayed unchanged through final measurements and checks; later edits only document the results.

**Overall 3.2 is still in progress.** Remaining whole-history replay costs, retained-history growth and resource limits need work using the existing later-season checkpoints. Academy, relationship and board replay are other profile candidates. Shared multi-league/European gameplay, odd-club byes, the 40-club annual-calendar issue, full roster/registration separation, freshness, selection visuals and ratings remain in the order above. Do not mark this targeted optimization as multi-league acceptance.

### Step 3.2i: relationship evidence windows (14 November 2026)

The owner committed 3.2h as `75deff4` and requested the next increment and a plan update. Profiling the retained sixth opening found morale-history validation taking about 1.8-2.1 seconds. It now reads the latest four eligible playing-time games, latest four recent results after activation/current stint, and each promise's first three eligible games within its original deadline/departure limits. Ordered player role/talk lookups are shared inside one fresh club calculation. This preserves chronological arithmetic, all original evidence and complete report/promise history; it introduces no persistent cache or changed rules, format, UI or data pack.

Before edits, eight genuine public saves were read using untouched `75deff4`, recording complete report fingerprints for 470 players. The new baseline JSON includes original source/fixture hashes. Eight compatibility tests and three policy cases preserve original views and exercise excluded recent games, promise deadline/future-date handling and a newly appended role on the same object. **Typecheck and 79 focused tests / 6 files passed** in 14.53 seconds. The production build passed with the existing large-chunk advisory, and **13 browser/worker/IndexedDB checks passed without errors**. **Full serial regression passed all 2,382 tests across 160 files in 441.08 seconds**, without failures or skips. Helpers exited and ports were released. Logs: `.artifacts/step32i-focused-tests.log`, `step32i-build.log`, `step32i-browser-smoke-report.json` and `step32i-full-tests.log`. Source/tests/scripts stayed frozen through measurements and final verification; later edits only document results.

The three-sample whole-operation comparison passed exact state, bytes, all relationship reports, next matchday and 204 registration boundaries, including original retained checkpoint/continuation hashes. Median strict read **8.716 / 8.436 seconds**, validated write **8.818 / 8.544 seconds**; ranges overlap and a current strict read reached 11.495 seconds. No reliable overall load/save gain is claimed. Its apparent matchday slowdown (1.603 / 1.760 seconds) did not recur in a separate five-sample comparison (**1.184 / 1.125 seconds**, overlapping ranges). Five alternating isolated relationship-validation samples measured **1.139 / 0.585 seconds (48.6% lower)** with separated ranges. The save remains **8,294,537 bytes**. These are Node timings for one retained career, not browser latency, memory acceptance or combined-league capacity.

Evidence: `.artifacts/step32i-profile-2026-11-14T19-26-13-930Z/`, `.artifacts/step32i-paired-2026-11-14T19-32-23-617Z/comparison.json`, `.artifacts/step32i-isolated-2026-11-14T19-37-52-110Z.json`. Source/input guards and original next-step equality passed; original fixtures/reports/manifests were not regenerated.

**3.2 remains in progress:** total-history growth, resource limits and incremental strict validation are still open, with academy/board replay also prominent in the profile. Next comes roster/registration separation and freshness, then steps 3.3-3.7 above and sprint 4 rating/match calibration. Core single-league management and data import are implemented; the shared multi-league European world is not yet implemented.

## Step 3.2 completion: senior history and bounded replay reuse (14 November 2026)

The owner requested the remaining 3.2 work together. Format **45** now summarizes completed senior rival games into exact season totals plus the per-match participation/minutes/fouls needed by scouting, morale and injury checks. Full manager-game box scores remain, using the club managed in that historical season. Current-season detail stays full, and genuinely unavailable old statistics remain unknown. The small UI changes distinguish season totals from detailed logs. Format-44 and older evidence is checked before migration; summaries have independent membership, timing, participation and statistical invariants, not an imported proof of omitted box scores. See [architecture](architecture.md#senior-season-summaries-and-format-45).

Strict validation reuses pure academy-week and board calculations only when every typed input matches exactly. The codec's private cache interns shared field shapes and fixed blocks of long input keys, stores results with the existing compact codec and returns independent objects. It is bounded to a conservative 64 MiB payload/metadata allowance and 250,000 entries; overflow falls back to ordinary computation and suspends cache construction for later checks with the same or larger club-season workload. Smaller workloads/reset/new workers may retry; this hint affects caching only. Legacy evidence is checked without filling this cache, then its migrated current representation can use it. Every record comparison and chronology/accounting guard still runs. No cache is persisted, imported, or used to authorize a game command. Inputs are walked again on each check; in-place changes and validation failures inside the replay scope cannot reuse stale facts. Non-JSON-exact outputs, including signed zero, are recomputed. Current schema 45 and checks version 3 invalidate older format seals through the existing format salt.

Four genuine public format-44 fixtures and the original real-career read models were captured from untouched `7f76294` before implementation. Existing fixtures/manifests remain unchanged. Tests compare all season totals, original manager match logs, historical ownership, relationships and migration; the legacy test helper restores omitted detail only from retained original games after checking every summary field. The full original/current five-season comparison also passed exact declared state/next-matchday projections and all 204 registration boundaries.

On the same real 18-club career with five completed seasons, three alternating old/current Node samples measured:

| Operation | Previous 44 | Current 45 |
| --- | --- | --- |
| Sixth-opening save | 8,294,537 bytes | 7,737,744 bytes (6.71% smaller) |
| Repeat strict load, median | 14.616 s | 9.842 s |
| Validated write, median | 16.856 s | 10.192 s |
| Verified local reopen, median | 0.931 s | 0.883 s |
| Ordinary next matchday, median | 2.402 s | 2.483 s |

Strict-check medians are lower, but **all operation ranges overlap** and timings varied substantially between runs; do not claim a reliable percentage improvement or a general hardware guarantee. The current write samples range from 9.722 to 17.208 s. Cold strict read was 16.262 / 13.026 s in this final run; the earlier run had a slower current cold read while building reusable calculations. First old-format migration took 32.989 s because original evidence and the migrated state both validate. These are fixture-specific Node results, not combined-world acceptance. The cache retained 47,015,342 budgeted bytes / 141,074 entries without eviction for repeated operations. A smaller initial cache was ineffective on the long fixture; shared keys, compact results and the explicit bounded budget replaced it. Final source-frozen report: `.artifacts/step32-completion-compare-2026-11-14T21-05-29-431Z/report.json`; original input/source hashes and every equivalence guard passed. The earlier comparison at `20-40-42-119Z` predates admission backoff and the legacy-cache bypass; keep it as historical evidence, not the final implementation's timing claim.

### Extended full-management capacity

The real 18-club career continued with all enabled management systems to **season 10 opening**, retaining nine completed seasons and **21,847 logical transactions**. This exceeds the former lifetime transaction ceiling without turning off academy, staff, board or transfer behavior. Strict checkpoint roundtrips, final reload continuation, original input-state immutability and source/input hash guards passed.

| Boundary | Save bytes | Logical transactions | Strict write / read |
| --- | --- | --- | --- |
| Season 9 opening | 12,019,396 | 19,465 | See retained report |
| Season 9 end | 14,559,395 | 21,604 | 73.03 / 36.50 s |
| Season 10 opening | 13,464,963 | 21,847 | 49.53 / 37.12 s |

The final opening retains 243 active transactions, nine financial blocks, 1,625 contracts, 444 academy prospects, 297 academy weeks and ten youth seasons. The resumed diagnostic passed in 579.99 s with peak Node RSS **1,968,292 KiB (about 1.88 GiB)**. **Strict save/import costs remain high at this age**, even with bounded cache admission; they require further profiling in integrated 3.7 acceptance before broader release. File size still grows with retained history. A verified local reopen does not rerun these strict operations.

The first leg, `.artifacts/career-benchmark-2026-11-14T20-44-45-806Z/`, retained verified checkpoints through season 8 end and was explicitly stopped while checking the following opening to implement admission backoff. Its `stopped.json` records the interruption; it is not a whole-command pass. The successful resumed run is `.artifacts/career-benchmark-2026-11-14T20-55-30-169Z/`, with final save SHA-256 `01e972e7966d78e71bf1da3dd2f738804e1ac283ea02bf28e7af1d1f72e975cb` and state SHA-256 `309d6547556af47575dff7466a5bad02051980028cb1b55ea3cc9dfcba783672`. Outputs may contain private data and stay ignored.

**Acceptance boundary:** all record forms in the original 3.2 design now exist (local validation fingerprints, rival academy/youth outcomes, financial archives and senior season totals), with bounded replay reuse for unchanged calculations. This does not make total lifetime history constant in size or promise infinite seasons in a fixed 32 MiB file. Existing file, expanded-value, journal and financial-segment guards remain. The actual **three full leagues plus Europe / five-season / approximately five-second local load** acceptance must run at 3.7, after the calendar, competitions and registration systems exist; adding independent league file sizes is not a substitute. Roster fidelity/registration and freshness come next, before 3.3; no country-selection or competition gameplay has been added here.

### Final verification

Full serial regression passed **2,429 tests across 162 files in 737.45 s**, without failures or skips (`.artifacts/step32-completion-final-tests.log`). Two corruption cases were then strengthened to mutate real `twoPoint` values instead of an unsupported property; all **25 replay-cache tests passed again** (`step32-completion-final-cache-tests.log`). Production source/scripts remain unchanged from the final paired comparison. Typecheck and build passed with the existing large-chunk advisory (`step32-completion-final-build-verified.log`, native exit 0). The first build wrapper treated warning stderr as a PowerShell failure; an explicit native exit confirmed success.

**15 real Edge/module-worker/IndexedDB checks passed without browser errors** (`step32-completion-browser-smoke-report.json`), preserving original financial models/budgets, senior totals and manager logs through migration, import/export, reload, recovery and certificate fallback, while rejecting corrupt imports and stale writes. The five-completed-season real career strictly imported in **16.86 s**, validated/wrote in **14.20 s**, and then reopened through a fresh page and worker in **1.99 s**, with identical retained state and only a `parse-sealed` request. This measures the storage operation, not complete interface readiness, and is not the later combined-world target. The first harness attempt passed 14 checks before rejecting its unsupported checkpoint reason; correcting that ignored harness to the existing `manual` operation produced the successful rerun without product changes. See the current HANDOVER.md entry for artifacts and continuation instructions.

## Roster prerequisite: complete club membership and matchday squads (14 November 2026)

New real-data worlds use `rosterModel: club-roster-1` and a distinct `real-full-...` world ID. Career construction retains all imported members, including players without statistical samples. It no longer trims to twelve or adds invented reserves. Incomplete rosters below eight or beyond the prototype capacity of forty are rejected explicitly. Existing embedded worlds are not rewritten.

The club roster and its dated registration snapshots remain the employment/training/payroll authority. Each fixture has a separate five-to-twelve-player selection. Manual selection lives in Squad > Selection; assistant selection considers health, developed position-weighted ability and condition. Selection locks at tipoff. Historical results retain original selected identities plus the condition of non-selected members, without fictional box-score entries. Scouting reports no minutes for an unselected target; healthy omissions still count in playing-time concerns. Transfers and rollover reconcile manual selections with actual membership.

Schema **46**, `compact-2`, checks **3**: strict imports validate selections, original registrations, non-selected membership and conditions. The genuine format-45 fixture captured at `b51e375` proves unchanged legacy next-matchday continuation. New careers have estimated annual salary allocations of opening-roster wages plus 10%, rounded up to EUR 5,000, minimum EUR 240,000. Cash and staff allocations remain separate. The forty-player ceiling is a prototype capacity, not an official rule. Existing careers retain their original twelve-player limit, allocation and decisions.

**Scope still open:** registration is automatic from contracts in the one playable domestic league. Per-competition lists, foreign/homegrown restrictions and eligibility dates need researched rules and the shared calendar. The private profile pack still has unresolved memberships; keeping all imported identities does not verify their club assignments. No provider refresh, membership correction or ability calibration was performed in this increment. **Verification:** all 2,460 tests / 167 files, typecheck/build, nine real-league matchday/save checks and eight real Edge UI checks passed. See HANDOVER.md for artifacts and caveats.

## Not in this sprint (suggestions)

- Signing players from background clubs, and background clubs signing players.
- Domestic cups and super cups (the data has them; they are not in the agreed scope).
- A full real-world licence and coefficient system for European places.
