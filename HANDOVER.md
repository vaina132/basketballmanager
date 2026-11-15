# Project handover

This file holds only the current state, the next steps and the rules that must not be broken. Finished steps, verification logs and earlier notes are in [docs/handover-history.md](docs/handover-history.md). Search that file; never read it in full.

**Keeping this file short:** when a step is finished, update "Current state" and "Next steps" here, and add the step's detailed notes (what changed, tests, measurements) to the top of `docs/handover-history.md` under a dated heading. Keep this file under 20 KB, with exactly one current entry.

## Current state (15 November 2026)

**Active level:** Sprint 3, the multi-league world ([docs/multi-league-world.md#steps](docs/multi-league-world.md#steps)).

Since Level 7 was accepted, the levels are the owner's sprints, in this order:
1. Sprint 3: multi-league world (active)
2. Sprint 4: realism
3. Saved ideas
4. Release preparation
5. Interface simplification (last)

**Active step:** 3.4, domestic playoffs, titles, and promotion and relegation. The next step is 3.4e (see "Next steps").

**Code baseline:**
- Owner commit `4aad3c9` on `main`; save format **50** (`SEASON_SCHEMA_VERSION`), `compact-2` encoding, `SAVE_CHECKS_VERSION` 3.
- Last verification, on Windows at that commit: full serial suite **2,524 tests / 180 files passed** (752 s), and `npm run build` passed with the known chunk-size advisory.
- The suite has not yet run on Linux. If the first cloud run fails before any test runs, check for file-name case mismatches first: Linux file names are case-sensitive.

**Done in sprint 3** (details in the history, search for the step number):
- **3.1 data:** all 13 competitions imported and rated. The private pack `real-2026.11-world-3.json` (local only) covers 223 clubs and about 3,087 players.
- **3.2 save scaling** for a single league. Combined-world acceptance waits for 3.7.
- **3.3 domestic calendar:** one shared weekly calendar for all chosen leagues, with real byes for odd fields, a table per league, weekly settlement and gate income per home game (format 47).
- **3.4 so far:**
  - French LNB regular-season ranking rule (`lnb-2026-1`, format 48).
  - **3.4a** game days inside a week. Saturday stays the decision day; extra game days fall on Tuesday and Thursday.
  - **3.4b** every league's sourced 2026-27 postseason (format 49).
  - **3.4c** promotion and relegation between a country's two divisions. Each season records its divisions (format 50).
- **3.6 so far:** country flags, multi-country selection, a league list filtered by country, roster counts, a squad-strength bar and a game-speed meter.
- **Owner feedback round (15 November 2026)**, placements in `docs/decisions.md#owner-feedback-after-playing-15-november-2026`:
  - Setup screen fixed, and the injury and replay options removed.
  - "Preparing your career…" panel; careers are now built in the worker.
  - Opening contracts of 1-3 seasons (`world.playerContracts`).

**Unfinished in sprint 3:** 3.4e, 3.4d, 3.5, the rest of 3.6, and 3.7.

**Known open points:**
- The Competition screen's player statistics combine regular-season and playoff games.
- Primera FEB's one-venue final stage still gives the listed home club its home advantage.
- The Turkish TBL postseason is a labelled default; its statute has not been found.
- Clubs relegated out of the full world stay in their division until 3.4d (the playoff panel says so).
- Ranking rules other than France's still use the prototype order (3.4e).
- **Large worlds are slow** (address at 3.7):
  - a 36-club season with every system takes 341 s;
  - the strict check of its season-two opening save takes 18 s;
  - the all-countries world (173 clubs) took about ten minutes to create and check.
- Strict validation of long careers grows with career length. The academy and relationship replays are the main costs; a performance step is needed before release.
- The private data still has unresolved records: 263 club assignments, 169 official identities, 17 extra provider IDs and 2,811 estimated precise positions. See `docs/player-data-quality.md`.

## Next steps (plan order)

Each step below should fit one session. A step that needs private data, keys or Edge is marked **local-only**: a cloud session lists it under "Local-only work" and moves on to the next step that does not need them. Never start Sprint 4: after the last sprint-3 step a session can do, stop and write the sprint-3 summary here.

**Order note:** the plan table ([docs/multi-league-world.md](docs/multi-league-world.md#plan-for-the-rest-of-34-15-november-2026-claude-continuing-after-codex)) lists 3.4d before 3.4e. The owner approved doing 3.4e first on 15 November 2026. Reasons: 3.4e needs no private data and has no open questions, while 3.4d has two owner questions (below) and a local-only data part. The plan table has been updated to match this order.

1. **3.4e-1: default tie-break rule.**
   - Add the FIBA Official Basketball Rules 2026, Appendix D, as a labelled standings rule for new worlds whose leagues have no sourced rule yet (source link in `docs/competition-rules-2026.md`).
   - Old worlds keep their original ranking. Never apply the French rule elsewhere.
   - Reading a table must not use match randomness. Final ties are settled by the reproducible draw pattern of `lnb-2026-1`.
   - Strict save checks must reject a wrong rule for a country.
2. **3.4e-2: league-specific rules where a current official source exists.**
   - Candidates: ACB (published rules dated 2023, so check they still apply), Italy's FIP article 62 (scoring quotients; the foul criteria need team-foul evidence the game may not keep), BSL, BBL, GBL and TBL.
   - Record each source in `docs/competition-rules-2026.md`. Where no source is found, keep the FIBA default and say so.
3. **3.4d-1: background clubs foundation** (shared with 3.5).
   - A record for clubs outside the full world. It keeps the identity and, for a relegated club, the real squad, which ages at rollover.
   - Background clubs have no finances, staff, academy, board, contracts or transfers, and their players cannot be signed in sprint 3 (plan table "Levels of detail").
   - Capture genuine format-50 fixtures first (see "Rules"). New save format with migration and corruption tests.
4. **3.4d-2: leaving and joining at season end.**
   - Relegated clubs of the lowest full division in a country leave as background clubs.
   - The same number of clubs come up from the real next division:
     - a club that left earlier returns with its squad;
     - a first-time club gets a generated squad labelled "generated", plus the usual estimated finances, president, sponsor, wages and contracts.
   - Test with synthetic worlds that carry a list of next-division clubs.
   - **Owner decisions needed before this step:**
     - **(a)** What happens when the manager's own club is relegated out of the full world? Recommended default: treat it like a dismissal, so the season-end choice offers jobs at full-world clubs, with at least one offer guaranteed.
     - **(b)** API-Sports has no clubs for Italy's Serie B or France's NM1. Recommended default: Italy and France have no relegation out of the full world until free official club lists are added (local-only), so the 3.4c behaviour stays.
   - Defaults a session may take and record as reversible in `docs/decisions.md`: promoted clubs are chosen from an estimated next-division table (squad strength plus a seeded random element, as for the plan's background tables), and generated squads are rated just below the division they join.
5. **3.4d-3: screens.**
   - The Competition and playoff panels show clubs leaving and joining; remove the "stay until 3.4d" note.
   - Generated players are labelled on Squad, profile and scouting screens.
6. **3.4d-4 (local-only): real lower-division names.**
   - Import the real names into a new private pack. API-Sports lists Turkey's TB2L, Spain's Segunda FEB, Germany's Pro A and Greece's A2.
   - Run a private real-data season across a season end.
   - Update the 3.4 rows in the plan tables.
7. **3.5: European competitions.** Proposed split; the first 3.5 session checks it against the plan and records it in `docs/multi-league-world.md`.
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
8. **3.6: measured speed and save-size estimates, with Europe in setup.**
   - The screen work can be done in the cloud.
   - Measuring with the real pack is local-only.
9. **3.7 (local-only): final check.**
   - A multi-league season with Europe in the browser, save and load, rollover into season two, and five-season speed and size measurements (target: loads in about 5 s; well inside the 32 MiB save limit).
   - A cloud session may prepare a public synthetic five-season test first.
10. **Stop:** write the sprint-3 summary here and wait for the owner.

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
  - The capture scripts for formats 46-49 were in the ignored `.artifacts` folder and are not in the repository. Write the script under `scripts/` and commit it with the fixtures.
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
2. **Quick play-test of the feedback fixes:**
   - Start a new career and check the country-filtered league list, the speed meter and the "Preparing your career…" panel. These were checked automatically in Edge.
   - Then check in Transfers that only some players' contracts end after the first season.

## Suggestions for the owner

- Show regular-season and playoff player statistics separately on the Competition screen.
- Play Primera FEB's one-venue final stage without home advantage.
- Copy the two fixture capture scripts from `.artifacts` (`capture-postseason-baseline.mjs`, `capture-divisions-baseline.mjs`) into `scripts/`, so that cloud sessions can reuse them for the next format change.
- Make creating and checking large worlds faster before 3.7, because large worlds are slow today (see "Known open points").
