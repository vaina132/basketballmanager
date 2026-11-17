# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** after each push, update "Current state" here and add two or three lines to the top of `docs/handover-history.md`. Record decisions only when a rule or default is decided. Keep this file under 20 KB.

## Current state (16 November 2026, late: step 3.7 and the play-test fixes going live)

**Active level:** the owner's play test (17 November 2026). The simplification asked for before it is live (format **74**): opening staff for every club (`coaching-2`), squad roles in the list and contract talks (`relationships-3`), the court-picture starting five, six facility levels with arena seats and the bank loan (`facilities-3`, `bank-1`; format-73 careers with them still load), Board as a menu item, Transfers as a player search with contracts on Squad > Contracts, and the day-by-day Continue. Defaults in `docs/decisions.md` ("Simplification before the play test"). Last quick tier: 2,622 passed, 41 skipped. Browser career cycle on the format-74 build (Spain + Germany + Turkey with Europe, Real Madrid; script `scratchpad/final74/career-cycle.cjs`, menu item "Desk"): creation 3 s, season one 8.4 min with 95 Continue presses, offseason 9 s, rollover 5 s, reload 2.4 s at the same week, no game errors. **Alongside the play test:** the incremental checkpoint check (worktree `agent-aa1ded15181adfc17`, local only, in progress), exact checks for the saved ideas' plausibility checks, positions for Turkey and France, and the owner's decision on league sites' terms. Several scenario tests run with `staffing: false` as a stopgap; re-seed them before release.

**Step 3.7 result (16 November 2026):** three countries plus Europe (70 weekly clubs, 211 world clubs), every system on: career creation 5-9 s; a delegated season 12-26 min in the browser (about 4 min in tests on a quiet machine); offseason about 1 min, rollover 20-25 s; five seasons end at **18.0 MiB** (format 73: completed seasons sealed at rollover, packed records, `compact-3`), +2.3 MiB a season instead of +7.5; sealed reload 1-3 s; strict load 23-82 s, growing with career length; every season boundary passes the strict check (seeds 7 and 11; five strict-check fixes: sponsor exits after a final week without games, offseason closing for clubs over a fallen allocation, board requests after a mid-season dismissal, a season's own sponsor exits, opening-review retirement notices). Browser (Chromium, combined build): creation 5 s, season 15 min, offseason 34 s, rollover 7 s, reload 3 s at the same week, no game errors (`docs/multi-league-world.md`, 3.7 row).

**Done for the play test (16 November 2026; details in `docs/handover-history.md`):** owner feedback fixes (no blank screen when a page or the season worker cannot be downloaded after a deploy, plain "Not played · table simulated" wording, no OVR "est." on the club step, court swaps, close warning, Automatic labels without an assistant coach, facility time left); every checkpoint fully checked in the background before it is written; old-save tests restored; computer clubs on the human club's rules (leases, sponsor exits, youth objectives, youth injury recurrence, rivalry through unemployment); money gaps (season money for capital and staff budgets, foreseen next-season money in the offseason, club-scaled reserves and academy wages, arena seats by the club's arena, staff pay on a square-root scale, automatic spending cushions, solvent weak clubs); browser-cycle fixes (truthful Continue messages on midweek days, the planned five starts the next game, clear offseason reasons, a save status, current-season labels and readable dates, at most five job offers and none from reserve teams).

**Owner feedback still to build** (numbers from the owner's messages):
- (6) Money realism: some staff earn a lot (staff pay now scales by the square root of club money); the owner's sentence was cut off, ask for the rest.
- Interface simplification (after the play test):
  - **Aim of this level (owner, 16 November):** "the game is too detailed to be played swiftly, this can make a lot of potential players escape the game in the first few minutes": fewer decisions and screens in the first minutes, sensible defaults, details only on request.
  - (15) Every club starts with staff in every area (coaches, assistant, scouts, physio, fitness, youth), rated to the club's level; the manager can sack and hire; hiring for a filled role warns first and the replacement can still be accepted. New format; AI clubs on the same rules.
  - (12) Easier squad and starting-five selection: a small court picture with PG/SG/SF/PF/C circles, filled by drag and drop or by tapping a player then a circle. Playing someone out of position is a new game rule (today each player plays his own position).
  - (14) Squad roles everywhere: roles exist today only on Squad > Squad dynamics (Reserve, Rotation, Starter with expected minutes, morale, talks and promises; default by squad rank in new careers) and do not touch contracts. Plan: a Role column on the Squad list; a Star and a Prospect role besides Starter, Rotation and Reserve; the role offered becomes part of contract talks and signings (asking wage and willingness depend on it, stars refuse reserve roles, a promised role is a contract term); unmet roles lead to contract requests or a wish to leave; AI clubs use the same rules. New save format. Goes with (12), the court-picture starting five.
  - (13) Transfers becomes a player search to bring players in; own squad and contract renewals move out of it.
  - (4) Facilities: six levels for every facility (Very Poor, Poor, Average, Good, Very Good, Excellent) instead of four. The arena becomes a seat capacity, expanded for a fee over several weeks depending on the size. Loans become a simple bank loan usable for anything. Replace the Full/Reduced and automatic/manual controls with something simpler. This changes game rules and needs a new format.
  - (5) Board gets its own left menu item.
  - (7) Replace "Go to match" with a Continue button that moves day by day, like Football Manager, running the other simulations in the background with a progress bar.
- Data (owner's computer): (8) wrong positions (Efes: Malcolm SG, should be SF; Kai Jones and Bruno Fernando PF, should be C). Explained to the owner: API-Sports gives only Guard/Forward/Center or nothing, and the game estimates the exact position from statistics. The corrected world-3 pack is not published yet; the owner decides on another source.

**Development mode** applies (see "Rules and conventions"): build features first; full suite at sprint end.

**Code baseline:**
- Save format **73** (`SEASON_SCHEMA_VERSION`; older real-club careers are refused with a start-a-new-career message), `compact-3` encoding, `SAVE_CHECKS_VERSION` 4.
- Last verification (cloud, Linux, end of the saved ideas level, 16 November 2026): full suite **2,724 passed / 30 skipped, 209 files** (371 s, `--maxWorkers=4`; its one failure, `lower-division-world`, was re-seeded and passes); `npm run build` passes with the known chunk-size advisory. The 30 skipped tests are listed under "Before release".
- Cloud sessions: Node 24.22.3 in `/opt/node24` (put it first in `PATH`).

**Sprint 3 in short** (details in `docs/handover-history.md`, search the step number): all 13 competitions imported and rated (3.1); save scaling (3.2); one shared calendar with byes and gates (3.3); each league's ranking rule, postseason, promotion and relegation, next divisions with real names (3.4); the EuroLeague, EuroCup and BCL in their real formats with background sides, estimated tables and European places (3.5); setup screen with flags, strength, Europe lists and measured speed and save size (3.6).

**Known open points:**
- Player statistics combine domestic and European games; the Competition page lists domestic games and the Europe page European ones.
- The Competition screen's player statistics combine regular-season and playoff games.
- Primera FEB's one-venue final stage still gives the listed home club its home advantage.
- The Turkish TBL postseason is a labelled default; its statute has not been found.
- Without a next-division list (every real world until 3.4d-4, and always Italy and France), relegated clubs of the lowest division stay; the playoff panel says so.
- New worlds rank Greece's, Turkey's and Spain's second division by the labelled FIBA default (no readable official rule). Worlds created before format 51 keep the prototype order outside France; format-51 worlds keep the FIBA default.
- Strict checks grow with career length (23 s at a season-2 opening, 82 s at a season-5 end in the 3.7 world); checkpoints check in the background, so the save status can trail play by a minute or more in long careers. Incremental checks run alongside the play test.
- The private data still has unresolved records: 263 club assignments, 169 official identities, 17 extra provider IDs and 2,811 estimated precise positions. See `docs/player-data-quality.md`.

## Levels and real data

- **Roadmap (owner, 16 November 2026):** step 3.7 and safety and gaps (done for the play test), owner play test, interface simplification (aim: a swifter game), player data, release preparation. Selling and marketing are off the roadmap until the game is playable and enjoyable (`docs/decisions.md`).
- **Real clubs on every device:** the game reads the real pack from the owner's Supabase storage (`game-data/real-pack.json`, `src/world/built-in-pack.ts`; `public/data/real-pack.json` is a fallback). **Live since 17 November 2026: `2026.11-world-5-online`** (exact positions from official league sites: ACB, Primera FEB, BBL, Greece, Italy A and A2, BCL; 1,378 of 3,087 exact, 1,709 guessed; not covered: France (data behind a login) and Turkey (tbf.org.tr blocks automated access); several sites reserve their content, so the owner decides whether each source stays, `docs/decisions.md`; batch `official-rosters-2026-11-16`, replaced values in `manual_override_history`; scripts `scripts/real-data-official-{profiles,rosters}.mjs`). Before it, `2026.11-world-4-online` (official EuroLeague/EuroCup profiles and the Efes roster: 228 positions changed, 285 exact; Malcolm SF, Kai Jones and Bruno Fernando C; backup of world-1 in `game-data/backups/`). Corrections live in the database table `manual_overrides` (batch `official-2026-11-16`), so rebuilds keep them; `publish-starter-pack` (v3) and `import-profile-overrides` act only on a pending, unexpired `data_change_requests` row whose SHA-256 matches (migration `20261116230000_data_change_requests.sql`). The owner allowed Supabase for this work (16 November); otherwise the cloud rule against calling Supabase stands. world-3's 27 club moves and the Monaco removal are only on the owner's computer and not in world-4; the local `data:publish` refuses to replace a corrected pack unless `--replace-corrected`.

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
- Skipped (16 November 2026): `career-unemployment` "declining an offer at a season end" has no seed under the planned-five and five-offer rules; find a scenario before release.
- Format 73 (16 November 2026): real-club careers of format 72 and earlier are refused; bring back old-save support for them if they reach players. Sealed seasons are checked by shape and totals only; add full replay checks for them and un-pause `describe.skip` in `tests/academy-history-storage.test.js` and `tests/youth-history-storage.test.js` (about 40 skipped tests). In sealed seasons "games" in season totals counts games played (squad games in the latest completed season); morale searches cannot see per-game minutes in sealed seasons.
- Old-save tests restored (16 November 2026) as "continues a valid week" checks (`tests/helpers/old-save-week.ts`: strict check, one week, the career's rules and every past event kept, the captured next week's schedule); exact comparisons stay where no match is simulated.
- Saved ideas gaps (development mode): naming-rights offers and sponsor exit decisions are checked for plausibility, not recomputed; president requests and resignation offers get shape checks only; owner capital and the verdict's staff-budget preview still use opening money; offseason offers use the completed season's money figures. Closed 16 November (`docs/decisions.md`, "Safety and gaps level defaults"): AI leases, early sponsor exits and youth/culture objectives, youth injury recurrence, rivalry through unemployment; automatic exits' cash condition, naming exits, AI contract replies and AI lineups are checked for plausibility only.
- Economy gaps (format 62; promotion and relegation money fixed by format 72): consistently weak clubs end seasons with little cash (2-4% of budget) and may drift into unpaid costs in long careers; the empty-roster wage reserve, academy prospects' wages and added arena seats are not rescaled; staff fees and facility costs follow one per-club scale.
- Checkpoint checks restored (16 November 2026): every checkpoint gets the full career check in the save worker before it is written and sealed; saves coalesce so play never waits (`createCheckpointQueue`, `src/storage/career-saves.ts`); `SAVE_CHECKS_VERSION` 4 re-checks older seals once. Still to remove: the unused `check` option of `serializeSeasonCompact`.

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
- Vercel's protection against missing page files after a deploy ("skew protection") would stop the download failure behind the black screen; the game now recovers with Save and reload. It may be a paid option, so it needs the owner's decision.
- "Assistant" still names general staff tasks without an assistant coach (training control, contract handling, scouting assignments, press notes) and the play-by-play line "assistant substitutions enabled"; these could read "Automatic" too. A hired assistant making better automatic choices would be a new rule.
- Pre-existing layout points found on 16 November: on a phone, the Competitions table heading's picker is unstyled and "0 / 24 fixtures complete" is cut off; on the desktop club step the "Playable countries" and "Game speed" boxes are wider than their column; dragging needs a mouse (tapping two players works on phones).
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
