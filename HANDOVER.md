# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** after each push, update "Current state" here and add two or three lines to the top of `docs/handover-history.md`. Record decisions only when a rule or default is decided. Keep this file under 20 KB.

## Current state (15 November 2026, saved ideas level active)

**Active level:** Saved ideas (owner, 15 November 2026: "Go ahead dont stop, i want you to implement according to the plan and dont stop just tell me where we are and i will tell you until where u need to implement"). Then (15 November 2026): "Please go ahead and dont stop until you are done with what was planned only after that i will play and test and will provide you feedback." Finish the saved ideas level without stopping, then hand over for the owner to play. Level order: sprint 3 (multi-league world; 3.7 browser acceptance local-only), sprint 4 (realism, done), **saved ideas (active)**, release preparation, interface simplification (last).

**Saved ideas plan** (defaults reversible, recorded in `docs/decisions.md` as each lands; new careers only, older careers keep their rules through model fields):
- Round 1 (parallel agents, formats 63-66): (a) protected first season, fresh board confidence for a new coach, mid-season dismissals and resignations; (b) early sponsor exits and arena naming rights; (c) medical and scouting facilities and repair projects; (d) default squad roles by squad rank (fix for deep-bench concerns) and players asking about new contracts.
- Round 2: more president personalities, board verdicts affecting the player salary budget, youth and culture objectives; richer press topics and media reputation; rivalries that grow from results; loans and leases.
- Unemployed seasons: **approved by the owner** (careers continue while unemployed); round 2, after the board and career work.
- Also open: promoted and relegated clubs keep their opening money figures.
- **Done so far:** career and board rules (format 63), sponsor exits and naming rights (64), medical and scouting facilities and repairs (65), press topics and media standing (67), rivalries that grow from results (68); squad-rank roles and contract requests (66); round 2 running (unemployed seasons 69, presidents/salary verdicts/youth and culture objectives 70, loans and leases 71, money following promotion and relegation 72). Old-format tests build careers with `beforeSavedIdeas`/`BEFORE_SAVED_IDEAS` (`tests/helpers/legacy-season.ts`); see `docs/decisions.md`, "Saved ideas level defaults". Owner checks (later): press conferences and the Media standing panel on Club > Board; rivalries listed on Club > Board from season two.

**Development mode** applies (see "Rules and conventions"): build features first; full suite at sprint end.

**Code baseline:**
- Save format **62** (`SEASON_SCHEMA_VERSION`; 61 injuries, 62 real economy), `compact-2` encoding, `SAVE_CHECKS_VERSION` 3.
- Last verification (cloud, Linux, end of sprint 4): full suite **2,604 passed / 30 skipped, 195 files** (302 s, `--maxWorkers=4`); `npm run build` passes with the known chunk-size advisory. The 30 skipped tests are listed under "Before release".
- Cloud sessions: Node 24.22.3 in `/opt/node24` (put it first in `PATH`).

**Sprint 3 in short** (details in `docs/handover-history.md`, search the step number): all 13 competitions imported and rated (3.1); save scaling (3.2); one shared calendar with byes and gates (3.3); each league's ranking rule, postseason, promotion and relegation, next divisions with real names (3.4); the EuroLeague, EuroCup and BCL in their real formats with background sides, estimated tables and European places (3.5); setup screen with flags, strength, Europe lists and measured speed and save size (3.6).

**Known open points:**
- Player statistics combine domestic and European games; the Competition page lists domestic games and the Europe page European ones.
- The Competition screen's player statistics combine regular-season and playoff games.
- Primera FEB's one-venue final stage still gives the listed home club its home advantage.
- The Turkish TBL postseason is a labelled default; its statute has not been found.
- Without a next-division list (every real world until 3.4d-4, and always Italy and France), relegated clubs of the lowest division stay; the playoff panel says so.
- New worlds rank Greece's, Turkey's and Spain's second division by the labelled FIBA default (no readable official rule). Worlds created before format 51 keep the prototype order outside France; format-51 worlds keep the FIBA default.
- **Large worlds are slow** (address at 3.7):
  - a 36-club season with every system takes 341 s;
  - the strict check of its season-two opening save takes 18 s;
  - the all-countries world (173 clubs) took about ten minutes to create and check.
- Strict validation of long careers grows with career length. The academy and relationship replays are the main costs; a performance step is needed before release.
- The private data still has unresolved records: 263 club assignments, 169 official identities, 17 extra provider IDs and 2,811 estimated precise positions. See `docs/player-data-quality.md`.

## Sprint 4 summary (15 November 2026): realism complete in the cloud

- **Real-data measurements** (online pack, Spain's two divisions plus the three European competitions, 166 world clubs, 1,300 opening fixtures): world built in 0.3 s, career created in 6.4 s, a full season (43 weeks) simulated in 247 s, save 7.5 MiB. The full career check took 17 s per save and 13 s per strict load; matchday autosaves now skip it (development mode), so saving costs only the encoding.
- **Rating fairness (sprint 4):** `src/world/rating-fairness.ts`, applied in `worldFromPack`: ratings resting on fewer than 600 minutes move towards the club's minutes-weighted level (one step lower) in proportion to the minutes missing; players without statistics take that level. The online pack now carries `ratingMinutes` (version `2026.11-world-1-online-2`). Example: Anadolu Efes' 30 and 32 become 61 and 60; their regulars keep their ratings.
- **3.4d-4 done (cloud, researched online):** real next divisions in new worlds: Turkey TB2L (22), Spain Segunda FEB (28), Germany ProA (18), Greece Elite League (16) (`src/data/lower-divisions-2026.ts`, sources in `competition-rules-2026.md`). Worlds may now hold up to 400 clubs (all six countries: 306).
- **3.6 done:** the setup screen's game-speed panel now uses real-data measurements with Europe (18 clubs: 92 s a season, 4.6 MiB; 36: 247 s, 7.5 MiB; 54: 10.6 MiB), scaled by 1.5 for a typical laptop, and shows the first-season save size. The review step counted European-only clubs as weekly clubs; fixed.
- **Contract lengths (sprint 4):** new real-club worlds use `openingContractYears` (`src/world/real-world.ts`), calibrated on published figures (EuroLeague trackers, FIBA/CIES migration report 2025): with the real pack, Spain and Turkey give one-season opening contracts to 37% of EuroLeague players (real: 45%; their squads include many young players), 66% of other top-division and 76% of second-division players; US imports outside the EuroLeague mostly one season. Generated next-division squads and joining clubs keep the old rule so saved careers replay unchanged. Real contract ends need the owner's decision (Suggestions).
- **Hidden potential (sprint 4):** `src/world/potential.ts`. New careers record training model `'training-2'`: each player's headroom is the most for his age at the career start (19 or younger 8, 20-21 6, 22-23 4, 24-26 2, 27-29 1, 30+ 0 rating points) times a stable 25-100% share, capped at 20 per skill; practice stops there (100 points per rating point). Older careers (`'training-1'`) keep the two-point limit. Scouting reports and the player profile show a potential star range (unknown until scouted; narrow for the own squad). Players 30 or older no longer improve through practice in new careers. Owner check: the Potential rows in the browser, below 850 px too.
- **Realistic finances (sprint 4, format 62):** `src/world/economy.ts` (`withRealEconomy`, `REAL_ECONOMY_RULES`, last step of `worldFromPack`; world id prefix `real-economy-`). Real-data worlds record `world.economy = 'real-2026-1'` and per-club figures on `world.finances[].economy` (band, budget, sponsorship, season funding, opening cash, ticket price, yearly operating cost, scale for staff fees and facility costs) from the 2025-27 budget research (`docs/decisions.md` to follow); wages are the club's gross cost; league/European/public/owner money is one "Season funding" receipt each season. The development and test worlds keep the old constants. Sums of €1M or more read as millions. Wages split by squad rank (best paid 14-21% of the bill, highest €5.4M at Panathinaikos); 48 published budgets apply by whole club name (Real Madrid 60M, Bayern 48M, Fenerbahçe 44M, Beşiktaş 20M; Partizan, Crvena zvezda, Maccabi, Hapoel Tel Aviv and Dubai by strength); upper halves are placed per country.
- **Realistic injuries (sprint 4, format 61):** `src/domain/injuries.ts` (18 kinds with researched shares, min-median-max days and labels), `injuryDays`/`recurrenceFactor`/`injuryRiskMap` in `src/world/health.ts`, the roll in `src/engine/match.ts` (0.00085 per minute played, ×1.3 beyond 32 minutes, reduced ×0.3; about 0.37 injuries a game). Durations are log-normal around the median from the stable hash; earlier injuries raise same-kind risk (muscle strains ×4/×2.5/×1.5, ankle ×2/×1.4, knee/back/tendon ×2/×1.3, concussion makes lower-limb ×2 for 90 days), passed to the match as `injuryRisk`; a recurrence lasts ×1.3. Old saves keep `'ankle'`/`'muscle'` with their old durations. Youth matches have no recurrence. Owner check: injury labels on Medical, Academy and the desk.
- **Match calibration (sprint 4):** `src/engine/calibration.ts` holds every tuned constant with its target (2025-26 regular season, plain mean of nine competitions). Measured on six real top divisions with Europe (about 6,840 games), per team per game: points 85.0 (target 85.2), possessions 75.8 (75.7), 112 points per 100 possessions (112.5), FG 45.7% (46.3), 3P 34.5% on 43.9% of shots (34.8 / 41.9), FT 16.8-22.1 (16.4-21.8), assists 19.1 (18.5), turnovers 13.5 (13.2), steals 6.8, blocks 2.7, fouls 22.6, team rebounds 1.8/2.2; average margin 11.7 (12.0), home wins 60.8% (59.4), overtime 3.0% (4.8); starters 23.8 minutes and 59% of minutes, 5.5 bench players used. Fixed on the way: point guards committed most fouls (help defenders now do), AI clubs kept garbage-time lineups as next game's starters. The old rules-2 engine keeps its rotation.
- **Rating fairness on each position's scale:** `withFairRatings` now compares levels on the player's own position weights and shifts his own profile (the first version averaged skills across positions, about 8 overall points too low). Beşiktaş/Fenerbahçe audit: the raw statistics already rate Beşiktaş's best eight 75.5 and Fenerbahçe's 75.1 (Zizic 87 on 1,035 minutes; Fenerbahçe deeper at places six to eight); in simulation the two are level (head to head 54% Fenerbahçe). A data-side improvement needs minutes from other leagues or last season for new signings (local-only).
- **Known side effect:** with the realistic rotation, players 10-12 default to the Rotation role (12+ minutes) and raise playing-time concerns; AI clubs settle them, and the manager can agree Reserve roles. A default role by squad rank needs a relationships model change (replay), so it is left for later.
- **Scenario tests re-seeded** after the merged results (new seeds reproduce the same scenarios and dates; none skipped).
- **Next:** the owner reviews sprint 4 (browser checks 7-9 under "Owner checks", the two decisions under "Suggestions") and approves the next level.

## Real clubs on every device (owner request, 15 November 2026)

The game reads real club data from the owner's Supabase project (public storage bucket `game-data`, `real-pack.json`; `src/world/built-in-pack.ts`), so careers start with real clubs on any device without choosing a file. **Live now:** a pack built in Supabase from the database (dataset 2026.11-world-1, 13 competitions, 223 clubs, 3,087 players) by the Edge Function `publish-starter-pack` (source in `supabase/functions/`; it never replaces an existing pack). **To publish the newer corrected pack** (world-3, only on the owner's computer): `npm.cmd run data:publish -- --file .local-data/real-2026.11-world-3.json` (uses `supabase-key.local`; checks the file with the game's parser first). Choosing a file stays possible. The owner asked for this Supabase work on 15 November 2026; the cloud rule against calling Supabase otherwise still stands.

## Levels after sprint 4 (each needs the owner's approval)

- **Saved ideas** (the owner calls them essential; place each into a level when planning it):
  - unemployed seasons (approved, in the saved ideas level);
  - a protected first season and fresh board confidence for a new coach;
  - mid-season dismissals and resignations;
  - more president personalities;
  - verdicts affecting the player salary budget;
  - youth and culture objectives;
  - players asking about new contracts;
  - richer press topics and media reputation;
  - rivalries that grow from results;
  - loans and leases;
  - medical and scouting facilities and repair projects;
  - early sponsor exits and naming rights.
- **Release preparation:** free first season, then a EUR 15 unlock, later Steam; data-rights review.
- **Interface simplification,** after the owner has played with real data.

## Rules and conventions that must not be broken

**Development mode until release (owner, 15 November 2026: build features first, test later; the owner chose all three speed-ups: pause old-save support, lighter save checks, parallel agents)**
- No fixture capture, continuation tests, migration tests or corruption-rejection tests for new work. When the save shape changes, bump `SEASON_SCHEMA_VERSION` and add a version guard; older saves may be refused with a clear "start a new career" message instead of being migrated.
- If a change makes an old-save continuation test fail, delete that test and list it under "Before release" below. Existing fixtures stay in the repository for that later work.
- New features get basic save checks only (shape and key totals). The full replay checks and old-save support come back in the release preparation.
- Old careers keep their rules only where that costs nothing; otherwise new rules may apply to every career.
- Save limit: 32 MiB. Portable imports still get the checks that exist.
- Parallel agents may build independent features at the same time; the main session combines their work and runs the checks before each push.

**Calendar and simulation**
- `SeasonState.round` is a week and `state.date` is that week's Saturday. Wages, upkeep, staff, board and training run once a week, after the week's last game day. Gate income is per home game.
- League tables, board targets, sponsor positions and job-offer positions count domestic regular-season games only (`isRegularFixture`; never European games).
- Worlds that play Europe keep each season's games in calendar order; European games are midweek (Tuesday-Thursday) and end before the domestic postseasons.
- Each season's league memberships come from `seasonLeagues(world, divisions)`. Never mutate the opening `world.domesticLeagues`.
- Simulation randomness is seeded. Reading screens, advice or tables never uses match randomness. Dates are ISO dates with UTC arithmetic.
- Money is whole euro cents. Human and AI clubs share the same rules and guards (`*-policy.ts`). New career systems go in `SeasonSystems` and `NEW_CAREER_SYSTEMS`.
- Keep original registrations, fixture statistics, contracts and ledger receipts. Never rebuild past events from today's roster.

**Budgets and interface**
- Follow [AGENTS.md](AGENTS.md).
- Keep the three labels **Remaining budget**, **Remaining staff budget** and **Player salary budget**, each with its own rules. Never merge them into one pool.
- Show only real game state and working actions. Never invent fixtures, money, messages or standings.

**Real data and secrets**
- Careers use real clubs only. Unknown facts stay unknown, and estimates and generated players are labelled.
- **Data rights granted (owner, 15 November 2026):** real clubs are the default way to play. The real pack is published in Supabase storage (`game-data/real-pack.json`, read automatically by `src/world/built-in-pack.ts`; `public/data/real-pack.json` is a fallback; choosing a file stays possible). Other private files (raw imports, API responses) stay in `.local-data/`.
- Keys live only in `*.local` files, which Git ignores. Never print, commit or bundle them. This repository is public, and every push to `main` goes live on Vercel.
- Ask the owner before any paid option.

**Tests**
- Per push: `npm run build` and the focused tests of what changed. Run `npm run test:quick` only when saves, the calendar or the match engine changed. The full suite runs at the end of each sprint and before release.
- Add a test only where it protects something fragile; no exhaustive test files per feature.
- Temporary checks (`tests/zz-*`) are deleted before any commit.

**Before release** (deferred work to bring back)
- Old-save support: capture fixtures, continuation and migration tests for the formats released to players.
- Full save replay checks for features added in development mode.
- Removed continuation tests (injuries changed later weeks): whole files `tests/season39`, `40`, `46`, `47`, `48`, `50`-`56-continuation.test.js`; next-week comparisons inside `physio-storage` (format 22), `academy-storage` (24), `lifecycle-storage` (25), `facilities-storage` (27), `relationships-storage` (28) and `division-changes` (49), now "migrates and continues a valid week". Fixtures stay in the repository.
- Economy gaps (format 62): promoted and relegated clubs keep their opening money figures (per-season figures need save and validator work); consistently weak clubs end seasons with little cash (2-4% of budget) and may drift into unpaid costs in long careers; the empty-roster wage reserve, academy prospects' wages and added arena seats are not rescaled; staff fees and facility costs follow one per-club scale.
- Paused by match calibration (`it.skip`, simulated results after old saves differ; recapture before release): the "continues … exactly" tests in `tests/season30`-`38`, `41`, `42-continuation.test.js` and the old-save next-week comparisons in `assistant-storage`, `board-storage`, `division-changes`, `fitness-storage`, `full-roster-legacy`, `release-clauses-migration`, `scouts-storage`, `youth-competition-storage`.
- Paused tests (`it.skip`, development mode): `tests/save-seal.test.js` (checkpoints validated before writing, no unchecked shortcut, strict saving without crypto) and `tests/career-saves.test.ts` (malformed state refused before writing). Checkpoints skip the full career check (`serializeSeasonCompact(state, { check: false })`), which took 17 s a matchday in a 36-club world with Europe.

## Local-only work

These need the owner's Windows machine: the private pack, API-Sports or Supabase keys, or headless Edge.
- **Europe with the newer private pack (3.5):** the online pack (world-1) builds and plays Europe in the cloud; with the corrected world-3 pack, check the one-year EuroLeague places (Paris, Beşiktaş, Hapoel Tel Aviv) and trimmed fields.
- **Free official club lists** for Italy's Serie B and France's NM1, if the owner wants relegation out of the full world there.
- **Turkish and Greek tie-break rules (3.4e follow-up):** tbf.org.tr blocks automated downloads. Open "BSL 2026-2027 Sezonu Statüsü ve Lig Sıralaması" (and the TBL statute, if published) in a browser and save the PDFs locally; Greece's rule is in ESAKE's unpublished season notice. A session can then add those rules (a new format).
- **Private real-data checks** after each finished step: for example a full season of one country with every system, strict reload, and the timings. Earlier examples are in the history (search "Private real data").
- **3.7** acceptance (a multi-league season with Europe in the browser, save and load, rollover, five-season speed and size), using the real pack and Edge.
- **Membership reconciliation** (3.1 follow-up): needs provider and official observations; see `docs/player-data-quality.md`.
- **Club colours:** the owner's check of club identities (pilot step 2.3); 189 clubs still lack verified colours.
- **Any Supabase change:** nothing is pending, and nothing may change without the owner's approval.

## Owner checks

Browser checks still to do locally (by the owner, or by a local Claude session with Edge):
1. **Promotion and relegation (3.4c), not yet browser-checked:**
   - Play or simulate a Spanish career (ACB and Primera FEB) through its season end. A full season takes about 6 minutes of simulation.
   - Check that Competition shows the champion and the promoted and relegated clubs.
   - Check that season two's league tables have the new members.
   - In a German-only career, check that the playoff panel says relegated clubs stay because there is no lower division yet.
2. **Table rules (3.4e):** start new careers and open Competition after a week. "Table rules" should say: Greek or Turkish league "FIBA default · Classification points" with a **Pts** column (2 for a win, 1 for a loss); German "BBL · Wertungspunkte" with **Pts** as 2:0 points; Italian "FIP · Points"; Spanish top division "ACB · Wins"; French "LNB · Win percentage".
3. **Leaving and joining (3.4d-2, 3.4d-3), after 3.4d-4 adds real next-division names:** play a German or Spanish career through a season end. The playoff panel should list the clubs leaving and joining; season two should have the joining club, its players marked "Generated" on Squad, profile and Scouting.
4. **Calendar and Europe pages (3.5g) and the setup screen (3.6):** checked in Chromium with a synthetic pack (setup review, Calendar, Europe table and games, estimated table). Still to check with the real pack: in a new real-data career, the club step and review list the European competitions and the estimated leagues; the Calendar page shows every week, the manager's games and reserved playoff days; the Europe page shows each competition's tables or groups, knockout rounds, games and results, and the estimated tables.
5. **European games (3.5b-c), with a new real-data career whose world includes a EuroLeague club:** the first EuroLeague game is on Thursday 24 September; on a Saturday without a domestic game the screen says "No game today" when a European game follows that week; opponents from leagues not chosen play with their real squads; the EuroLeague club's ledger shows its European home gates.
6. **Quick play-test of the feedback fixes:**
   - Start a new career and check the country-filtered league list, the speed meter and the "Preparing your career…" panel. These were checked automatically in Edge.
   - Then check in Transfers that only some players' contracts end after the first season.
7. **Hidden potential (sprint 4):** in a new career, a scouted player's report and your own players' profiles show a "Potential" star range; unscouted players show none. Check the layout below 850 px wide.
8. **Real economy (sprint 4):** in a new real-data career, check Club, Payroll, Staff and Sponsorship: the millions format, scaled staff fees, the "Season funding" ledger row and the setup screen's budget note.
9. **Injuries (sprint 4):** in a new career, injuries show readable kinds (for example "Hamstring strain", "ACL rupture") on Medical, Academy and the manager desk notice; long injuries (ACL, Achilles) last most of a season.

## Suggestions for the owner

- Owner decisions of 15 November 2026 (unemployed seasons yes, contract estimates kept, European places confirmed, browser checks waived for now) are in `docs/decisions.md`, "Owner decisions for the saved ideas level".

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
