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
| 2.6 A versioned game pack, and a new career that starts from it | Planned |
| 2.7 A repeat import that leaves existing careers unchanged | Planned |

## How it works

- **Keys** live in two private files in the project folder, `api-sports-key.local` and `supabase-key.local`. Git ignores them; never print, commit or bundle them.
- **Database:** Supabase project `BasketBallManager` (`kesxznybhotzduvcwiwm`, free plan). The schema is in `supabase/migrations/`; every table has row level security with no policies, so only the importer's secret key can read or write. The game never reads the database.
- **Club identities:** `real-data/club-identities.csv` holds each club's display name, three-letter short name, country, city, arena, colours and a confidence (sure, likely or unknown). Unknown colours stay empty rather than guessed. `npm.cmd run data:identities` applies the file without any API request; every import also applies it. `tests/real-data-identities.test.js` keeps the file valid.
- **Ratings:** `npm.cmd run data:ratings` (`scripts/real-data-ratings.mjs`, rules in `RATING_RULES`) rates every player with statistics into draft dataset version `2026.11-pilot` (`player_ratings`, with `method` and `estimated` per player) and writes a top-15 list per competition to `.local-data/real-data/ratings-report.md`. Season totals come from the `player_season_totals` view.
- **Import:** `npm.cmd run data:import` (`scripts/real-data-import.mjs`). It matches clubs, players and competitions through their API-Sports IDs, so it can be rerun safely; finished games whose statistics are stored are not requested again. Each run is logged in `import_runs`; problems go to `data_quality_issues`.

## First import (13 November 2026)

| | Clubs | Squad places | Games | Played | Box-score lines |
| --- | --- | --- | --- | --- | --- |
| BBL 2025-26 | 18 | 319 | 338 | 338 | 6,793 |
| BBL 2026-27 | 18 | 254 | 305 | 70 | 1,447 |
| EuroLeague 2025-26 | 20 | 462 | 402 | 402 | 8,521 |
| EuroLeague 2026-27 | 20 | 389 | 380 | 107 | 2,416 |

902 players and 39 clubs (Bayern plays both competitions); about 160 API requests over two runs. The first run stopped on a box-score line naming a club the provider lists nowhere (ID 7886); the importer now places such a line by the player's squad when that squad played the game, otherwise skips it, and records either case. The rerun continued where the first stopped.

## Ratings (13 November 2026, draft `2026.11-pilot`)

837 players rated (182 with too few minutes, rated from position and league and marked estimated). Rules: the current season counts fully, the previous at 70%; shooting is pulled towards the position average until 60 two-point, 100 three-point and 40 free-throw attempts; pooled scales keep positional differences; the game's scale puts an average player at 12. The **domestic strength factor was measured, not assumed**: 22 players who played the BBL and the EuroLeague in the same season score about 10% less per 40 minutes in the EuroLeague, so BBL production is scaled by 0.896. Defence is always an estimate (no steals, blocks or fouls in the data); positions PG/SG/SF/PF/C come from playing style, and heights and weights are estimated by position.

**Free-throw problem found and handled:** the provider's EuroLeague free throws are unreliable. In 2025-26, about 1,330 of 8,520 lines have no free throws although the points need them; in 2026-27, players "made" more free throws than they attempted (116% overall; 91% even on lines whose points add up). The `player_season_totals` view now also adds up free throws over consistent lines only, and the ratings ignore a competition season whose league-wide free-throw rate is outside 65-85% (currently only EuroLeague 2026-27). BBL data is clean (about 0.5% of lines inconsistent). Suggested improvement: take EuroLeague and EuroCup players' free throws, steals, blocks, turnovers and fouls from the official EuroLeague data (free, already used locally) once its terms are checked.

**Open calibration question:** the top BBL players (about 14.5 average) sit close to EuroLeague starters (about 14-16). The factor rests on 22 Bayern players; with the other domestic leagues imported, many more players will play both competitions and the factor can be re-measured.

## Duplicate players (step 2.5)

`merge_duplicate_players()` (migration `20261113140000_merge_duplicate_players.sql`) merges two records only when the initials-only names match exactly, both are in the same club's squad in the same season, and they never appear in the same game. The kept record (more box-score lines, then the older) receives the provider IDs, box scores and squad places; the duplicate is marked `merged_into` rather than deleted (the Supabase connector refuses migrations that delete rows), and ratings and packs ignore marked records. Every merge is logged in `player_merges`. The importer runs it after every import, and repeated provider IDs of a merged player are collapsed before saving. First run: E. Colbert and K. Dye (Würzburg) merged; the two M. Weathers records (Heidelberg) were kept apart because they appear in the same game eleven times; the two J. Wright records belong to different clubs. 835 players are now rated.

**Data-quality findings** (latest run): 339 squad entries with incomplete provider details (initials only, or no nationality or position), 47 names whose order should be checked, 9 box-score lines placed by squad and 2 skipped, 3 games whose reported arena is a person. The provider lists three players twice under different IDs in the same squad (all initials-only: E. Colbert and K. Dye at Würzburg, M. Weathers at Heidelberg); they need merging before ratings. Two "J. Wright" entries at Bamberg and Bonn are probably different players.
