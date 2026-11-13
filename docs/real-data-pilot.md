# Real-data pilot (sprint 2)

Started 13 November 2026 after the owner approved the [feasibility report](real-data-feasibility.md) and bought the API-Sports **Pro** plan (7,500 requests a day, 300 a minute, current seasons, several games per box-score request; renews 13 December 2026). A check confirmed current data: Shane Larkin is in Fenerbahçe's 2026-27 squad, no longer Anadolu Efes'.

## Steps

| Step | Status |
| --- | --- |
| 2.1 Database tables in the owner's Supabase project | Done |
| 2.2 Importer: German BBL and EuroLeague, 2025-26 and 2026-27 | Done |
| 2.3 Club identities: city, arena and colours (hand-maintained, owner checks) | In progress: file applied, awaiting the owner's check |
| 2.4 Player ratings from statistics, with a top-player list for a human check | Done (draft `2026.11-pilot`; owner's check of the top lists welcome) |
| 2.5 Merge the provider's duplicate player listings | Done |
| 2.6a A versioned, private game pack | Done |
| 2.6b Friendly matches between real clubs from a loaded pack (exhibition) | Done |
| 2.7 A repeat import and a second version that leave earlier versions and saved games unchanged | Done (`2026.11-pilot-2`, rules rating-2) |
| 2.8 A new career with the real clubs from a pack (owner's plan, phase 5 item 9; feasibility report point 5) | Planned: steps to be agreed with the owner. The step list above stopped at friendlies; the owner noticed (13 November 2026) that a new career still uses the fictional clubs. |

## How it works

- **Keys** live in two private files in the project folder, `api-sports-key.local` and `supabase-key.local`. Git ignores them; never print, commit or bundle them.
- **Database:** Supabase project `BasketBallManager` (`kesxznybhotzduvcwiwm`, free plan). The schema is in `supabase/migrations/`; every table has row level security with no policies, so only the importer's secret key can read or write. The game never reads the database.
- **Club identities:** `real-data/club-identities.csv` holds each club's display name, three-letter short name, country, city, arena, colours and a confidence (sure, likely or unknown). Unknown colours stay empty rather than guessed. `npm.cmd run data:identities` applies the file without any API request; every import also applies it. `tests/real-data-identities.test.js` keeps the file valid.
- **Ratings:** `npm.cmd run data:ratings -- --version <name>` (`scripts/real-data-ratings.mjs`, rules in `RATING_RULES`) rates every player with statistics into a draft dataset version (`player_ratings`, with `method` and `estimated` per player) and writes a top-15 list per competition, by the game's 1-99 overall rating, to `.local-data/real-data/ratings-report-<name>.md`. The version must be named: published versions never change. `--preview` computes the ratings and the report without saving anything. Season totals come from the `player_season_totals` view.
- **Pack:** `npm.cmd run data:pack -- --version <name>` (`scripts/real-data-pack.mjs`) builds `.local-data/real-data/packs/real-<version>.json`: the current season's competitions, clubs (with identities) and squads with game abilities, positions and estimated builds, plus source and a notice that the data is private. Checks run first (every club at least ten players, every ability 1-20, unique short names); a failed pack is not written. The file holds a SHA-256 fingerprint and the version is marked published in `dataset_versions`. **Versions are immutable:** rebuilding one with different contents is refused, the ratings script refuses to change a published version, and a new pack is written only if every earlier published pack still matches its recorded checksum, so newer data always gets a new version. Real player data stays on this computer (Git ignores `.local-data/`) and must not be uploaded or deployed until its rights are cleared (owner's plan, section 11).
- **Update check:** `npm.cmd run data:verify` (`scripts/real-data-verify.mjs`, read-only) fingerprints every published version's ratings, checks every published pack file against its checksum, and checks that merged duplicate players hold no box scores and no squad place their kept record lacks. `-- --save before.json` keeps a snapshot; `-- --compare before.json` reports any change to a version published in that snapshot.
- **Import:** `npm.cmd run data:import` (`scripts/real-data-import.mjs`). It matches clubs, players and competitions through their API-Sports IDs, so it can be rerun safely; finished games whose statistics are stored are not requested again. Each run is logged in `import_runs`; problems go to `data_quality_issues`.

## First import (13 November 2026)

| | Clubs | Squad places | Games | Played | Box-score lines |
| --- | --- | --- | --- | --- | --- |
| BBL 2025-26 | 18 | 319 | 338 | 338 | 6,793 |
| BBL 2026-27 | 18 | 254 | 305 | 70 | 1,447 |
| EuroLeague 2025-26 | 20 | 462 | 402 | 402 | 8,521 |
| EuroLeague 2026-27 | 20 | 389 | 380 | 107 | 2,416 |

902 players and 39 clubs (Bayern plays both competitions); about 160 API requests over two runs. The first run stopped on a box-score line naming a club the provider lists nowhere (ID 7886); the importer now places such a line by the player's squad when that squad played the game, otherwise skips it, and records either case. The rerun continued where the first stopped.

## Update test and second version (step 2.7, 13 November 2026)

The owner's plan asks for an update that leaves the existing data intact (phase 5, item 8). Procedure, all on the live database: a snapshot of the published version (`data:verify -- --save`); a repeat import (88 API requests; 2 newly played games, 44 box-score lines; no clubs or players added); a comparison (`--compare`: unchanged); new ratings into `2026.11-pilot-2` and its pack; a final comparison (unchanged). Rebuilding the old pack is refused because the database has moved on (3 squad entries differ, for example shirt numbers), and re-rating it is refused because it is published; its file still matches its fingerprint. Saved friendlies hold their own copy of both squads and never read a pack again (test below). For careers, step 2.8 will keep each career's world inside its save in the same way.

**Rules rating-2** (Krutwig at 93 showed two weaknesses of rating-1):
- **Small samples:** minutes per game and availability were taken at face value, so eight full games gave top stamina and defence. They are now pulled towards the position average until 10 games (`priorGames`), like the per-40 rates (200 minutes) and shooting (60/100/40 attempts) already were.
- **League conversion statistic by statistic:** rating-1 measured one factor from points and applied it only to rebounds and assists, plus a small shooting reduction (0.8 points). rating-2 measures each statistic from the 22 player-seasons in both competitions (`leagueGap`): two-point attempts x0.974, three-point attempts x0.933, rebounds x0.856, assists x0.95, minutes per game x0.968, two-point % -2.4 and three-point % -0.9 points (bounds: factors 0.75-1, shooting 0-5 points; defaults if fewer than 5 such players).

Effect on the 655 players with enough minutes: 22 five-star, 34 four-and-a-half, 73 four, 80 three-and-a-half, 125 three, 125 two-and-a-half, 91 two, 52 one-and-a-half and 53 one-star. The BBL without Bayern moved down against the EuroLeague (top 10% from 73 instead of 76, median 59 instead of 61; EuroLeague 81 and 64). Examples (rating-1 -> rating-2): Cameron Krutwig 93 -> 84, Phlandrous Fleming Jr. 86 -> 78, London Perrantes 81 -> 76, Spencer Reaves 85 -> 85, Aleksandar Vezenkov 94 -> 96, Edy Tavares 95 -> 95, Mike James 83 -> 86, Kendrick Nunn 86 -> 88, Facundo Campazzo 89 -> 88, Shane Larkin 75 -> 75, Mario Hezonja 70 -> 72. Krutwig still rests on 206 minutes; more games will settle him. Pack `2026.11-pilot-2`: 37 clubs, 595 players, 487 players with changed abilities and 11 with changed positions against the first pack.

Tests: `tests/real-data-ratings.test.js` (8: conversion measured and bounded, same statistics rate lower in the domestic league, a handful of full games no longer gives top stamina, the report uses the game's rating), `tests/real-data-pack.test.js` (3: a missing or changed earlier pack is found), `tests/real-data-verify.test.js` (2: order-independent ratings fingerprint, any change to a published version is reported), `tests/data-pack.test.js` (4: a saved friendly keeps its players when a newer pack changes them). The game's overall rating lives in `src/world/overall-rating.ts` (no other imports), so the ratings report shows the same numbers as the game. Verified: build; full serial suite 132 files / 2,112 tests; headless Edge loads the new pack and shows Krutwig at 84 (4.5 stars) in Phoenix Hagen vs Real Madrid, without overflow at 1440 and 390 px.

## First ratings (13 November 2026, `2026.11-pilot`, rules rating-1)

837 players rated (182 with too few minutes, rated from position and league and marked estimated). Rules: the current season counts fully, the previous at 70%; shooting is pulled towards the position average until 60 two-point, 100 three-point and 40 free-throw attempts; pooled scales keep positional differences; the game's scale puts an average player at 12. The **domestic strength factor was measured, not assumed**: 22 players who played the BBL and the EuroLeague in the same season score about 10% less per 40 minutes in the EuroLeague, so BBL production is scaled by 0.896. Defence is always an estimate (no steals, blocks or fouls in the data); positions PG/SG/SF/PF/C come from playing style, and heights and weights are estimated by position.

**Free-throw problem found and handled:** the provider's EuroLeague free throws are unreliable. In 2025-26, about 1,330 of 8,520 lines have no free throws although the points need them; in 2026-27, players "made" more free throws than they attempted (116% overall; 91% even on lines whose points add up). The `player_season_totals` view now also adds up free throws over consistent lines only, and the ratings ignore a competition season whose league-wide free-throw rate is outside 65-85% (currently only EuroLeague 2026-27). BBL data is clean (about 0.5% of lines inconsistent). Suggested improvement: take EuroLeague and EuroCup players' free throws, steals, blocks, turnovers and fouls from the official EuroLeague data (free, already used locally) once its terms are checked.

**Open calibration question:** the top BBL players (about 14.5 average) sat close to EuroLeague starters (about 14-16). Step 2.7 (rating-2) widened the gap; the conversion still rests on 22 Bayern player-seasons, and with the other domestic leagues imported many more players will play both competitions, so it can be re-measured.

## Real-club friendlies (step 2.6b)

In an exhibition, **Match setup › Real-club friendly…** opens a window (`src/ui/RealClubFriendly.tsx`) that loads a pack file from this computer, checks it (`parseDataPack` in `src/world/data-pack.ts`: the SHA-256 fingerprint must match the contents, every player and club must be complete) and lists its clubs by competition. **Start** plays the friendly on the normal match screen with the chosen replay code. Each side fields its twelve best-rated players (`matchdayTeam`: players without statistics last, a starting five covering PG, SG, SF, PF and C where possible, shirt numbers kept unless missing or repeated); players are drawn as neutral figures, never with a guessed appearance, and clubs without verified colours appear in grey. The pack stays in browser memory only and is never uploaded; the sidebar reads "Real clubs · private pack". Tests: `tests/data-pack.test.js` (3). Headless Edge with the real pack: a changed copy is refused with a plain explanation; the real pack loads (37 clubs, 595 players); Fenerbahçe vs Real Madrid starts with real players; window and match screen fit 1440 and 390 px; no page errors. Verified: typecheck, build, full serial suite 131 files / 2,101 tests (475 s).

**Overall rating (owner request, 13 November 2026):** the owner found no real player above three and a half stars (Vezenkov and Mike James at 3.5). The cause was the star formula, not the ratings: it averaged all seven skills, so a great shooter's weaker rebounding pulled him down and five stars needed 20 in everything. The game now shows a position-weighted overall rating from 1 to 99 with stars (rules in `docs/decisions.md`). On this pack: 17 five-star, 34 four-and-a-half, 57 four, 68 three-and-a-half, 92 three, 72 two-and-a-half, 71 two, 46 one-and-a-half and 119 one-star players (576 with statistics); for example Edy Tavares 95, Aleksandar Vezenkov 94, Facundo Campazzo 89, Kendrick Nunn 86, Mike James 83, Shane Larkin 75. Cameron Krutwig (Phoenix Hagen, BBL) at 93 showed weaknesses in the rating rules; step 2.7 fixed them in a new version (84 now).

**Scoring finding:** simulated games score low for every club: about 57 points per team with real clubs and 62 with the fictional ones (real basketball: about 80). The real ratings are therefore on the engine's scale; the engine itself produces too few shots and free throws per game. Match calibration is sprint 4.

## First pack (step 2.6a, 13 November 2026)

`2026.11-pilot`: 2 competitions (BBL and EuroLeague 2026-27), 37 clubs (Bayern in both), 595 players in their latest squads (12-26 per club). 19 squad members without statistics yet carry estimated below-average abilities (9); 14 clubs still lack verified colours. Example: Shane Larkin, Fenerbahçe, PG, three-point 16, free throws 16, passing 15 (height and weight estimated).

## Duplicate players (step 2.5)

`merge_duplicate_players()` (migration `20261113140000_merge_duplicate_players.sql`) merges two records only when the initials-only names match exactly, both are in the same club's squad in the same season, and they never appear in the same game. The kept record (more box-score lines, then the older) receives the provider IDs, box scores and squad places; the duplicate is marked `merged_into` rather than deleted (the Supabase connector refuses migrations that delete rows), and ratings and packs ignore marked records. Every merge is logged in `player_merges`. The importer runs it after every import, and repeated provider IDs of a merged player are collapsed before saving. First run: E. Colbert and K. Dye (Würzburg) merged; the two M. Weathers records (Heidelberg) were kept apart because they appear in the same game eleven times; the two J. Wright records belong to different clubs. 835 players are now rated.

**Data-quality findings** (latest run): 339 squad entries with incomplete provider details (initials only, or no nationality or position), 47 names whose order should be checked, 9 box-score lines placed by squad and 2 skipped, 3 games whose reported arena is a person. The provider lists three players twice under different IDs in the same squad (all initials-only: E. Colbert and K. Dye at Würzburg, M. Weathers at Heidelberg); they need merging before ratings. Two "J. Wright" entries at Bamberg and Bonn are probably different players.
