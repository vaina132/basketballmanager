# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** when a step is finished, update "Current state" and "Next steps" here, and add the step's detailed notes (what changed, tests, measurements) to the top of `docs/handover-history.md` under a dated heading. Keep this file under 20 KB, with exactly one current entry.

## Current state (15 November 2026, after step 3.4d-1 and part of 3.4d-2)

**Active level:** Sprint 3, the multi-league world ([docs/multi-league-world.md#steps](docs/multi-league-world.md#steps)).

Since Level 7 was accepted, the levels are the owner's sprints, in this order:
1. Sprint 3: multi-league world (active)
2. Sprint 4: realism
3. Saved ideas
4. Release preparation
5. Interface simplification (last)

**Active step:** 3.4, domestic playoffs, titles, and promotion and relegation. The next step is the rest of 3.4d-2 (see "Next steps").

**Code baseline:**
- Step 3.4d-2b part 1 commit on `main` (cloud session); save format **55** (`SEASON_SCHEMA_VERSION`), `compact-2` encoding, `SAVE_CHECKS_VERSION` 3.
- Last verification, on Linux (cloud): full serial suite **2,580 tests / 190 files passed** (576 s), and `npm run build` passed with the known chunk-size advisory.
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
  - **3.4d-1** background-club foundation (format 53): `world.lowerDivisions` (a country's real next division, identities only; never Italy or France) and `SeasonState.background` (clubs outside the full world with their squads; empty until 3.4d-2). `src/world/background.ts`: a background club from a full-world club, its squad aged to a date, a matchday selection and the save checks.
- **3.6 so far:** country flags, multi-country selection, a league list filtered by country, roster counts, a squad-strength bar and a game-speed meter.
- **Owner feedback round (15 November 2026)**, placements in `docs/decisions.md#owner-feedback-after-playing-15-november-2026`:
  - Setup screen fixed, and the injury and replay options removed.
  - "Preparing your career…" panel; careers are now built in the worker.
  - Opening contracts of 1-3 seasons (`world.playerContracts`).

**Unfinished in sprint 3:** 3.4d-2 to 3.4d-4, 3.5, the rest of 3.6, and 3.7.

**Known open points:**
- The Competition screen's player statistics combine regular-season and playoff games.
- Primera FEB's one-venue final stage still gives the listed home club its home advantage.
- The Turkish TBL postseason is a labelled default; its statute has not been found.
- Clubs relegated out of the full world stay in their division until 3.4d (the playoff panel says so).
- New worlds rank Greece's, Turkey's and Spain's second division by the labelled FIBA default (no readable official rule). Worlds created before format 51 keep the prototype order outside France; format-51 worlds keep the FIBA default.
- **Large worlds are slow** (address at 3.7):
  - a 36-club season with every system takes 341 s;
  - the strict check of its season-two opening save takes 18 s;
  - the all-countries world (173 clubs) took about ten minutes to create and check.
- Strict validation of long careers grows with career length. The academy and relationship replays are the main costs; a performance step is needed before release.
- The private data still has unresolved records: 263 club assignments, 169 official identities, 17 extra provider IDs and 2,811 estimated precise positions. See `docs/player-data-quality.md`.

## Next steps (plan order)

Each step below should fit one session. A step that needs private data, keys or Edge is marked **local-only**: a cloud session lists it under "Local-only work" and moves on to the next step that does not need them. Never start Sprint 4: after the last sprint-3 step a session can do, stop and write the sprint-3 summary here.

**Order note:** the plan table ([docs/multi-league-world.md](docs/multi-league-world.md#plan-for-the-rest-of-34-15-november-2026-claude-continuing-after-codex)) lists 3.4d before 3.4e. The owner approved doing 3.4e first on 15 November 2026. Reasons: 3.4e needs no private data and has no open questions, while 3.4d has two owner questions (below) and a local-only data part. The plan table has been updated to match this order.

1. **3.4d-2: leaving and joining at season end.**
   - Relegated clubs of the lowest full division in a country leave as background clubs.
   - The same number of clubs come up from the real next division:
     - a club that left earlier returns with its squad;
     - a first-time club gets a generated squad labelled "generated", plus the usual estimated finances, president, sponsor, wages and contracts.
   - Test with synthetic worlds that carry a list of next-division clubs.
   - **Owner decisions (15 November 2026, recorded in `docs/decisions.md#owner-decisions-for-step-34d-2-15-november-2026`):**
     - **(a)** If the manager's own club is relegated out of the full world, treat it like a dismissal: the season-end choice offers jobs at full-world clubs, with at least one offer guaranteed.
     - **(b)** Italy and France have no relegation out of the full world for now (API-Sports has no Serie B or NM1 clubs); their 3.4c behaviour stays.
   - Defaults a session may take and record as reversible in `docs/decisions.md`: promoted clubs are chosen from an estimated next-division table (squad strength plus a seeded random element, as for the plan's background tables), and generated squads are rated just below the division they join.
   - **Done so far:** pure functions in `src/world/lower-division.ts` (estimated next-division table, the season-end exchange per country, generated squads; `tests/lower-division.test.js`). **3.4d-2a (format 54):** `withLowerDivisions` builds each next-division club into the world with its generated squad and estimated club data; such clubs stay outside the full world (`fullWorldClubs`, catalog excludes them; `tests/lower-division-world.test.js`). Defaults in `docs/decisions.md` (3.4d-2 sections).
   - **3.4d-2b part 1 (format 55, no behaviour change yet):** `background.changesFrom` and `background.exchanges` (empty until the producer exists; careers saved earlier start a season later), `BackgroundClub.until`, `employment.departures` and contract kind `joined` (types; refused by the checks for now). Contracted clubs follow `fullWorldClubsIn(context, season)`; the catalog adds joined clubs' players (`joinedPlayers`) and hides players away with their club (`getActiveCareerPlayers`). Fixtures `season54-exchange-legacy-*` (with a next division, captured with `--lower`).
   - **Still to do (part 2):** compute the exchange when a season completes (before the manager's season-end decision), record departures and joined contracts, keep leaving clubs out of the offseason market, move them to `background` at rollover and bring joining clubs into every system, rebuild all of it in the save checks, move leaving clubs into `state.background` and out of every system, bring returning and first-time clubs in (club data for first-time clubs: venue, sponsor, president, wages and contracts estimated as in `worldFromPack`), the save checks for all of it, and owner decision (a) in `seasonEndOutlook` (at least one offer when the manager's club leaves).
   - Foundation to use (3.4d-1): `backgroundClubFrom`, `validateBackgroundClub`, `world.lowerDivisions`; `validateBackground` currently refuses any listed club and must instead rebuild the record from each season's outcomes. Capture format-53 fixtures first (`scripts/capture-format-baseline.mjs <label> --fiba`); careers created before the new format keep their clubs (activation point, like `divisions.changesFrom`).
   - **Size warning:** about 150 places in `src/world` and `src/storage` handle every club (finances, staff, payroll, contracts, scouting, academy, youth, facilities, commercial, board, relationships, market). Most weekly systems loop over `state.clubs`, so a club removed from it at rollover stops being processed; the work is closing each system's records for a departing club (contracts, staff, sponsorship, facilities, academy and youth teams), creating them for an arriving one, and teaching every replay check about departures and arrivals. Expect several sessions, in this order: (i) leaving, (ii) returning, (iii) first-time clubs with generated squads and estimated club data, (iv) the manager's own club (owner decision (a)).
2. **3.4d-3: screens.**
   - The Competition and playoff panels show clubs leaving and joining; remove the "stay until 3.4d" note.
   - Generated players are labelled on Squad, profile and scouting screens.
3. **3.4d-4 (local-only): real lower-division names.**
   - Import the real names into a new private pack. API-Sports lists Turkey's TB2L, Spain's Segunda FEB, Germany's Pro A and Greece's A2.
   - Run a private real-data season across a season end.
   - Update the 3.4 rows in the plan tables.
4. **3.5: European competitions.** Proposed split; the first 3.5 session checks it against the plan and records it in `docs/multi-league-world.md`.
   - **(a)** The three competitions and their entrants in the world. Entrants from leagues that were not chosen, and from countries outside the six, become background clubs.
   - **(b)** Midweek European game days on the shared calendar, with draws at the season start:
     - EuroCup and BCL on Tuesdays and Wednesdays;
     - the EuroLeague on Thursdays, and also Tuesdays in its double-round weeks.
   - **(c)** EuroLeague format.
   - **(d)** EuroCup format.
   - **(e)** BCL format.
   - **(f)** Estimated background tables for unchosen leagues and European places for next season (the reversible default in the plan).
   - **(g)** A Calendar view of the whole season (owner feedback point 8) and the European Competition screens.
   - Open research before (c)-(e), from free sources: the EuroLeague third-place game, the 2026-27 BCL rules and EuroLeague licences (`docs/competition-rules-2026.md`, "Still to verify").
5. **3.6: measured speed and save-size estimates, with Europe in setup.**
   - The screen work can be done in the cloud.
   - Measuring with the real pack is local-only.
6. **3.7 (local-only): final check.**
   - A multi-league season with Europe in the browser, save and load, rollover into season two, and five-season speed and size measurements (target: loads in about 5 s; well inside the 32 MiB save limit).
   - A cloud session may prepare a public synthetic five-season test first.
7. **Stop:** write the sprint-3 summary here and wait for the owner.

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
- **Old careers keep their rules.** New behaviour applies to new worlds only, or from a dated activation point onwards. Older embedded worlds keep their original schedules, rankings, rosters, contracts and finances. Real-world IDs change prefix when new worlds gain a new rule (currently `real-playoffs-`).
- **Validation:**
  - Portable imports always get the full strict check. `parseSealedSeason` is only for local saves with a valid fingerprint.
  - Never relax strict checks or drop history evidence to gain speed.
  - Save limit: 32 MiB.
  - The checks rebuild each season from its own divisions, results and fixtures.

**Calendar and simulation**
- `SeasonState.round` is a week and `state.date` is that week's Saturday. Wages, upkeep, staff, board and training run once a week, after the week's last game day. Gate income is per home game.
- League tables, board targets, sponsor positions and job-offer positions count regular-season games only (`isRegularFixture`).
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
3. **Quick play-test of the feedback fixes:**
   - Start a new career and check the country-filtered league list, the speed meter and the "Preparing your career…" panel. These were checked automatically in Edge.
   - Then check in Transfers that only some players' contracts end after the first season.

## Suggestions for the owner

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Optionally copy the two older fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/` for the record. Cloud sessions now use the committed `scripts/capture-format-baseline.mjs`.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
