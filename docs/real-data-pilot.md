# Real-data pilot (sprint 2)

Started 13 November 2026 after the owner approved the [feasibility report](real-data-feasibility.md) and bought the API-Sports **Pro** plan (7,500 requests a day, 300 a minute, current seasons, several games per box-score request; renews 13 December 2026). A check confirmed current data: Shane Larkin is in Fenerbahçe's 2026-27 squad, no longer Anadolu Efes'.

## Steps

| Step | Status |
| --- | --- |
| 2.1 Database tables in the owner's Supabase project | Done |
| 2.2 Importer: German BBL and EuroLeague, 2025-26 and 2026-27 | Done |
| 2.3 Club identities: city, arena and colours (hand-maintained, owner checks) | In progress: file applied, awaiting the owner's check |
| 2.4 Player ratings from statistics, with a top-player list for a human check | Planned |
| 2.5 A versioned game pack, and a new career that starts from it | Planned |
| 2.6 A repeat import that leaves existing careers unchanged | Planned |

## How it works

- **Keys** live in two private files in the project folder, `api-sports-key.local` and `supabase-key.local`. Git ignores them; never print, commit or bundle them.
- **Database:** Supabase project `BasketBallManager` (`kesxznybhotzduvcwiwm`, free plan). The schema is in `supabase/migrations/`; every table has row level security with no policies, so only the importer's secret key can read or write. The game never reads the database.
- **Club identities:** `real-data/club-identities.csv` holds each club's display name, three-letter short name, country, city, arena, colours and a confidence (sure, likely or unknown). Unknown colours stay empty rather than guessed. `npm.cmd run data:identities` applies the file without any API request; every import also applies it. `tests/real-data-identities.test.js` keeps the file valid.
- **Import:** `npm.cmd run data:import` (`scripts/real-data-import.mjs`). It matches clubs, players and competitions through their API-Sports IDs, so it can be rerun safely; finished games whose statistics are stored are not requested again. Each run is logged in `import_runs`; problems go to `data_quality_issues`.

## First import (13 November 2026)

| | Clubs | Squad places | Games | Played | Box-score lines |
| --- | --- | --- | --- | --- | --- |
| BBL 2025-26 | 18 | 319 | 338 | 338 | 6,793 |
| BBL 2026-27 | 18 | 254 | 305 | 70 | 1,447 |
| EuroLeague 2025-26 | 20 | 462 | 402 | 402 | 8,521 |
| EuroLeague 2026-27 | 20 | 389 | 380 | 107 | 2,416 |

902 players and 39 clubs (Bayern plays both competitions); about 160 API requests over two runs. The first run stopped on a box-score line naming a club the provider lists nowhere (ID 7886); the importer now places such a line by the player's squad when that squad played the game, otherwise skips it, and records either case. The rerun continued where the first stopped.

**Data-quality findings** (latest run): 339 squad entries with incomplete provider details (initials only, or no nationality or position), 47 names whose order should be checked, 9 box-score lines placed by squad and 2 skipped, 3 games whose reported arena is a person. The provider lists three players twice under different IDs in the same squad (all initials-only: E. Colbert and K. Dye at Würzburg, M. Weathers at Heidelberg); they need merging before ratings. Two "J. Wright" entries at Bamberg and Bonn are probably different players.
