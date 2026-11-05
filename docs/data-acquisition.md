# Acquiring the real basketball database

Prepared: **5 November 2026**. Update: **official EuroLeague/EuroCup data has now been downloaded free without an account. No supplier enquiry, account creation or purchase was made.** See [real data available now](real-data.md) for the actual dataset and its limits.

The user is willing to pay for reliable, high-quality real player and club data when useful; free sources remain acceptable. This is a preference, not a stated budget or authorization to buy a subscription.

## Recommended next step

Use the already downloaded [EuroLeague/EuroCup snapshot](real-data.md) immediately for local inspection and data-model work. Supplier enquiries are optional routes for filling coverage/licensing gaps; they are no longer a prerequisite for obtaining any real data. Evaluate a licensed historical snapshot before paying: this game needs accurate starting rosters and evidence for ratings, while its future results come from its own simulation.

Start with a Sportradar historical-data enquiry and a Genius Sports availability enquiry. Evaluate API-SPORTS through its free access as a possible technical/data supplement, subject to its separate rights limitations. FIBA GDAP is a specialist route for authorized FIBA competition access, not a presumed all-Europe retail database.

Use the existing [official-source research](design/data-and-sources.md) to cross-check samples and fill documented gaps. A combination of sources is acceptable if identifiers, coverage and allowed uses can be reconciled. No single supplier has yet demonstrated coverage of the whole requested game.

## Exact coverage to request

All competitions below are men's competitions. Both domestic tiers remain fully playable first-release requirements.

| Country / area | Required competitions |
| --- | --- |
| Turkey | Basketbol Super Ligi (BSL) and Turkiye Basketbol Ligi (TBL). |
| Spain | Liga ACB and Primera FEB. |
| Greece | Greek Basketball League and Elite League. |
| Germany | Basketball Bundesliga and ProA. |
| Italy | Serie A and Serie A2. |
| France | Betclic Elite and Elite 2; map historical Pro B naming where applicable. |
| Europe | EuroLeague, EuroCup and Basketball Champions League, including entrants outside the six domestic countries. |

Ask the supplier to identify every competition by its own stable ID, confirm the exact 2025-26 edition, and describe each phase separately. Marketing statements such as “European basketball covered” are insufficient.

**Working start:** the opening of 2025-26, subject to the historical audit. Request opening-day rosters and dated membership changes, not just today's roster or every player who appeared at any time during that season. Pin one world start date at or before the earliest included fixture after calendars are verified.

Request 2024-25 and earlier available player performance history for starting ratings. Keep 2025-26 results available for validation and calibration, but avoid silently feeding future season results into opening-day scouting or ratings. Retrospective ratings would be an explicit alternative design choice.

## Shortlist and verified evidence

### Sportradar Global Basketball

The [official overview](https://developer.sportradar.com/basketball/reference/global-basketball-overview) documents player/team profiles, season players, game rosters, season lineups and game statistics. It describes more than 200 competitions, but fields depend on coverage. It also limits the documented season-list responses to at most three seasons, including current/newly created seasons; request exact historical availability rather than assuming a permanent archive.

The [coverage matrix](https://coverage-matrix.sportradar.com/) is the official starting point; it did not establish all fifteen required competition/season packages in this research. The [statistics summary](https://developer.sportradar.com/basketball/reference/global-basketball-statistics-summary) describes available field families, not guaranteed completeness for each league.

**Next action:** use [Sportradar contact](https://sportradar.com/contact/) to request a non-betting management-simulation quote, historical export or trial, and a filled competition-by-field coverage sheet. Ask specifically whether opening-day registration histories exist and whether retained local game packs are permitted after access ends.

**Cost status:** no verified price for this scope; obtain a written quote. No claim that a standard package includes the required redistribution or image rights.

### Genius Sports

The [Developer Centre](https://developer.geniussports.com/) documents a warehouse API for historical and future match/player/statistics records. Its [basketball reference](https://developer.geniussports.com/warehouse/rest/index_basketball.html) includes competition competitors, match-player records and statistics structures. Having an endpoint does not prove access to every league's data or historical records.

**Next action:** contact [Genius Sports sales](https://www.geniussports.com/contact/) with the enquiry below. Ask whether it can supply the specified historical club-game dataset directly, or which leagues must authorize access individually. Request permitted simulation use explicitly; a betting-data arrangement is not automatically suitable.

**Cost status:** no verified price for this scope; obtain a written quote. Exact first- and second-division coverage remains unverified.

### API-SPORTS / API-BASKETBALL

The [official basketball product page](https://api-sports.io/sports/basketball) publishes a competition/feature coverage table and advertises a free plan with 100 requests per day. Paid plans offer broader request allowances and endpoint access. The [official API specification](https://api-sports.io/documentation/basketball/basketball-v1.yaml) describes player and player-game statistics endpoints and season coverage information; actual samples are still required.

**Important distinction for this purchase:** its [terms](https://api-sports.io/terms) state that API access does not grant a licence to use and publish the supplied data in the user's products; permissions may need to come from the relevant rights holders. Paying for request capacity therefore does not by itself provide a licensed game database. The same terms describe data errors/missing coverage and distinguish payment routes.

**Next action:** use the free evaluation to inspect the exact league IDs, season coverage flags, player identities and match-statistics payloads. Ask support about historical rosters, retained exports and the intended game use before considering any payment. Explicitly verify every second tier.

**Cost status:** public paid plans exist, but no plan is selected or priced here. Recheck currency, billing period, taxes, request limits and applicable terms when a candidate passes the data audit.

### FIBA GDAP — specialist access route

The [official documentation](https://gdap-portal.fiba.basketball/documentation) describes competition information and accumulated player/team statistics, with authenticated, product-specific subscriptions. It also points to a support route for sample live-stat files. Its [terms](https://gdap-portal.fiba.basketball/terms-of-services) tie access/use to an existing FIBA business contract or express authorization and identify eligible organizations.

**Next action:** ask FIBA whether this project is eligible and which required competitions it could supply. Do not assume that FIBA affiliation, or a league using FIBA LiveStats, means its entire historical database is available through GDAP to this game.

**Cost status:** access eligibility, scope and any charge require an answer from FIBA. Treat this as potential gap coverage rather than a verified replacement for all fifteen competitions.

## Required data and explicit unknowns

| Data group | Request and inspect |
| --- | --- |
| Identity | Stable player/club IDs; merge/alias mappings; names, birth date, nationality, position, height in cm and weight in kg; unknown values clearly distinguished. |
| Historical membership | Season-admitted clubs, opening-day rosters, dates of player arrivals/departures/registrations, and promoted/relegated clubs. Separate current roster from historical membership. |
| Performance | Individual box scores for all covered games and players, including low-minute players; minutes, shooting makes/attempts, rebounds, assists, steals, blocks, turnovers and fouls. Explain missing/DNP records. |
| Competition structure | Fixtures, dates, phases, final/validated results, standings, playoff/qualification structure and amendments. Game rules still require official regulations. |
| Cross-competition identity | One player/club can appear domestically and in Europe without duplicate identities or double-counted statistics. Include outside-country continental opponents. |
| Provenance and maintenance | Original source, corrections policy, historical revision timestamp, update frequency, archive retention and export format. |
| Optional assets | Headshots and club marks with explicit game/redistribution rights, credits and expiry. A URL in a payload is not sufficient. |

Do not assume a feed supplies salaries, complete contracts, buyouts, club budgets, personality, morale, potential, athletic measurements or game-ready 1-20 ratings. These require separate evidence or the already accepted labelled estimation/simulation model. Portrait fallbacks are accepted and need not block a useful statistics purchase.

## Sample audit before purchase

The audit compares the same selected records across available vendors and official sources. Store evidence in a scorecard with columns for provider, competition ID, season, source record, checked value, discrepancy, missing field and permitted use.

1. Select two clubs from each domestic division: 24 club selections, including at least one promoted club per country. Add representative European opponents outside the six countries.
2. For each selected club, inspect five player profiles covering a starter, reserve, young player, arrival and departure where available. Resolve duplicate IDs and historical team membership.
3. Inspect early-, middle- and late-season games, with playoff/qualification examples where applicable. Compare player scoring, attempts and minutes against official box scores; include low-minute players.
4. Obtain a full-season game/club/player manifest for each of the fifteen competitions, even if detailed sample records are limited. Compute coverage denominators; “we have this league” does not establish every game's player statistics.
5. Check a domestic/European duplicate player, a midseason transfer and a promoted club. Confirm dated identity and roster behavior rather than inferring it from current profiles.
6. Test importing the sample into staging, with unknown fields, corrections, schema changes and differing statistical conventions. No sample directly overwrites a career save.

| Gate | Pass | Fail / required follow-up |
| --- | --- | --- |
| Scope | Every required competition/season is identified, with measured field coverage; documented gap sources complete the intended package. | Missing second tiers, unidentified phases, or no denominator for completeness. A provider may still be useful as a clearly scoped supplement. |
| Opening-day roster | Sample membership is consistent with dated evidence and includes registered players who did not appear in the first match. | Only current rosters or undated all-season appearance lists. Require another source before adopting it as the roster source. |
| Match data | Sample scores, player points and makes/attempts reconcile; minute rounding and team statistics are explained. Full-season player-record completeness is measurable. | Unexplained mismatches, leaderboard-only data, or missing player statistics presented as full coverage. |
| Identity | Cross-league/season records map coherently; known transfers and merged IDs remain traceable. | Names used as the only key or unresolved duplicate people. |
| Use and retention | Written terms cover the intended private simulation, derived ratings, permitted local retention/export, and clearly state any later public-release restrictions. | An access subscription is offered without an answer about these uses. |
| Assets | Each included asset has adequate documented permission; otherwise the agreed illustrated fallback is used. | Assuming photo or logo rights from a data subscription alone. |
| Cost | Quote specifies scope, one-time versus recurring charges, quotas, retention, support and any separate future publication cost. | Paying before the above questions are answered. |

No invented numerical quality score should compensate for a failed essential gate. A successful sample qualifies a provider for a scoped recommendation; full import validation is still required.

## When the user can help

**Now:** use the enquiry below to request coverage and samples, or wait for the next data-audit checkpoint. This can proceed while engine development continues. There is no need to purchase anything now, and no budget assumption has been made.

**When a response/trial is available:** provide the coverage sheet, sample files and relevant offered terms. If access requires an API key, the implementation step will provide an exact local secret-configuration instruction; keep keys out of Git, exported saves and browser bundles.

**After the comparison:** review a concrete recommendation containing measured coverage, missing fields, intended licence scope and the actual quote. The user can then decide whether the improvement justifies the price or whether free/combined sources are preferable.

**Before any public release:** revisit the actual distribution terms and asset permissions against the intended release. This is separate from whether a development sample or private snapshot was usable.

## Ready-to-send supplier enquiry

This is a draft for the user to send. It has **not** been sent.

**Subject:** Historical European basketball data for a single-player management simulation

Hello,

I am developing a browser-based basketball management simulation, initially for private, non-commercial single-player use, with a possible public release later. I am interested in a reliable historical dataset or API export, and am willing to consider a paid product if its coverage and permitted use fit the project.

Please confirm coverage for the men's top two divisions in Turkey (BSL/TBL), Spain (ACB/Primera FEB), Greece (Greek Basketball League/Elite League), Germany (BBL/ProA), Italy (Serie A/Serie A2), and France (Betclic Elite/Elite 2), plus EuroLeague, EuroCup and Basketball Champions League. Please include European competition entrants from countries outside that domestic list.

The working target is a 2025-26 opening-day world, subject to verifying the historical data. I need stable club/player IDs, biographies, season membership, opening-day rosters, dated transfers or registration changes, fixtures, and individual player box scores throughout the season. I also need 2024-25 and earlier available performance history for ratings that do not rely on knowledge of later results. Please specify which fields and seasons are actually available for each competition, including reserves and low-minute players.

Could you provide a competition-by-field coverage sheet and a small historical sample or trial? I would like examples from both tiers, a promoted club, a player who changed clubs, and a player appearing in domestic and European competition. Please distinguish historical registration data from current rosters and from lists of everyone who appeared during a season.

Please quote any suitable one-time historical export separately from a recurring API subscription. Please explain quotas, archive limits, correction access, and whether the downloaded snapshot may be retained after the subscription ends.

Please also confirm permitted use for deriving simulation ratings, storing data in local browser saves, importing/exporting saves, and potentially distributing a data pack with a future public game. The game simulates new fictional match outcomes; it is not a betting product or a replay service for actual games. Please identify any separate rights or permissions required for this use, and quote headshots/club marks separately if available. Illustrated fallbacks are acceptable if images are not licensed for the proposed use.

If you cannot cover all requested competitions, a precise partial-coverage offer would still be useful. I would appreciate the actual sample and licence scope before committing to a purchase.

Thank you.
