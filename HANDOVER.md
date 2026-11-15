# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** when a step is finished, update "Current state" and "Next steps" here, and add the step's detailed notes (what changed, tests, measurements) to the top of `docs/handover-history.md` under a dated heading. Keep this file under 20 KB, with exactly one current entry.

## Current state (15 November 2026, after step 3.5e)

**Active level:** Sprint 3, the multi-league world ([docs/multi-league-world.md#steps](docs/multi-league-world.md#steps)).

Since Level 7 was accepted, the levels are the owner's sprints, in this order:
1. Sprint 3: multi-league world (active)
2. Sprint 4: realism
3. Saved ideas
4. Release preparation
5. Interface simplification (last)

**Active step:** 3.5, European competitions. The next step is 3.5f, estimated background tables and next season's European places (3.4d-4 is local-only; see "Next steps").

**Code baseline:**
- Step 3.5e commit on `main` (cloud session); save format **59** (`SEASON_SCHEMA_VERSION`), `compact-2` encoding, `SAVE_CHECKS_VERSION` 3.
- Last verification, on Linux (cloud): full serial suite **2,620 tests / 198 files passed** (756 s), and `npm run build` passed with the known chunk-size advisory.
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
  - **3.5e** the BCL (format 59, `bcl-2026-1`): 30 direct places by squad strength plus two single-game qualification tournaments; a protected draw from pots (entrants carry `countries`); groups, play-ins, Round of 16 groups, quarter-finals and a Final Four with a third-place game, every game derived from results. Real-world IDs `real-bcl-`.
  - **3.5d** the EuroCup (format 58, `eurocup-2026-1`): four drawn groups (A-B Tuesdays, C-D Wednesdays, weeks 4-19), top four to best-of-three eighth-finals across paired groups, quarter-finals, semi-finals and finals on the published dates; real worlds keep the chosen leagues' clubs and the strongest others when the listing is too long.
  - **3.5b-c** European games on the shared calendar and the EuroLeague format (format 57; `src/world/europe.ts`, `src/world/european-formats.ts`): a competition with `format` plays; EuroLeague Thursdays of weeks 3-32 (Tuesdays too in eight double weeks), Play-In, best-of-five playoffs, Final Four 25 and 27 May without a third-place game; seeded draw; the domestic regular season lasts until week 38. Clubs outside the full world play as background sides (best available twelve, condition and injuries from their European games, no club records). New real worlds give each competition its format when the field fits.
  - **3.5a** European competitions in new worlds (format 56): `world.europeanCompetitions` from the pack; entrants outside the chosen leagues are background clubs with their real squads (`withEuropeanCompetitions`, `europeanOnlyClubIds`). They do not play yet.
  - **3.4d-1 to 3.4d-3** clubs leave and join the full world at season ends wherever the world lists a country's next division (formats 53-55; `withLowerDivisions`, `src/world/background.ts`, `src/world/exchanges.ts`; never Italy or France; real names need 3.4d-4), with the playoff panel's Leaving/Joining lists and "Generated" player labels. Owner decisions (a) and (b) implemented.
- **3.6 so far:** country flags, multi-country selection, a league list filtered by country, roster counts, a squad-strength bar and a game-speed meter.
- **Owner feedback round (15 November 2026)**, placements in `docs/decisions.md#owner-feedback-after-playing-15-november-2026`:
  - Setup screen fixed, and the injury and replay options removed.
  - "Preparing your career…" panel; careers are now built in the worker.
  - Opening contracts of 1-3 seasons (`world.playerContracts`).

**Unfinished in sprint 3:** 3.4d-4 (local-only), 3.5f-g, the rest of 3.6, and 3.7 (local-only).

**Known open points:**
- European games have no screen of their own until 3.5g: the manager's European games open on their match day and count in player statistics, but Competition lists domestic games only.
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

## Next steps (plan order)

Each step below should fit one session. A step that needs private data, keys or Edge is marked **local-only**: a cloud session lists it under "Local-only work" and moves on to the next step that does not need them. Never start Sprint 4: after the last sprint-3 step a session can do, stop and write the sprint-3 summary here.

1. **3.4d-4 (local-only): real lower-division names.**
   - Import the real names into a new private pack. API-Sports lists Turkey's TB2L, Spain's Segunda FEB, Germany's Pro A and Greece's A2. Then build them into new worlds with `withLowerDivisions` (in `worldFromPack`, for countries other than Italy and France).
   - Run a private real-data season across a season end.
   - Update the 3.4 rows in the plan tables.
2. **3.5: European competitions.** The split below was checked and recorded on 15 November 2026 (`docs/multi-league-world.md#plan-for-step-35-checked-15-november-2026`); the open research is done (`docs/competition-rules-2026.md`: no EuroLeague third-place game; BCL 2026-27 regulations; licences and the EuroCup route). **(a)-(e) are done** (formats 56-59). Next: 3.5f.
   - **(a)** The three competitions and their entrants in the world. Entrants from leagues that were not chosen, and from countries outside the six, become background clubs.
   - **(b)** Midweek European game days on the shared calendar, with draws at the season start:
     - EuroCup and BCL on Tuesdays and Wednesdays;
     - the EuroLeague on Thursdays, and also Tuesdays in its double-round weeks.
   - **(c)** EuroLeague format.
   - **(d)** EuroCup format.
   - **(e)** BCL format.
   - **(f)** Estimated background tables for unchosen leagues and European places for next season (the reversible default in the plan).
   - **(g)** A Calendar view of the whole season (owner feedback point 8) and the European Competition screens.
3. **3.6: measured speed and save-size estimates, with Europe in setup.**
   - The screen work can be done in the cloud.
   - Measuring with the real pack is local-only.
4. **3.7 (local-only): final check.**
   - A multi-league season with Europe in the browser, save and load, rollover into season two, and five-season speed and size measurements (target: loads in about 5 s; well inside the 32 MiB save limit).
   - A cloud session may prepare a public synthetic five-season test first.
5. **Stop:** write the sprint-3 summary here and wait for the owner.

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

**Saves and fixtures**
- **Fixtures first.** Before any save-format change, capture genuine current-format saves from the unchanged code, with a manifest of SHA-256 hashes, and describe them in `tests/fixtures/README.md`.
  - `scripts/capture-season-fixtures.mjs` captures the board career.
  - `scripts/capture-format-baseline.mjs <label>` captures a public two-division domestic career (mid-season week and its next week; completed season and its rollover) with a manifest of file and module hashes. Use it before each format change from format 51 on.
  - The capture scripts for formats 46-49 were in the ignored `.artifacts` folder and are not in the repository.
  - Never regenerate, edit or replace an existing fixture. Never fake an old fixture by changing a version number.
  - Every `tests/season*-continuation.test.js` must keep passing.
- **Format change checklist:**
  1. Bump `SEASON_SCHEMA_VERSION` (`src/domain/season.ts`) and extend `SeasonFormatVersion`.
  2. Migrate in `parseSeason` (`src/storage/season-storage.ts`), including the version guards that reject new fields in older formats.
  3. Add a row to `ADDED_BY_FORMAT` (`tests/helpers/season-format.ts`) and a strip step to `tests/helpers/legacy-season.ts`.
  4. Add migration and corruption-rejection tests.
  5. Bump `SAVE_CHECKS_VERSION` when stricter checks must invalidate earlier local certificates.
- **Old careers keep their rules.** New behaviour applies to new worlds only, or from a dated activation point onwards. Older embedded worlds keep their original schedules, rankings, rosters, contracts and finances. Real-world IDs change prefix when new worlds gain a new rule (currently `real-bcl-`).
- **Validation:**
  - Portable imports always get the full strict check. `parseSealedSeason` is only for local saves with a valid fingerprint.
  - Never relax strict checks or drop history evidence to gain speed.
  - Save limit: 32 MiB.
  - The checks rebuild each season from its own divisions, results and fixtures.

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
- Real player data is never committed or deployed until data rights are cleared. Private packs stay in `.local-data/` and load only in the browser.
- Keys live only in `*.local` files, which Git ignores. Never print, commit or bundle them. This repository is public, and every push to `main` goes live on Vercel.
- Ask the owner before any paid option.

**Tests**
- Run the full suite serially. Long tests carry their own time limits.
- Never weaken assertions or raise time limits to hide a failure.
- Temporary private checks (`tests/zz-*`) are local-only and deleted before the build and before any commit.

## Local-only work

These need the owner's Windows machine: the private pack, API-Sports or Supabase keys, or headless Edge.
- **3.4d-4:** real lower-division club names from API-Sports into a new private pack, then a private season across a season end.
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
4. **European games (3.5b-c), with a new real-data career whose world includes a EuroLeague club:** the first EuroLeague game is on Thursday 24 September; on a Saturday without a domestic game the screen says "No game today" when a European game follows that week; opponents from leagues not chosen play with their real squads; the EuroLeague club's ledger shows its European home gates.
5. **Quick play-test of the feedback fixes:**
   - Start a new career and check the country-filtered league list, the speed meter and the "Preparing your career…" panel. These were checked automatically in Edge.
   - Then check in Transfers that only some players' contracts end after the first season.

## Suggestions for the owner

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
