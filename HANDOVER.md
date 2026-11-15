# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** after each push, update "Current state" here and add two or three lines to the top of `docs/handover-history.md`. Record decisions only when a rule or default is decided. Keep this file under 20 KB.

## Current state (15 November 2026, sprint 3 cloud work complete)

**Active level:** Sprint 3, the multi-league world ([docs/multi-league-world.md#steps](docs/multi-league-world.md#steps)).

Since Level 7 was accepted, the levels are the owner's sprints, in this order:
1. Sprint 3: multi-league world (active)
2. Sprint 4: realism
3. Saved ideas
4. Release preparation
5. Interface simplification (last)

**Active step:** none in the cloud. Sprint 3's remaining steps are local-only (see "Sprint 3 summary").

**Code baseline:**
- Online real club data (Supabase) commit on `main` (cloud session); save format **60** (`SEASON_SCHEMA_VERSION`), `compact-2` encoding, `SAVE_CHECKS_VERSION` 3.
- Last verification, on Linux (cloud): full serial suite **2,634 tests / 202 files passed** (790 s), and `npm run build` passed with the known chunk-size advisory.
- Cloud sessions: Node 24.22.3 is installed in `/opt/node24` (put it first in `PATH`).

**Done in sprint 3** (details in the history, search for the step number):
- **3.1 data:** all 13 competitions imported and rated. The private pack `real-2026.11-world-3.json` (local only) covers 223 clubs and about 3,087 players.
- **3.2 save scaling** for a single league. Combined-world acceptance waits for 3.7.
- **3.3 domestic calendar:** one shared weekly calendar for all chosen leagues, with real byes for odd fields, a table per league, weekly settlement and gate income per home game (format 47).
- **3.4 so far:**
  - French LNB regular-season ranking rule (`lnb-2026-1`, format 48).
  - **3.4a** game days inside a week. Saturday stays the decision day; extra game days fall on Tuesday and Thursday.
  - **3.4b** every league's sourced 2026-27 postseason (format 49).
  - **3.4c** promotion and relegation between a country's two divisions. Each season records its divisions (format 50).
  - **3.4e-1** FIBA Official Basketball Rules 2026, Appendix D, as the labelled default standings rule for new worlds' leagues without a verified rule of their own (format 51). Also fixed: strict checks refused any manager club change in a carried world.
  - **3.4e-2** verified league rules for new worlds (format 52): ACB article 7 (Spain's top division), BBL § 20 (Germany), FIP article 62 (both Italian divisions). Greece and Turkey keep the FIBA default (no readable official rule).
  - **3.4d-1 to 3.4d-3** clubs leave and join the full world at season ends wherever the world lists a country's next division (formats 53-55; `withLowerDivisions`, `src/world/background.ts`, `src/world/exchanges.ts`; never Italy or France; real names need 3.4d-4), with the playoff panel's Leaving/Joining lists and "Generated" player labels. Owner decisions (a) and (b) implemented.
- **3.5 so far** (formats 56-60; `src/world/europe.ts`, `european-formats.ts`, `european-places.ts`): the three competitions and their entrants in new worlds (3.5a); midweek game days, seeded draws and background sides for clubs outside the full world (3.5b); the EuroLeague (3.5c), EuroCup (3.5d) and BCL (3.5e) in their real formats, ending before the domestic postseasons (week 38); estimated tables for unchosen top divisions and each season end's European places, a reversible default **for the owner to confirm** (3.5f); the Calendar and Europe pages (3.5g). Real-world IDs `real-places-`.
- **3.6 so far:** country flags, multi-country selection, a league list filtered by country, roster counts, a squad-strength bar, a game-speed meter, and the European competitions and estimated leagues listed in the club step and review.
- **Owner feedback round (15 November 2026)**, placements in `docs/decisions.md#owner-feedback-after-playing-15-november-2026`:
  - Setup screen fixed, and the injury and replay options removed.
  - "Preparing your career…" panel; careers are now built in the worker.
  - Opening contracts of 1-3 seasons (`world.playerContracts`).

**Unfinished in sprint 3:** the 3.7 browser acceptance (3.6's measured speed and save-size estimates are done).

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

## Sprint 3 finish and sprint 4 in progress (15 November 2026, owner said "go")

- **Real-data measurements** (online pack, Spain's two divisions plus the three European competitions, 166 world clubs, 1,300 opening fixtures): world built in 0.3 s, career created in 6.4 s, a full season (43 weeks) simulated in 247 s, save 7.5 MiB. The full career check took 17 s per save and 13 s per strict load; matchday autosaves now skip it (development mode), so saving costs only the encoding.
- **Rating fairness (sprint 4):** `src/world/rating-fairness.ts`, applied in `worldFromPack`: ratings resting on fewer than 600 minutes move towards the club's minutes-weighted level (one step lower) in proportion to the minutes missing; players without statistics take that level. The online pack now carries `ratingMinutes` (version `2026.11-world-1-online-2`). Example: Anadolu Efes' 30 and 32 become 61 and 60; their regulars keep their ratings.
- **3.4d-4 done (cloud, researched online):** real next divisions in new worlds: Turkey TB2L (22), Spain Segunda FEB (28), Germany ProA (18), Greece Elite League (16) (`src/data/lower-divisions-2026.ts`, sources in `competition-rules-2026.md`). Worlds may now hold up to 400 clubs (all six countries: 306).
- **3.6 done:** the setup screen's game-speed panel now uses real-data measurements with Europe (18 clubs: 92 s a season, 4.6 MiB; 36: 247 s, 7.5 MiB; 54: 10.6 MiB), scaled by 1.5 for a typical laptop, and shows the first-season save size. The review step counted European-only clubs as weekly clubs; fixed.
- **Contract lengths (sprint 4):** new real-club worlds use `openingContractYears` (`src/world/real-world.ts`), calibrated on published figures (EuroLeague trackers, FIBA/CIES migration report 2025): with the real pack, Spain and Turkey give one-season opening contracts to 37% of EuroLeague players (real: 45%; their squads include many young players), 66% of other top-division and 76% of second-division players; US imports outside the EuroLeague mostly one season. Generated next-division squads and joining clubs keep the old rule so saved careers replay unchanged. Real contract ends need the owner's decision (Suggestions).
- **Hidden potential (sprint 4):** `src/world/potential.ts`. New careers record training model `'training-2'`: each player's headroom is the most for his age at the career start (19 or younger 8, 20-21 6, 22-23 4, 24-26 2, 27-29 1, 30+ 0 rating points) times a stable 25-100% share, capped at 20 per skill; practice stops there (100 points per rating point). Older careers (`'training-1'`) keep the two-point limit. Scouting reports and the player profile show a potential star range (unknown until scouted; narrow for the own squad). Players 30 or older no longer improve through practice in new careers. Owner check: the Potential rows in the browser, below 850 px too.
- **Next:** sprint 4 with parallel agents: match calibration, realistic injuries, finances (agents running).

## Real clubs on every device (owner request, 15 November 2026)

The game reads real club data from the owner's Supabase project (public storage bucket `game-data`, `real-pack.json`; `src/world/built-in-pack.ts`), so careers start with real clubs on any device without choosing a file. **Live now:** a pack built in Supabase from the database (dataset 2026.11-world-1, 13 competitions, 223 clubs, 3,087 players) by the Edge Function `publish-starter-pack` (source in `supabase/functions/`; it never replaces an existing pack). **To publish the newer corrected pack** (world-3, only on the owner's computer): `npm.cmd run data:publish -- --file .local-data/real-2026.11-world-3.json` (uses `supabase-key.local`; checks the file with the game's parser first). Choosing a file stays possible. The owner asked for this Supabase work on 15 November 2026; the cloud rule against calling Supabase otherwise still stands.

## Sprint 3 summary (15 November 2026): cloud work complete, waiting for the owner

**Done in the cloud:** every sprint-3 step that needs no private data, keys or Edge.
- One shared calendar for several countries' leagues, with each league's real 2026-27 playoffs, promotion and relegation, tie-break rules and clubs moving to and from the division below.
- The EuroLeague, EuroCup and Basketball Champions League in their real formats on midweek dates. Clubs from leagues not chosen play with their real squads. Leagues not chosen get an estimated table each season. Next season's European places follow a reversible default **for the owner to confirm** (`docs/decisions.md`, "Background tables and next season's European places").
- A Calendar page for the whole season and a Europe page, and the setup screen lists the European competitions included.

**Left for the owner's machine (local-only):**
1. **3.4d-4: real lower-division names.** Import API-Sports' TB2L (Turkey), Segunda FEB (Spain), Pro A (Germany) and A2 (Greece) into a new private pack, then build them into new worlds with `withLowerDivisions` in `worldFromPack` (never Italy or France). Run a private season across a season end.
2. **A new private pack check for Europe:** build a world with the real pack and check that the EuroLeague (20), EuroCup (32, trimmed if listed longer) and BCL (30 direct plus qualification) get their formats, that the one-year EuroLeague places match Paris, Beşiktaş and Hapoel Tel Aviv by name, and that the unchosen top divisions appear.
3. **3.6:** measured speed and save-size estimates on the setup screen, using the real pack.
4. **3.7:** a multi-league season with Europe in the browser, save and load, rollover into season two, and five-season speed and size measurements (target: loads in about 5 s; well inside the 32 MiB save limit). A cloud session may prepare a public synthetic five-season test first, if the owner asks.

**Next:** the owner reviews sprint 3 and approves Sprint 4 (or more sprint-3 work). Never start Sprint 4 without that approval.

After sprint 3 (new levels, each needing the owner's approval):
- **Sprint 4, realism:** match calibration against real statistics; realistic injuries; hidden potential and fair ratings for low-minute players at strong clubs; realistic finances (wages, budgets, sponsorship and ticket income); real contract data.
- **Saved ideas** (the owner calls them essential; place each into a level when planning it):
  - unemployed seasons (confirm with the owner first: the design documents disagree);
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
- Removed continuation tests: none yet.
- Paused tests (`it.skip`, development mode): `tests/save-seal.test.js` (checkpoints validated before writing, no unchecked shortcut, strict saving without crypto) and `tests/career-saves.test.ts` (malformed state refused before writing). Checkpoints skip the full career check (`serializeSeasonCompact(state, { check: false })`), which took 17 s a matchday in a 36-club world with Europe.

## Local-only work

These need the owner's Windows machine: the private pack, API-Sports or Supabase keys, or headless Edge.
- **3.4d-4:** real lower-division club names from API-Sports into a new private pack, then a private season across a season end.
- **Europe with the real pack (3.5):** check the formats, trimmed fields, one-year EuroLeague places and unchosen top divisions of a world built from the real pack, then play a season with every system and time it.
- **Free official club lists** for Italy's Serie B and France's NM1, if the owner wants relegation out of the full world there.
- **Turkish and Greek tie-break rules (3.4e follow-up):** tbf.org.tr blocks automated downloads. Open "BSL 2026-2027 Sezonu Statüsü ve Lig Sıralaması" (and the TBL statute, if published) in a browser and save the PDFs locally; Greece's rule is in ESAKE's unpublished season notice. A session can then add those rules (a new format).
- **Private real-data checks** after each finished step: for example a full season of one country with every system, strict reload, and the timings. Earlier examples are in the history (search "Private real data").
- **3.6** measurements and **3.7** acceptance, using the real pack and Edge.
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

## Suggestions for the owner

- **Please confirm the European places default (3.5f)** in `docs/decisions.md` ("Background tables and next season's European places"), or say what to change. It is reversible.
- **Real contract ends for EuroLeague players (decision needed):** free trackers (BasketNews, Eurohoops sheets) list contract end years for about 83% of the 20 EuroLeague clubs' players (about 270 of 330); no free source covers the other leagues. Collecting them is a one-off script or 2-3 hours by hand, but the tables are compiled by those sites (possible database-rights question), and the online pack is public. Say whether to import them (and where to keep them) or keep the calibrated estimate.

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
