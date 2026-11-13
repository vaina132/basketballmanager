# Real-data feasibility report (sprint 1)

Prepared 13 November 2026 for the owner, following phases 1-4 of [the owner's real-data plan](real-data-integration-plan.md) and the [league scope decision](decisions.md#first-release-league-scope-and-league-selection). Status: **complete, awaiting the owner's decision**. Nothing in the game was changed for this report. The API test used 20 of the free plan's 100 daily requests on 13 November 2026.

## Summary for the owner

**Yes, API-Sports can be our main source, with gaps we can handle.**

- **Coverage is complete for our scope.** All ten chosen domestic leagues and all three European competitions have clubs, squads, full schedules, results, tables and per-game player statistics from 2023-24 to the current 2026-27 season.
- **Identities line up.** The same club and the same player keep one ID across competitions (Alba Berlin and Bayern have the same ID in the BBL and the EuroLeague), which is what we need to avoid duplicates.
- **What is missing:** players have only name, shirt number, nationality, a rough position (Guard, Forward, Center) and age: no birth date, height or weight. Box scores have minutes, points, two-pointers, three-pointers, free throws, total rebounds and assists, but **no steals, blocks, turnovers or fouls**. Clubs have no city, arena or colours, and the arena field per game is sometimes wrong (in the BBL it often shows a referee's name).
- **Effect on player ratings:** five of the game's seven abilities can be calculated from real numbers (two-point, three-point and free-throw shooting, rebounding, stamina) and passing partly (assists without turnovers). Defence, height and weight must be estimated, clearly labelled, or taken from a second source. For EuroLeague and EuroCup players, the official EuroLeague data we already downloaded for free has birth dates, heights and full statistics.
- **The free plan is only for testing.** It opens seasons up to 2024-25, allows 10 requests a minute and 100 a day, and returns one game per request. The current season needs a paid plan, which also allows several games per request. Price: check on the API-Sports dashboard before buying; we buy nothing without your approval.

**My recommendation:** build the pilot (sprint 2) now **on the free plan, with the real 2024-25 season** of the BBL and the EuroLeague: about 650 game requests, spread over about a week of free daily requests, at no cost. It proves the whole chain (import, database, ratings, a career started from a versioned pack). Buy one month of the paid plan only when we are ready to load the current season.

## Part 1. The game today and what real data changes

**How it works now.** The game ships one built-in "data pack" (`development-league-1`): six made-up clubs with ten players each, written directly into the code (`src/data/`). Each player has a name, shirt number, position, height, weight, a drawn appearance and **seven abilities on a 1-20 scale**: two-point shooting, three-point shooting, free throws, passing, defence, rebounding and stamina. Separate built-in files add birth dates, wages, club finances, presidents, sponsors, coaches, scouts and rivalries. There is one league: six clubs, ten matchdays.

**How careers use it.** A new career copies the six clubs into the save. The save records the pack name, and the strict save check compares the save against that same built-in list to make sure nothing was tampered with. Careers already never change when the code's data changes; real data must keep that promise (the plan's "career independence").

**What can stay as it is:**

- The match engine, coaching, training, injuries, staff, scouting, transfers, contracts, finances, board, press, rivalries and career systems. They work with any club and player once these are supplied.
- The seven-ability model. Real statistics can be turned into these abilities (part 4); more abilities can come later if needed.
- Local saves and the save check, once they read the club and player list from the chosen data pack instead of the built-in one.

**What must change (in later sprints, not now):**

1. **Data packs become files, not code.** A pack (clubs, players, abilities, competitions, a version number) is loaded when a career starts. Each save remembers which pack version it started from and keeps working with it forever; new careers use the newest pack.
2. **Several leagues and competitions.** Today's single six-club league becomes up to ten domestic divisions and three European competitions with real formats (sprint 3), and the player chooses the leagues when starting a career.
3. **Speed and save size.** Today a six-club season makes saves of about 1-2 MB, and the save check replays every past decision. With about 170 clubs this approach would be far too slow and large. Leagues the player chose but does not manage will need a lighter record. League selection helps, but this is the biggest technical risk (sprint 3).
4. **Things real data does not provide.** Wages, club budgets, board personalities, sponsors and potential are not published. They will be clearly labelled game estimates, as the plan requires.
5. **Appearance.** Real players should get neutral generic portraits, not a guessed skin tone or hair colour. Photos and logos stay out until rights are cleared.

## Part 2. What API-Sports actually provides

Tested on 13 November 2026 with `scripts/api-sports-probe.mjs` (free plan). Raw answers stay on the owner's computer in `.local-data/api-sports/`. The documentation website refuses automated reading, so every statement below comes from real API answers, as the plan requires.

**Competitions and their API identifiers.** Coverage flags list "players" and "per-game player statistics" for 2023-24, 2024-25, 2025-26 and 2026-27 in every one of them:

| Competition | API id | Season label |
| --- | --- | --- |
| Turkey: Basketbol Süper Ligi ("Super Ligi") / Türkiye Basketbol Ligi ("TBL") | 104 / 102 | 2024-2025 |
| Spain: ACB / Primera FEB | 117 / 95 | 2024-2025 |
| Italy: Lega A / Serie A2 | 52 / 242 | 2024-2025 |
| France: LNB (Betclic Élite) / Pro B (Élite 2) | 2 / 8 | 2024-2025 |
| Greece: Basket League | 45 | 2024-2025 |
| Germany: BBL | 40 | 2024-2025 |
| EuroLeague / EuroCup / Basketball Champions League | 120 / 194 / 202 | 2024 (single year) |

Greece's A2 and Germany's Pro A have no player statistics, which matches the owner's scope decision to leave them out.

**Sample depth (2024-25 BBL and 2024 EuroLeague):**

| Data | Found |
| --- | --- |
| Clubs | 17 BBL, 18 EuroLeague; id, name, country, logo link (logo rights not included); no city, arena or colours |
| Squads | 19-20 players per club; fields id, name ("Surname Firstname"), shirt number, nationality, position (Guard/Forward/Center), age. Some fringe players have only initials and empty fields. No birth date, height or weight |
| Games | 304 BBL and 330 EuroLeague, all finished; date, round, quarter scores, teams, an arena field that is correct in the EuroLeague but often a referee name in the BBL |
| Player box scores | 21-23 rows per game; minutes, two-pointers ("field_goals" made/attempted), three-pointers, free throws, total rebounds, assists, points. No steals, blocks, turnovers, fouls or offensive/defensive split |
| Tables | Positions with the stage name |
| Second division check | Primera FEB: 306 games with equally complete box scores |

**Limits of the free plan:** seasons 2022-2024 only ("Free plans do not have access to this season, try from 2022 to 2024"), 10 requests a minute, 100 a day, and one game per player-statistics request ("Free plans do not have access to the Ids parameter"). No season-total player statistics were found, so season totals are built from game box scores.

**Request volume.** The thirteen competitions play roughly 3,500-4,000 games a season. One game per request means about 4,000 requests per season (two seasons: about 8,000); a paid plan's several-games-per-request option would cut this by the number of games per request (not yet measured). Monthly updates need a few hundred requests. Ordinary play needs none: the game reads our own published packs.

## Part 3. Database proposal (Supabase)

A provider-independent design: our own IDs for every club and player, with each provider's IDs mapped to them, so one club (for example a club playing both a domestic league and the EuroLeague) exists once.

| Table | Holds |
| --- | --- |
| `competitions`, `seasons` | Each competition (country, tier, domestic or European) and each season with its dates and format |
| `clubs`, `club_provider_ids` | One record per real club (name, short name, country, city, venue, colours with their source, empty logo reference); the provider IDs that point to it |
| `players`, `player_provider_ids` | One record per real player (name, birth date, nationality, height, weight, position, empty photo reference); the provider IDs that point to it |
| `participations` | Which club plays in which competition season |
| `roster_memberships` | Player, club, season, shirt number, from/to dates and source |
| `games`, `player_game_stats` | Results and player box scores (minutes, points, shooting by type, rebounds, assists, steals, blocks, turnovers, fouls) with their source |
| `player_season_stats` | Season totals per player and competition, calculated from the box scores or taken from the provider |
| `player_ratings` | The game's abilities per player and data version, how each was calculated, and whether it is calculated, estimated or manually adjusted |
| `manual_overrides` | Hand-maintained facts the API lacks (club colours, corrections), with a reason |
| `import_runs`, `data_quality_issues` | Each import: date, provider, requests used, result, and every problem found |
| `dataset_versions` | Each published game pack (for example 2026.11, 2026.12): status draft/published, checksum and file location |

**Publishing and career independence.** The game never reads the database during play. Each month the importer builds a new pack, checks it, and only then publishes it as a fixed file (for example in Supabase Storage, or bundled with a Steam build). A failed or weaker import never replaces the last good pack. A new career downloads the latest pack once; its save keeps that version permanently.

**Secrets.** The API key lives only on the importer side: today a local file, later a server-side secret. It never reaches the browser or a game download.

## Part 4. Player-rating proposal

The game's seven abilities (1-20) are calculated from box-score statistics per 40 minutes, in four steps:

1. **Combine seasons.** The previous full season (2025-26) and the current season so far (2026-27) are combined, weighted by minutes played.
2. **Account for small samples.** Shooting percentages are pulled towards the average for the player's position until there are enough attempts (for example about 100 three-point attempts before a percentage counts fully). Players with few minutes are rated mostly from their position and league and marked "estimated".
3. **Account for league strength.** Production is scaled by a competition factor (EuroLeague strongest, then the top domestic leagues, then EuroCup and the Champions League, then second divisions). The factors start as provisional numbers and are checked using players who appear in two competitions in the same season.
4. **Convert to 1-20** by comparing each player with all players at his position across the dataset.

| Game ability | Main statistics |
| --- | --- |
| Two-point shooting | Two-point percentage and two-point attempts per 40 minutes |
| Three-point shooting | Three-point percentage and attempts per 40 minutes |
| Free throws | Free-throw percentage (with few attempts, pulled towards average) |
| Passing | Assists per 40 minutes and assists per turnover |
| Defence | Steals and blocks per 40 minutes, fouls; marked "estimated" because box scores measure defence poorly |
| Rebounding | Offensive and defensive rebounds per 40 minutes, by position |
| Stamina | Minutes per game, games played and age |

**Age and potential** are not measurable from statistics; potential is estimated from age and current level and labelled as an estimate. **Sanity checks:** each league's rating distribution, a list of the top-rated players per league for a human check, abilities capped against extreme small-sample values, and a warning when a player's rating moves sharply between monthly versions.

## Risks and open questions

1. **Missing player facts and statistics** (birth dates, heights, weights; steals, blocks, turnovers, fouls). Plan: label estimates; use the official EuroLeague/EuroCup data for those players where its terms allow; consider a second provider later only if estimates prove inadequate. No scraping.
2. **Speed and save size with many leagues** (part 1, point 3): the largest engineering risk, handled in sprint 3 together with league selection.
3. **Cost:** the free plan suffices for the pilot on 2024-25; the current season needs a paid month. The price must be checked on the dashboard and approved by the owner first.
4. **Rights:** API access is not permission to publish the data in a paid game; API-Sports leaves publication rights to the developer, and real player and club identities may need separate licences. Required before any public release, not for private testing.
5. **Supabase:** the owner's project "BasketBallManager" is ready (free plan, Frankfurt, empty). The free plan's 500 MB database is ample for the pilot (two leagues, one season: well under 50 MB). Free projects pause after about a week without use and are resumed with one click.

## Proposed pilot (sprint 2), for approval

1. Create the database tables of part 3 in the owner's Supabase project.
2. An importer script that downloads the 2024-25 BBL and 2024 EuroLeague (clubs, squads, games, box scores) within the free limits, resuming each day where it stopped, and records every import and problem.
3. Club colours and city from a small hand-maintained list; estimates labelled.
4. The rating calculation of part 4, with a report of the top players per league for a human check.
5. A versioned game pack built from the database, and a new career that starts from it in the existing game (two real leagues; the multi-league calendar itself is sprint 3).
6. A repeat import that proves an update never changes an existing career.