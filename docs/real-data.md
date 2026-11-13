# Real data available now

When real-data integration starts, follow the owner's plan in [real-data-integration-plan.md](real-data-integration-plan.md).

Verified on 5 November 2026. The official EuroLeague Basketball data service returned real 2025-26 EuroLeague and EuroCup records immediately, without an account, API key or payment. This supersedes the earlier recommendation to wait for supplier email replies before obtaining any data.

## Open the downloaded records

In the project folder, double-click **Open real data.cmd**. It opens the downloaded records in your browser. Search a player, select a competition or club, and click a player to inspect their statistics. The four CSV links at the bottom open spreadsheet exports. No account or payment is needed.

The local dataset is generated in `.local-data/europe-2025-26/`; `browse.html` can also be opened directly. The folder is excluded from Git and the game's production bundle. The launcher downloads the pack with Node.js only if it is missing. Developers can reproduce it with `npm.cmd run data:fetch`; the importer reuses its validated snapshots unless explicitly refreshed.

The reproducible importer uses the official public endpoints listed below. It downloads reference data; it does not claim to supply a complete, licensed, game-ready career database.

## Verified source coverage

| Competition | Clubs | Player registrations | Unique players within competition | Players with accumulated season statistics |
| --- | ---: | ---: | ---: | ---: |
| EuroLeague 2025-26 | 20 | 383 | 374 | 335 |
| EuroCup 2025-26 | 20 | 358 | 358 | 316 |

There are **727 distinct player IDs across both competitions**, rather than adding the two player counts blindly. Some players appear in both competitions or change clubs. There are 741 player registration records and 651 player/competition season-statistics records.

The files contain real names, stable source IDs, club identity, nationality, birth date, height/weight where available, positions and jersey numbers, dated registration records, and season performance totals. Statistics include games, minutes, points, shooting makes/attempts, rebounds, assists, steals, turnovers, blocks and fouls.

Validation of the retrieved statistics found that all 651 rows reconcile points with two-pointers, three-pointers and free throws, makes do not exceed attempts, and every statistical player ID matches a retrieved player. This establishes consistency in those checks, not a claim that every source field is independently error-free.

The importer passed nine focused tests, and the actual offline browser passed thirteen checks covering search, competition/club filters, player selection, statistics, sorting, pagination, spreadsheet files, desktop/tablet layout, and absence of automatic external requests or JavaScript errors. All eight saved source documents match their recorded hashes; rerunning from the cache produced identical JSON.

## Important data distinctions

- These are all-season registration histories. A player listed in the season is not necessarily a member of that club on opening day or today. Registration timestamps may reflect administration and need checking against match sheets and dated announcements.
- Staff records are present in the raw people feed but are excluded from the player count.
- Missing or zero height/weight values are kept as unknown, not invented measurements. The source has 1 missing height and 3 missing weights among EuroLeague player registrations; EuroCup has 7 and 26 respectively. The generated quality report gives deduplicated counts as well.
- Registered players without an accumulated statistics record remain unknown/no record; they are not assigned a fabricated zero-stat season.
- A statistical row can combine multiple clubs, represented by source team codes such as `MUN;PAR`. It is a player/competition/season total and must not be counted once for each club.
- Club profiles may expose current names or administrative details even through a historical season route. Source values and retrieval dates are preserved; historical president, financial and facility facts are not assumed.
- The imported totals describe 2025-26 performance and can support analysis/calibration. Opening-day ability estimates should use earlier evidence to avoid future knowledge.
- No salaries, contract terms, club budgets, mental attributes, potential or 1-20 game ratings are invented by this import.
- Portrait/crest URLs are reference metadata only. No images are downloaded or automatically requested by the offline browser.

## Official endpoints used

Attribution: EuroLeague Basketball, [EuroLeague](https://www.euroleaguebasketball.net/euroleague/) and [EuroCup](https://www.euroleaguebasketball.net/eurocup/).

| Dataset | URL |
| --- | --- |
| EuroLeague season | https://api-live.euroleague.net/v2/competitions/E/seasons/E2025 |
| EuroLeague clubs | https://api-live.euroleague.net/v2/competitions/E/seasons/E2025/clubs |
| EuroLeague registrations | https://api-live.euroleague.net/v2/competitions/E/seasons/E2025/people?limit=1200&offset=0 |
| EuroLeague season totals | https://api-live.euroleague.net/v3/competitions/E/statistics/players/traditional?seasonMode=Single&seasonCode=E2025&statisticMode=Accumulated&limit=1000&offset=0 |
| EuroCup season | https://api-live.euroleague.net/v2/competitions/U/seasons/U2025 |
| EuroCup clubs | https://api-live.euroleague.net/v2/competitions/U/seasons/U2025/clubs |
| EuroCup registrations | https://api-live.euroleague.net/v2/competitions/U/seasons/U2025/people?limit=1200&offset=0 |
| EuroCup season totals | https://api-live.euroleague.net/v3/competitions/U/statistics/players/traditional?seasonMode=Single&seasonCode=U2025&statisticMode=Accumulated&limit=1000&offset=0 |

Public access was tested successfully on the research date; an API without an authenticated contract can still change or become unavailable. Preserve the downloaded snapshot and provenance rather than depending on it during gameplay.

## Remaining coverage and immediate self-service option

These records cover the two European competitions only. They do not constitute complete domestic league rosters for the twelve selected divisions or Basketball Champions League. Participating clubs from those countries do not make their entire domestic competition covered.

For additional coverage, the immediately available account-based candidate is [API-BASKETBALL](https://api-sports.io/sports/basketball), accessed through its official [registration/dashboard link](https://dashboard.api-football.com/). The free plan is activated upon registration and advertises 100 requests/day. Available free data is restricted, so 2025-26 access must be tested on the actual account. The published PRO tier advertises 7,500 requests/day; check the currency and billing terms shown at checkout before purchasing.

Its public table advertises player statistics for the six chosen top divisions and the three European competitions, and some second divisions. It explicitly lacks player-stat coverage for Germany ProA and Greece A2. Turkish second-tier naming must be resolved by competition IDs and membership; duplicate `TB2L` labels are not sufficient evidence of TBL coverage. A paid upgrade does not create data absent from the provider.

Simple account steps when that supplementary feed is needed: open the dashboard link, register/verify email, select Basketball, and find the key under Account > My Access. Keep the key in a local secret file through a dedicated setup step, never in this document, Git, the browser game bundle or chat. No account or payment is needed for the already downloaded EuroLeague/EuroCup dataset.

## Access and permitted use

Free technical access is not an unrestricted licence. [EuroLeague's terms](https://inform.euroleague.net/terms) address private non-commercial statistics use with attribution but also restrict fantasy/commercial products, certain comprehensive updated databases, actual-game depictions and imagery. Whether this management simulation falls within the permitted use has not been established. The records remain a local reference snapshot; they are not automatically bundled or published with the game.

[API-SPORTS terms](https://api-sports.io/terms) likewise distinguish API access from permission to publish supplied data in a product. Any purchasing decision must account for the intended use, rather than treating a paid access plan as an all-purpose content licence.
