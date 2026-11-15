# Player profile audit — 14 November 2026

## Findings and correction

The paid feed and our conversion both contributed to the reported position errors. API-Sports supplied Collin Malcolm as **Guard**, which our rating conversion turned into PG/SG without labelling the result as estimated. Kai Jones was supplied as **K. Jones** with no position; his statistics produced an estimated PF. Broad Guard/Forward roles are now explicitly estimated in both the ratings generator and pack builder, including when consuming older stored ratings.

The [official Efes roster](https://www.anadoluefessk.org/en/team-players) lists Malcolm as SF and Jones as PF/C. [EuroLeague's season profiles](https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/people?limit=1200&offset=0) identify Jones's primary role as Center. The reviewed evidence records use stable API-Sports and official person IDs; the new private revision assigns **Malcolm SF and Jones C**. This is a primary game position, not a claim that Jones never plays PF.

Refreshing an endpoint does not prove that its facts are current. Provider ages were stale in the inspected Efes responses, some names were abbreviated, and season roster endpoints retained players at multiple clubs. Different domestic/European endpoints also return different player sets. Never treat a union, a recent fetch timestamp, or the last-updated membership row as proof of current or opening-day eligibility.

## Scope and retained evidence

The read-only refresh completed **280/280 unique team/season endpoints**, covering all **13 competitions and 223 clubs** represented in the existing pack. This audits that pack's scope; it does not certify each competition's participant list. No source database rows, memberships or previously published files were rewritten.

The complete official EuroLeague and EuroCup profile snapshots were matched within 52 reviewed club identities. There were **630 profile matches**: 459 exact full names and 171 unique initial/surname matches within the same club. Ambiguous matches are rejected. Active registrations are checked against the observation date; incomplete pages, duplicate registrations and wrong seasons are rejected. Club-level precise evidence supplements the official broad groups for the two reported Efes cases.

New private revision: `.local-data/real-data/packs/real-2026.11-world-2.json`.

- 630 profiles changed: 198 primary positions, 630 ages, 566 heights, 592 weights, 370 shirt numbers, 370 nationalities and 171 expanded names. These counts overlap. Official birth dates replace age-derived dates; ages use the game's 5 September 2026 opening date.
- 2,811 of 3,087 precise positions remain estimates. An official **Forward** is still insufficient to establish SF versus PF. A matched identity does not mean every field is verified.
- 166 players appear at multiple clubs in the provider responses. 199 existing players at linked official clubs did not safely match an active official registration. 17 additional provider identities require identity/membership review. These are overlapping issue categories, not 382 proven erroneous players.
- No existing membership was absent from every corresponding provider endpoint. That does **not** establish that the membership is current.
- Club assignments, all seven ability values, club lists and competition lists remain unchanged pending reconciliation. This is a **profile correction revision, not a fully reconciled roster release or refreshed ability calibration**.

Private evidence (ignored by Git):

- `.local-data/real-data/observations-20261114-quality/snapshot.json`: complete raw observations, scope and stable provider identity links.
- `.artifacts/official-E2026-people.json` and `.artifacts/official-U2026-people.json`: official source documents, including the EuroCup second page.
- `.local-data/real-data/packs/real-2026.11-world-2.json.audit.json`: individual corrections and unresolved identities/memberships.
- `.artifacts/profile-quality-summary.json`: unchanged parent checksum, corrected checksum and field counts.

Parent pack SHA-256: `d52a424ff918e4b0788a4785b7b90e0835305856b10a5d05cee0c04362edd9a6`.
New pack SHA-256: `767b0b711d3a78338bf0fed567eaf91f0451f9829d046ed9d8aba6eaf59401a0`.

## Using and maintaining the revision

In the game: **New career → Club → Load another data pack**, select `real-2026.11-world-2.json`, then choose the club. The same file can be used for a new real-club friendly. Existing careers keep their embedded identities, profiles and results; a new file does not rewrite their history. Schema 45 and compact-2 are unchanged. The coach crash fix also applies to existing careers.

The game now shows a compact **Data** disclosure with the season, profile observation date and unresolved membership count. Squad/profile positions show `est.` when estimated or unverified; the player profile marks age-derived ages as estimates. Researched birth dates and position evidence survive strict save/load.

For maintainers, fresh provider snapshots use the existing local credentials internally. Choose a new output directory; never overwrite observations. Budget is a hard request cap, not a promise about account allowance:

```powershell
npm.cmd run data:roster-snapshot -- --pack .local-data/real-data/packs/real-2026.11-world-1.json --output .local-data/real-data/observations-NEW --budget 350
```

Official snapshots must retain `{ url, fetchedAt, status, body }` and optional `pages` with their full bodies, URLs and fetch dates. Use the official season-specific `people` endpoint for E and U, follow pagination until `body.total` rows are retained, and retain every page. Review `real-data/official-club-links.json` and precise position evidence for that season. The converter refuses incomplete/wrong-season evidence. Names alone never establish a cross-club transfer.

Create a new immutable revision from those retained inputs:

```powershell
npm.cmd run data:refresh-pack -- --base .local-data/real-data/packs/real-2026.11-world-1.json --snapshot .local-data/real-data/observations-NEW/snapshot.json --official PATH-TO-E.json,PATH-TO-U.json --version NEW-VERSION --out .local-data/real-data/packs/real-NEW-VERSION.json
```

The output uses the game's pack parser before writing, refuses existing filenames and retains its audit report. It does not publish a new database dataset version. If a failure leaves an audit sidecar, inspect that evidence and use a new output filename; do not mistake a sidecar for a successful pack. Review individual changes and unresolved records before distributing any revision. All paid/raw player data stays private.

## Next work

## Membership revision, 15 November 2026

The immutable **`real-2026.11-world-3.json`** revision correlates the retained 14 November provider observations with active official EuroLeague/EuroCup registrations. It confirms 630 retained assignments and corrects **27**. A move requires one official person and destination, a reviewed club mapping, and the same stable provider identity observed at that destination; conflicting known birth dates and ambiguous canonical identities prevent a move. Existing abilities remain unchanged.

The official active-registration fields contain 20 EuroLeague clubs and 32 EuroCup clubs. The extra provider-listed EuroCup club, Monaco, is removed from that competition. Its remaining three historical player records and club identity are retained. Inactive clubs may have fewer than five players; active competition entries still require a usable squad, and friendly selection offers only active clubs. No identities are discarded or invented to fill the gap.

There are **263 unresolved existing assignments** under the broader reconciliation checks and **169 official identities not safely correlated**. These are different issue sets from the earlier profile audit, not a claim that 263 newly incorrect assignments were discovered. Seventeen extra provider IDs remain unreviewed; precise positions and ability estimates retain the previous limitations. This is dated current-registration evidence, not certified opening-day membership or proof that all domestic-only records are current.

Pack checksum (`SHA-256(JSON.stringify(pack))`): `1528ef46e17ff0eee35fa4cb484ac949fee6f21672975a8084db080e88a4d1f2`. File SHA-256: `bd7070b37b1fabdcc68fd05e5c365ab254145e05213ee20846240525405e6233`. Previous pack checksums are unchanged. The individual audit is beside the new private pack with suffix `.audit.json`.

For a new career or friendly, load `.local-data/real-data/packs/real-2026.11-world-3.json`. The data disclosure shows corrected and unresolved memberships; existing careers retain their embedded data. A private serial check created all nine currently supported real leagues, retained their complete imported rosters, advanced a matchday and strictly roundtripped each save (`.artifacts/membership-private-report.json`). Schema 46 is unchanged.

Repeatable command, using a **new version/output path** each time (the command refuses overwrites):

```powershell
npm.cmd run data:reconcile-pack -- --base .local-data/real-data/packs/real-2026.11-world-2.json --observation-base .local-data/real-data/packs/real-2026.11-world-1.json --snapshot .local-data/real-data/observations-20261114-quality/snapshot.json --official .artifacts/official-E2026-people.json,.artifacts/official-U2026-people.json --version NEW-VERSION --out .local-data/real-data/packs/real-NEW-VERSION.json
```

This reconciliation makes no new paid provider requests or database writes. Raw observations and packs remain private. Continue source review for unresolved identities/memberships while integrating competition registration into the shared career calendar.

## Earlier roster prerequisite status

The subsequent roster increment now preserves full imported club membership and separates five-to-twelve-player matchday selection in new careers (schema 46). Existing saves keep their original embedded roster. Competition registration remains automatic from contracts in one domestic league. Continue the 3.1 follow-up / 3.3 prerequisite by reconciling flagged memberships and new identities using dated club/competition evidence, then implement competition-specific registration rules. This profile audit itself did not adjudicate memberships. Full opening-day roster certification, domestic-only profile verification, European participant reconciliation and sprint-4 ability calibration remain open. Do not hide these limitations by treating the new retrieval timestamp as a freshness guarantee.
