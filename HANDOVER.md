# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** after each push, update "Current state" here and add two or three lines to the top of `docs/handover-history.md`. Record decisions only when a rule or default is decided. Keep this file under 20 KB.

## Current state (15 November 2026, saved ideas level active)

**Active level:** Saved ideas (complete in the cloud, waiting for the owner to play and give feedback) (owner, 15 November 2026: "Go ahead dont stop, i want you to implement according to the plan and dont stop just tell me where we are and i will tell you until where u need to implement"). Then (15 November 2026): "Please go ahead and dont stop until you are done with what was planned only after that i will play and test and will provide you feedback." Finish the saved ideas level without stopping, then hand over for the owner to play. Level order: sprint 3 (multi-league world; 3.7 browser acceptance local-only), sprint 4 (realism, done), **saved ideas (active)**, release preparation, interface simplification (last).

**Saved ideas plan** (defaults reversible, recorded in `docs/decisions.md` as each lands; new careers only, older careers keep their rules through model fields):
- Round 1 (parallel agents, formats 63-66): (a) protected first season, fresh board confidence for a new coach, mid-season dismissals and resignations; (b) early sponsor exits and arena naming rights; (c) medical and scouting facilities and repair projects; (d) default squad roles by squad rank (fix for deep-bench concerns) and players asking about new contracts.
- Round 2: more president personalities, board verdicts affecting the player salary budget, youth and culture objectives; richer press topics and media reputation; rivalries that grow from results; loans and leases.
- Unemployed seasons: **approved by the owner** (careers continue while unemployed); round 2, after the board and career work.
- Also open: promoted and relegated clubs keep their opening money figures.
- **Done (16 November 2026):** every planned saved idea: career and board rules (63), sponsor exits and naming rights (64), medical and scouting facilities and repairs (65), squad-rank roles and contract requests (66), press and media standing (67), rivalries that grow from results (68), unemployed seasons (69), president personalities with salary verdicts and youth and culture objectives (70), loans and leases (71), club money following promotion and relegation (72). Defaults in `docs/decisions.md`, "Saved ideas level defaults". Old-format tests build careers with `beforeSavedIdeas`/`BEFORE_SAVED_IDEAS` (`tests/helpers/legacy-season.ts`); career and history scenario tests run without presidents (`presidents: false`).

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

## Sprint 4 summary (15 November 2026): realism complete

Match calibration to 2025-26 averages of nine competitions (`src/engine/calibration.ts`), realistic injuries (format 61), hidden potential (`training-2`), rating fairness on position scales, researched club money (format 62, `src/world/economy.ts`), calibrated opening contract lengths, real next divisions (3.4d-4) and measured setup-screen estimates (3.6). Details, figures and the Beşiktaş/Fenerbahçe audit are in `docs/handover-history.md` ("Sprint 4 summary, archived").

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
- Saved ideas gaps (development mode): naming-rights offers and sponsor exit decisions are checked for plausibility, not recomputed; president requests and resignation offers get shape checks only; youth matches have no injury recurrence; owner capital and the verdict's staff-budget preview still use opening money; offseason offers use the completed season's money figures; a move through unemployment adds no rivalry; AI clubs never lease, end sponsor deals early or chase youth/culture objectives.
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
10. **Saved ideas (when you play a new career):** Club > Board (president profile, objectives, requests, Your job with Resign, rivalries, media standing), the unemployed desk after declining offers, Club > Facilities (five facilities, repairs, How to pay with loans and leases, Loans & leases panel), Club > Main sponsor and Arena naming rights, Club budget panel from season two, contract request cards in the Inbox, Squad dynamics default roles; layouts below 600-850 px.

## Suggestions for the owner

- Owner decisions of 15 November 2026 (unemployed seasons yes, contract estimates kept, European places confirmed, browser checks waived for now) are in `docs/decisions.md`, "Owner decisions for the saved ideas level".

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
