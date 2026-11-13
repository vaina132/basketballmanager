# Data, sources, and player appearance

Status: **Draft specification incorporating confirmed scope: men's top two divisions in Turkey, Spain, Greece, Germany, Italy and France, all fully playable in the first release; EuroLeague, EuroCup and Basketball Champions League also included. Start from the opening of the latest completed verifiable season. Exact dataset completeness remains unverified.**
Research date: **2026-11-05**, using the user's Europe/Berlin date.
This is a technical sourcing plan, not a determination of legal permission to redistribute a dataset.

## 1. Data principles

- Confirmed presentation: English interface for desktop, laptop and tablet; preserve original player names and accents.
- Confirmed data policy: verified identities and rosters, explicitly labelled missing-value estimates, usable real photos with illustrated fallbacks.
- The user is willing to pay for high-quality data when useful; free sources remain acceptable. No budget or purchase authorization has been given. See the [supplier shortlist, sample audit and ready-to-send enquiry](../data-acquisition.md).
- Confirmed visibility: exact current skills for the manager's own squad; scouting ranges for outsiders; potential and personality expressed through reports rather than exact hidden values.
- The ten first-release domestic divisions are fully playable (owner's decision of 13 November 2026, see [decisions](../decisions.md#first-release-league-scope-and-league-selection); Greece's Elite League and Germany's ProA are no longer included). Only third tiers and below, and domestic leagues outside the six countries, may use background simulation.
- Keep the game engine, factual reference data, estimated game ratings, and visual assets separate.
- A player can have a verified identity and statistics while their simulated abilities remain estimates.
- Preserve the source and effective date of every imported factual field.
- Freeze the starting database for each career; subsequent real-world transfers must not rewrite an existing save.
- Use explicit competition and season identifiers; never interpret a website's default page as a historical snapshot.
- Missing data stays unknown. Unknown weight, salary, or contract end date must not silently become zero.
- Publish coverage and uncertainty rather than promising a complete, exact European database before an audit.
- Build and test with a small fictional dataset while the chosen real dataset is prepared.
- Readable public pages are source candidates, not evidence of an unrestricted data or image licence.

## 2. Sources inspected

The following pages were inspected through web research on the date above. Accessibility describes this research session; it does not promise that an importer or the user's browser will behave identically.

| Source | Evidence found | Intended use | Limitation / follow-up |
| --- | --- | --- | --- |
| [ACB player statistics](https://acb.com/es/liga/estadisticas/estadisticas-de-jugador?editionId=89) | Readable official shooting, rebounding, assists, minutes and other category lists, with player links. | Spanish league reference statistics and initial source exploration. | Confirm the edition-to-season mapping, phase, totals versus averages, and all-team coverage before import. The example page is not a chosen season. |
| [ACB legal notice](https://acb.com/es/liga/aviso-legal) | Official notice linked from the statistics page; retrieval was inconsistent. | Source terms review. | Detailed reuse permission was not established in this research. |
| [Greek league player directory](https://www.esake.gr/en/action/EsakePlayers) | Readable names, positions, birth dates, nationalities and heights. | Identity and player-profile verification. | Some entries have no team despite the season header. Presence in the directory is not proof of membership in that season's roster. |
| [Greek league statistics](https://www.esake.gr/en/action/EsakeStats?mode=3) | Readable team totals including attempts, makes, rebounds, assists and turnovers. | Competition calibration and reconciliation. | Check the selected season and phase explicitly; team data alone does not establish player coverage. |
| [German BBL player statistics](https://www.easycredit-bbl.de/statistiken/spieler) | Readable shooting, minutes and box-score tables with season/phase controls and player-profile links. | German league statistics and profile cross-checking. | The retrieved default was the current season; a complete 2025-26 extraction was not verified. |
| [Italian LBA players](https://www.legabasket.it/protagonisti/giocatori) and [statistics](https://www.legabasket.it/statistiche/giocatori) | Official season/filter controls and height/weight/nationality columns; indexed results exposed sample player rows. | Italian league identity and statistics candidates. | Direct text extraction showed empty dynamic rows; historical filtering and complete extraction need validation. |
| [French LNB](https://www.lnb.fr/) | Official site identified; direct retrieval returned HTTP 403. | French competition data candidate. | No complete roster or statistics extraction verified in this session. |
| [EuroLeague players](https://www.euroleaguebasketball.net/en/euroleague/players/) and [statistics](https://www.euroleaguebasketball.net/en/euroleague/stats/) | Official source locations identified, but direct requests returned HTTP 403. | Candidate roster and performance sources. | Completeness and automated access were not verified. Do not bypass access controls or assume an undocumented API is available for reuse. |
| [EuroCup players](https://www.euroleaguebasketball.net/en/eurocup/players/) | Official source location identified; direct retrieval returned HTTP 403. | EuroCup roster candidate. | Audit separately from EuroLeague despite the shared website. |
| [Basketball Champions League statistics](https://www.championsleague.basketball/en/stats) | Search indexing exposed official player statistics and a games-played qualification filter; direct retrieval returned HTTP 403. | Continental statistics candidate. | Leaderboards may omit low-appearance players; current defaults are not historical snapshots. |
| [EuroLeague statistics criteria manual](https://ftpserver.euroleague.net/general/EB_Statistics_Criteria_Manual.pdf) | Readable official PDF, version 1.2, validated 2025-09-05; describes scorekeeping categories. | Define imported and simulated statistical events consistently. | Select the appropriate edition for the chosen season; this is not a roster database. |
| [TBF leagues](https://www.tbf.org.tr/ligler) and [documents](https://www.tbf.org.tr/dokuman) | Official locations found in search; attempted direct page retrieval returned HTTP 403. | Candidate Turkish competition, registration and rule sources. | A Turkish dataset requires an additional access and coverage audit before committing to an importer. |
| [FIBA resource hub](https://about.fiba.basketball/en/services/resource-hub/downloads) | Official rules/document entry point located; direct retrieval was blocked in this session. | Pin playing rules and relevant interpretations by season. | A rules source, not an automatic source of complete professional club rosters. Exact documents belong in the rules manifest. |
| [Real Madrid basketball squad](https://www.realmadrid.com/en-US/basketball/first-team/players) and [example player profile](https://www.realmadrid.com/en-US/basketball/first-team/players/facundo-campazzo) | Readable official team and player pages with profile links. | Cross-check the selected club's names, roles and appearance references. | Current squad pages can change and may omit historical registrations; do not treat them as opening-day archives. |
| [ELPA framework agreement page](https://elpa.basketball/efa/) | Readable agreement/standard-contract links and explanations of salary conventions, negotiations and image rights. | Research EuroLeague-specific contract mechanics. | This does not reveal actual individual salaries or authorize game use of player images. Domestic rules need separate sources. |

No roster, portrait collection, or complete statistics dataset has been downloaded as part of this draft. No source above has been certified complete for a selected season.

### Second-division source candidates

These are additional official source entry points, not completed dataset audits. Sponsorship names and competition formats must be pinned to the selected season.

| Country / second division | Official candidate | Verification status |
| --- | --- | --- |
| Turkey / TBL | [TBF leagues](https://www.tbf.org.tr/ligler) and its dated registration/competition documents. | Federation identified; historical TBL roster and statistics coverage not verified. |
| Spain / Primera FEB | [FEB](https://www.feb.es/inicio.aspx) and [2025-26 competition document](https://www.feb.es/Documentos/Enlaces/%5B6537%5DBBCC%20PRIMERA%20FEB%2025-26%20-%20Versi%C3%B3n%20Web.pdf). | Federation homepage opened; the indexed official document describes participation/format. Full historical rosters and document amendments not audited. Primera FEB is the requested second-tier candidate; do not substitute Segunda FEB. |
| Greece / Elite League | [Hellenic Basketball Federation](https://www.basket.gr/). | Federation homepage opened; specific historical Elite League roster/statistics export not inspected. |
| Germany / ProA | [2. Basketball Bundesliga](https://www.2basketballbundesliga.de/). | Readable current ProA fixtures and table; historical full-season roster coverage not audited. |
| Italy / Serie A2 | [LNP 2025-26 format](https://www.legapallacanestro.com/formula-serie-a2-2025-26) and [LNP roster-site announcement](https://www.legapallacanestro.com/online-la-versione-20252026-del-sito-ufficiale-lnp-i-roster-gli-staff-info-su-tutte-le-squadre-di-a2). | Format page opened; indexed official announcement describes 2025-26 roster/profile publication. Opening-day archive completeness not established. |
| France / Elite 2 | [LNB 2025-26 competition-format document](https://cdn.lnb.fr/uploads/content-library/fa231dfa97e2c6285c1b8d361852d16f872c381d6534d8a029ab89eefd2c1a06.pdf) and [LNB season announcement](https://cdn.lnb.fr/uploads/content-library/2c0c17ad43636aaa7e43f6a59928d13e05601dff00c5b507c37e2592fb23ad13.pdf). | Official indexed documents establish the season name and format; full roster/box-score import not audited. |

Second-tier data has the same identity, provenance, gameplay and acceptance requirements as first-tier data. Wider estimated-rating uncertainty is acceptable when evidence is sparse; omitting playable clubs or turning them into background clubs is not an acceptable substitute for this confirmed scope.

## 3. Practical reuse constraints

The inspected [EuroLeague terms](https://inform.euroleague.net/terms), dated 2025-05-16, permit certain private non-commercial statistical uses with attribution but also specify restrictions involving fantasy games, comprehensive updated databases, and depictions of actual-game play-by-play. Their content provisions separately restrict reproduction of material. The game's particular intended use therefore needs to be checked against those terms; private use alone does not settle the question.

Record statistics, photography, club marks, and player likeness permissions separately. A statistics permission does not establish permission to distribute a photographer's image, and a photograph's licence does not automatically settle every likeness or branding use.

Recommended implementation boundary:

- The public code repository contains engine code, schema, fictional fixtures and appropriately licensed assets.
- Real-data packs have their own manifest, attribution and documented permitted uses.
- A local import feature supports compatible user-provided packs without uploading them automatically.
- A private deployment and a local browser save are different distribution/storage arrangements; document which is in use.
- Build checks exclude assets or packs marked `unknown`, `private-only` or `prohibited` from public-distribution bundles.
- Permission uncertainty changes which data ships, not whether engine development can continue.

These are proposed release controls. They do not make an unpermitted acquisition or reuse permissible.

## 4. Starting-season contract

The working candidate is 2025-26, based on the requested latest completed season and the client date. This is not a claim that a complete opening-day pack exists. Each selected competition must pass the archive and roster audit before the final season is locked.

Each dataset should define:

| Field | Meaning |
| --- | --- |
| `datasetId`, `version`, `schemaVersion` | Stable pack identity and migration boundary. |
| `competitionIds`, `seasonId` | Included competitions and their exact season. |
| `competitionEntries`, `effectiveDates` | Season-specific participating clubs, tier, admission status and dated changes. |
| `careerStartDate` | First date of the simulated timeline. |
| `rosterEffectiveDate` | Date at which club membership and contracts are represented. |
| `knowledgeCutoffDate` | Latest information allowed to influence starting ratings. |
| `retrievedAt` | When the source was actually accessed. |
| `rulesetVersion`, `statsConventionVersion` | Playing rules and scorekeeping definitions used. |
| `sourceManifestHash`, `contentHash` | Reproducibility and save compatibility. |
| `coverageReport`, `rightsManifest` | Missing fields and documented distribution limits. |

An opening-day historical career should normally use information available before opening day. Using full-season results to rate players at that season's start introduces hindsight; if the user prefers retrospective ratings, label that choice explicitly. End-of-season rosters cannot silently serve as opening-day rosters.

For several leagues, select one world start date at or before the earliest included official fixture. Reconstruct each club's registrations, injuries known publicly at that date, arrivals and departures as of that shared date. Later historical transfers are evidence for validation, not events that must happen in the simulated future.

The same real club or player appearing in domestic and continental sources must resolve to one world identity. Store statistics per competition and phase, then aggregate explicitly. Never duplicate a salary obligation, roster slot or player's workload because two source competitions list the same person.

Initial league membership comes from that season's admitted-club list, including the previous season's promoted and relegated clubs. A club's current division cannot establish its historical division. Keep identity across name/sponsor changes, promotions and relegations; record mergers or new legal entities as explicit cases instead of name-based guesses.

European entries need season-specific admission and qualification records, including entrants from outside the six playable domestic systems. Those opponents still need complete European match rosters, eligibility and shared workload records even when their domestic competitions run in the background. Never derive historical European entry solely from a club's domestic finishing position or today's licence status.

At future season rollover, derive promotion, relegation and European qualification from the simulated results and the chosen competition rules, then update membership on the new season's effective date. Admissions, vacancies, eligibility constraints and cross-tier playoffs require explicit competition rules. Promoted clubs entering from background third tiers must receive coherent full records before becoming playable.

Rules pages can change within a season: the inspected [Italian A2 2025-26 format](https://www.legapallacanestro.com/formula-serie-a2-2025-26) reports a later playout amendment, while the [French LNB format](https://cdn.lnb.fr/uploads/content-library/fa231dfa97e2c6285c1b8d361852d16f872c381d6534d8a029ab89eefd2c1a06.pdf) includes a top-tier club in accession playoffs. Preserve effective-dated rules; a season-labelled URL alone does not establish what was known on opening day. Decide whether to freeze opening-day regulations or schedule verified later regulatory amendments independently of simulated results.

## 5. Import pipeline

1. **Scope:** choose competition, season, opening date and required fields; list every club expected in the pack.
2. **Access review:** inspect source terms and supported access/export routes before designing automated retrieval.
3. **Capture:** retain permitted source records or references with retrieval timestamps, hashes and query parameters.
4. **Parse:** each source adapter produces staging records; parsers do not mutate a career save.
5. **Normalize:** standardize units, names, identifiers, dates, season labels and statistical categories.
6. **Resolve identity:** connect cross-source IDs to immutable internal player/club IDs; queue ambiguous matches for review.
7. **Reconcile:** compare registrations, club announcements and statistics; record conflicts rather than choosing the last response blindly.
8. **Estimate:** derive game ratings in a separately versioned transformation with uncertainty and sample-size fields.
9. **Validate:** run schema, roster, schedule, accounting and statistical checks; produce a human-readable coverage report.
10. **Package:** create an immutable, versioned pack with provenance and rights manifests; verify imports in a new test career.

Retrieval adapters should support caching, bounded requests, clear failure reports and reruns without duplicate records. Source errors stop the affected import instead of replacing valid records with empty data. Avoid runtime scraping from the game's browser client.

## 6. Identity, units and field provenance

- Internal IDs never depend on a display name, jersey number or current club.
- Preserve original names and Unicode accents; maintain normalized search aliases separately.
- Record multiple nationalities where verified. Competition eligibility is a separate season-specific record.
- Store height in centimetres and mass in kilograms, while retaining raw values and conversion provenance.
- Store birth dates as dates; calculate age at the current in-game date.
- Represent team membership with start/end dates and registration status, permitting multiple historical stints.
- Use money in integer minor units with explicit currency. Keep net salary, gross salary and total employer cost distinct.
- Store contracts and options as dated records; a news report saying “multi-year” does not establish an exact end date.
- Each factual field carries `sourceId`, `sourceUrl`, `retrievedAt`, `effectiveAt`, `evidenceType` and an optional conflict note.
- `evidenceType` distinguishes verified fact, reported but unconfirmed value, inferred estimate, and fictional simulation value.

Source precedence is field-specific: competition registration records inform eligibility; official game records inform match statistics; a club announcement can establish an announced signing but not an undisclosed salary. Conflicts remain auditable even after selecting a preferred value.

Keep an observed field nullable and store its simulation estimate separately with method/version and confidence. The accepted estimate policy fills playable needs without relabelling an unknown as a verified historical fact. It does not authorize invented real identities or unsupported roster membership.

## 7. What real statistics can and cannot establish

| Game field | Proposed treatment |
| --- | --- |
| Names, birth date, height, registered team | Verified facts when an appropriate source exists; retain conflicts. |
| Shooting, assists, rebounds, minutes | Import observed totals and sample size; preserve competition/phase context. |
| 1-20 shooting/passing ratings | Estimates informed by evidence and role; never present as official measurements. |
| Speed, strength, jumping, defence | Use only measured evidence where available; otherwise mark estimates with wider uncertainty. |
| Ambition, loyalty, adaptability, leadership | Fictional gameplay traits or carefully defined estimates, not claims about a real person's private character. |
| Current morale, chemistry and future injuries | Simulation state; not claims about real dressing rooms or medical conditions. |
| Salary, budgets, buyouts | Verified only with sufficiently specific public evidence; otherwise explicitly modelled assumptions. |

For a shooting sample, a simple proposed estimate is `p = (makes + priorStrength * priorMean) / (attempts + priorStrength)`. Fit priors by competition/role, retain the sample size, and calibrate the conversion into 1-20 ratings against the simulation. This is an initial modelling proposal, not an established validated rating formula.

Separate shot difficulty, usage and competition strength from raw accuracy where evidence permits. A low-volume player with a high shooting percentage must not automatically outrank a high-volume creator. Box-score totals alone do not reliably isolate individual defensive quality.

The [EuroLeague statistics manual](https://ftpserver.euroleague.net/general/EB_Statistics_Criteria_Manual.pdf) includes competition-specific scoring conventions, including assists associated with certain made free throws. Statistical validation must therefore use the selected convention rather than universal assumptions such as “assists can never exceed made field goals.”

Data-estimation confidence and in-game scouting knowledge are separate concepts. The manager sees the exact simulated current skill value for their own players even when its historical initialization was estimated. Outsider reports expose ranges narrowed by scouting; potential and personality remain qualitative/probabilistic reports. Store each report's observer, date, evidence and uncertainty without overwriting the player's underlying simulation state. The local-save architecture provides gameplay concealment, not protection against a user inspecting their own save files.

## 8. Portraits and matching court avatars

Use one stable `appearanceId` per player, referenced by both profile presentation and court rendering. Appearance can change with age or an explicit cosmetic update without changing the player's identity.

Proposed appearance record: height/body proportions, skin-tone palette, hairstyle/colour, facial hair, permitted accessories, jersey name/number and an optional face-detail preset. Appearance affects rendering only; it must never infer ability, personality or behaviour.

For real players, use appropriate permitted reference material and manually review recognizable appearance traits. At the diagonal camera's playing scale, silhouette, stature, hair, facial hair and jersey details carry recognition; photorealistic face matching is a separate art scope and is not promised by a stylized viewer.

For generated youth, create one persistent appearance seed. Both their portrait and their court avatar derive from the same definition, so a new season or save reload cannot generate a different face.

| Asset manifest field | Purpose |
| --- | --- |
| `assetId`, `playerId`, `appearanceVersion` | Stable references and controlled changes. |
| `sourceUrl`, `creator`, `rightsHolder` | Traceability. |
| `licenceId`, `licenceUrl`, `permissionEvidence` | Documented basis for intended use. |
| `permittedUses`, `distributionStatus`, `expiresAt` | Private/public use limits and expiry, if applicable. |
| `attribution`, `modifications` | Required credits and crop/edit history. |
| `checksum`, `dimensions`, `format` | Integrity and rendering validation. |

The user has accepted real photos where usable and illustrated fallbacks otherwise. Missing or unavailable portraits use a consistent generated/stylized fallback linked to the same appearance definition. Do not hotlink official photos as a substitute for managing assets or permissions. Real photos and AI-generated lookalikes require distinct provenance; generating an image does not establish rights to all underlying branding or likeness uses. Portraits and avatar assets need responsive sizes for desktop/laptop/tablet without duplicating the appearance identity.

## 9. Dataset acceptance checks

- All clubs in the selected playable domestic divisions have valid competition entries and enough eligible players for the supported match rules; the three European competitions also contain every admitted entrant.
- Every imported player has one internal identity; duplicates and conflicting memberships are resolved or reported.
- Opening-day roster membership is reconciled separately from all-season player appearances.
- Shooting makes do not exceed attempts; team totals reconcile with official records under the selected statistics convention.
- Source records specify totals versus averages, regulation/overtime inclusion, and regular-season/playoff phase.
- Height, weight, dates and currencies pass plausible-range checks without converting unknowns into facts.
- Missing financial information is visible in the dataset report; estimated budgets remain economically coherent.
- Every shipped asset has a valid manifest entry and the bundle's intended distribution status.
- Dataset upgrades cannot silently change an existing career, replay, or saved player's identity.
- Import/export round trips preserve provenance, appearance identity and the original pack version.
- Promotion/relegation rollover preserves club/player identities, applies effective membership dates, and creates playable records for entrants from background tiers before generating their new fixtures.
- Own-squad exact current values and outsider scouting ranges remain consistent across profile, search, comparison and export displays; hidden potential/personality do not leak through ordinary UI selectors.

## 10. Decisions still needed

1. Can the candidate 2025-26 opening-day dataset pass coverage checks for the ten domestic divisions and three European competitions?
2. Historical opening-day knowledge or retrospective season-informed ratings?
3. Freeze opening-day competition regulations or schedule verified later regulatory amendments?
4. Which estimate methods and uncertainty labels best fit the accepted missing-contract/budget policy?
5. Is the eventual distributed game intended to include bundled real data, or to support separately maintained/imported packs?

Recommended next research step: audit clubs from both tiers in each confirmed country, including at least one promoted club, and continental entrants outside those countries. Record exact field coverage and allowed use, then expand using the same reproducible pipeline. This staging is an implementation sequence; it does not reduce the agreed first-release coverage.
