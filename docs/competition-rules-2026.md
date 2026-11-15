# Competition rules research, 2026–27

Checked 15 November 2026. This is a source register for Sprint 3, **not a claim that every format below is playable**. Domestic regular-season calendars are integrated. New French careers also use the sourced LNB sporting ranking described below, new Spanish, German and Italian careers use those leagues' verified rules (step 3.4e-2), and every other league uses the labelled FIBA Appendix D default (step 3.4e-1). Postseason, European stages and competition-specific registration are still unintegrated. Raw captures remain private under `.artifacts/sprint3-source-*.json` and `.artifacts/postseason-rules-*.md`.

## Confirmed formats

| Competition | Confirmed structure | Source |
| --- | --- | --- |
| EuroLeague | 20 clubs; 38 regular rounds; top six advance; 7–10 play-in; quarter-finals best of five; single-game Final Four | [Official format](https://www.euroleaguebasketball.net/en/euroleague/format-el/) |
| EuroCup | 32 clubs; four groups of eight; 14 regular rounds; 16 advance; eighth-finals through final best of three | [Official format](https://www.euroleaguebasketball.net/en/eurocup/format-ec/) |
| BCL | 54 entries including qualification; two qualifiers join 30 direct entries; eight groups of four; winners advance, second/third play best-of-three play-ins; four Round-of-16 groups; best-of-three quarter-finals; Final Four | [Official competition system](https://www.championsleague.basketball/en/competition-system) |
| Turkey BSL | 16 clubs; double round robin; top-eight playoffs; quarter-finals best of three, semi-finals and final best of five; bottom two relegated | [TBF 2026–27 statute](https://www.tbf.org.tr/sitefiny-tbf-media/dokuman/C501A8C88D554440871463FE238691A3_basketbol-super-ligi-bsl-2026-2027-sezonu-statusu-ve-lig-siralamasi.pdf) |
| Germany BBL | 18 clubs; 34 rounds; 7–10 play-in for seeds 7/8; all playoff series best of five; bottom two relegated | [BBL 2026–27 competition regulations](https://cms.easycredit-bbl.de/wp-content/uploads/2026/07/easyCredit-BBL-Ausschreibung-DM-2026_2027.pdf) |
| France Élite | 16 clubs; 7–10 play-in; quarter-finals best of three, semi-finals/final best of five; 16th relegated; 15th enters the second division's promotion playoffs | [LNB competition regulations, articles 151–154](https://cdn.lnb.fr/uploads/content-library/39111ddae9f1edf9b1c739b6c69d3203ba0936c6d444634fa341d83db9fcc283.pdf) |
| France Élite 2 | First place is champion and promoted. Promotion bracket: regular places 2–5, Élite's 15th, regular 6th, then two play-in qualifiers. Quarter-finals/semi-finals/final best of three. Bottom two relegated | [LNB articles 158–161](https://cdn.lnb.fr/uploads/content-library/39111ddae9f1edf9b1c739b6c69d3203ba0936c6d444634fa341d83db9fcc283.pdf) |
| Spain Primera FEB | 18 clubs/34 rounds; first promoted; places 2–9 play best-of-five quarter-finals; four winners play single-game semi-finals/final at one venue; winner promoted; bottom three relegated | [FEB 2026–27 regulations, sections 3.2–3.3](https://www.feb.es/Documentos/Enlaces/[6537]BBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf) |
| Italy Serie A2 | 20 clubs/38 rounds; first promoted; places 2–7 plus two qualifiers from an 8–13 play-in enter best-of-five playoffs; playoff winner promoted. 20th relegated; 16–19 play best-of-five play-outs, then losing clubs meet for the other relegation place | [LNP 2026–27 formula](https://www.legapallacanestro.com/formula-serie-a2-202627) |

Added 15 November 2026 (step 3.4b, Claude; the league's latest published format, with no 2026-27 change found):

| Competition | Structure used | Source |
| --- | --- | --- |
| Spain ACB | 18 clubs; top-eight playoffs; quarter-finals best of three (1-1-1), semi-finals and final best of five; playoffs 25 May-29 June 2027. Bottom two relegated, matching Primera FEB's two promotion places | [Flashscore, 2026-27 season guide](https://www.flashscore.com.mx/noticias/baloncesto-acb-todo-lo-que-necesitas-saber-de-la-temporada-26-27-fechas-calendario-liga-copa-supercopa/p2LfB19t/), [El Español, playoff bracket](https://www.elespanol.com/deportes/baloncesto/20260531/queda-cuadro-liga-endesa-calendario-playoffs-cruces-rivales-real-madrid-barca/1003744267718_0.html) |
| Italy LBA | 16 clubs; top-eight playoffs; quarter-finals and semi-finals best of five, final best of seven. Bottom two relegated, matching Serie A2's two promotion places | [2025-26 LBA season](https://en.wikipedia.org/wiki/2025%E2%80%9326_LBA_season) |
| Greece GBL | 14 clubs in 2026-27; top-eight playoffs; quarter-finals and semi-finals best of three, final best of five; no play-in or play-out; last place relegated | [2025-26 Greek Basket League](https://en.wikipedia.org/wiki/2025%E2%80%9326_Greek_Basket_League), [league assembly report](https://www.parapolitika.gr/sports/article/1590544/basket-league-psifistikan-oi-62-xenoi-upovivazetai-mia-omada-stin-elite-league/) |
| Turkey TBL | **Labelled default; no 2026-27 statute found.** First place and the winner of a places 2-9 playoff (best of three, then best of five) promoted, matching the BSL's two relegation places; bottom two relegated | (searched TBF and press, 15 November 2026) |

Assumptions where a pairing is not published: Primera FEB's final-stage semi-finals (1-8/4-5 and 2-7/3-6 of its eight playoff seeds) and Serie A2's quarter-finals (places 2-7 and the two play-in winners, seeded 8 for the winner of the game hosted by 8th and 9 for the other). Home advantage follows the bracket seed with 1-1-1 (best of three), 2-2-1 (best of five) and 2-2-1-1-1 (best of seven) patterns. Primera FEB's final stage is played at one venue; the game marks it but does not yet remove home advantage there. Implementation: `src/world/postseason.ts` (`POSTSEASON_FORMATS`).

The France promotion bracket's semi-final pairing differs from a conventional eight-seed bracket: QFA (1–8) meets QFB (3–6), and QFC (2–7) meets QFD (4–5). Preserve the official table instead of applying the generic helper blindly.

Serie A2's first play-in round is 10–13 and 11–12; the winners visit 9 and 8 respectively. Those two winners enter as the last two playoff seeds. The BSL's final domestic order also includes a Turkish Cup provision. National cups are outside this sprint; do not fabricate cup results to apply it.

## Regular-season ranking: first integrated rule

New French top- and second-division careers save `standingsRule: lnb-2026-1`. [LNB 2026/27 regulations, articles 205.1–205.2](https://cdn.lnb.fr/uploads/content-library/39111ddae9f1edf9b1c739b6c69d3203ba0936c6d444634fa341d83db9fcc283.pdf) establish win percentage, then the tied clubs' direct win percentage, direct scoring difference, direct points scored, overall difference and overall points scored. A partially separated group restarts the procedure. The special in-season example keeps a club with no direct meeting in its overall-difference slot; the implementation tests that published six-club example.

When sporting criteria remain equal, a completed table uses a reproducible draw. During the season those clubs keep a stable display order marked as unresolved. The draw uses an independent stream keyed by competition, scheduled fixture identities and tied clubs; it does not advance the match random generator. This is the game's implementation of drawing lots, not an imported real-world draw. No championship, promotion or playoff qualification is awarded here.

Article 205 also covers sanctions and exclusions. The engine records sporting wins/losses and its own default results, not disciplinary forfeits, deducted wins or exclusions. A default is not reinterpreted as a sanction. Implement explicit sanction evidence and validation before enabling those exceptions.

Old careers keep their original wins/difference/points ordering. New careers rank other countries' leagues by the FIBA default below until their own rules have been verified and implemented; do not apply LNB rules to them. Research leads checked this increment:

- [FIBA 2026 rules, Appendix D](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2026-v1-1.pdf): general classification points, head-to-head criteria and a final draw. Integrated as the labelled default for new worlds (step 3.4e-1, below). This is not proof of every national league's variations.
- [ACB published tie-break rules](https://acb.com/es/liga/noticias/reglas-de-desempate-liga-endesa-22-23-138397): incomplete direct schedules use overall criteria; two-team and larger ties differ; a sum of per-game scoring quotients is a later criterion. Confirmed current by the 2026/2027 Normas Internas and integrated at step 3.4e-2 (above).
- [FIP Regolamento Esecutivo Gare, article 62](https://fip.it/wp-content/uploads/2025/08/RE-Gare-approvato-dal-CF-17-luglio-2025-del-n-48.pdf): direct wins, scoring quotients to four decimals and, for unresolved ties, personal/technical foul totals. Confirmed current (25 March 2026 edition) and integrated at step 3.4e-2 (above); team fouls come from retained player evidence.
- The retrieved BSL and BBL competition-format PDFs do not by themselves establish their complete regular-season tie-break rules. The BBL rule is in its Spielordnung (integrated at step 3.4e-2); the TBL, BSL and Greek rules remain unverified (above).

## Default ranking: FIBA Official Basketball Rules 2026, Appendix D (step 3.4e-1)

Checked 15 November 2026 against the [FIBA Official Basketball Rules 2026 (July 2026, v1.1), Appendix D "Classification of teams"](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2026-v1-1.pdf), pages 82-88. New worlds save `standingsRule: fiba-2026-d` for every league without a verified rule of its own; the Competition screen labels it "FIBA default". It is **not** a claim that a league uses these rules.

- **D.1.1:** 2 classification points for a win, 1 for a loss (including a loss by default), 0 for a loss by forfeit. The engine's defaults are sporting losses and it records no forfeits, so a club's points are twice its wins plus its losses. A club with games in hand (a bye in an odd field) has fewer points.
- **D.1.3:** clubs level on points are ranked by the games between them: classification points in those games, then points difference in those games, points scored in those games, overall points difference and overall points scored. Clubs still equal are settled by a draw (clubs have no FIBA ranking).
- **D.1.4:** when a criterion classifies one or more clubs, the procedure restarts from D.1.3 for the clubs still level.
- The seven worked examples D.2.1-D.2.7 are reproduced exactly by `tests/fiba-standings.test.js`.
- During a season, clubs that have not met yet score nothing against each other; the procedure then moves on to overall points difference. Ties still unresolved are marked "=" and a completed table uses the same reproducible draw as `lnb-2026-1` (independent stream keyed by competition, fixture identities and tied clubs). D.3 (forfeits, nullified results) and D.4 (cross-group comparisons) are not used: the engine has no forfeits, and domestic leagues are single groups.
- Implementation: `src/world/fiba-ranking.ts`; rule choice `standingsRuleFor` in `src/domain/competition.ts`.

## League-specific ranking rules (step 3.4e-2)

Checked 15 November 2026. New worlds (format 52, IDs `real-rules-`) give these leagues their own rule; worlds created earlier keep the rule they were created with. Implementation: `src/world/league-rankings.ts`; tests `tests/league-standings.test.js`. Raw downloads stayed in the session scratchpad and are not committed.

| League | Rule id | Source (current for 2026-27) | Criteria |
| --- | --- | --- | --- |
| Spain ACB | `acb-art7-2026` | [ACB Normas Internas 2026/2027](https://www.acb.com/docs/descarga/pdf/transparencia/221026_normasinternas.pdf), articles 6.2 and 7 (cover "Temporada 2026/2027"; article 7 is unchanged from the 2024/25 edition and from the [2022-23 summary](https://acb.com/es/liga/noticias/reglas-de-desempate-liga-endesa-22-23-138397)) | Most wins, or win percentage while clubs have played different numbers of games (6.2). Level clubs with fewer games first (7.2). Level clubs that have not all met home and away (7.3.1): overall difference, overall points scored, sum of per-game quotients (points scored / conceded) to a thousandth. All met home and away (7.3.2): two clubs by direct wins, direct difference, overall difference, overall points, quotient sum; three or more also use direct points scored after the direct difference; clubs still level restart with the list for their number |
| Germany BBL | `bbl-art20-2026` | [easyCredit BBL Spielordnung 2026/2027](https://cms.easycredit-bbl.de/wp-content/uploads/2026/08/easyCredit-BBL-Spielordnung-2026_2027.pdf), §§ 16 and 20 | 2:0 Wertungspunkte for a win, 0:2 for a loss; more plus points, then fewer minus points. Level clubs: direct plus points, direct difference, overall difference, the better quotient (smaller with a positive difference, larger with a negative one: at equal difference, more points scored; no decision at zero), then lots. Placed clubs leave the comparison and the rest restart (§ 20 (8)-(9)) |
| Italy LBA and Serie A2 | `fip-art62-2026` | [FIP Regolamento Esecutivo Gare, 25 March 2026](https://fip.it/wp-content/uploads/2026/04/RE-Gare-approvato-CF-25-marzo-2026-n-360.pdf), articles 60 and 62 (unchanged from the 17 July 2025 edition). The [LBA Regolamento Sportivo](https://segreteriagenerale.fip.it/wp-content/uploads/2023/10/All.-del.97-LBA-Regolamento-Sportivo.pdf), article 8.2, applies FIP article 62; no Serie A2 override was found, and the [FIP 2026/27 annual rules](https://fip.it/wp-content/uploads/2026/05/DOA-26_27-versione-1.pdf) add none | 2 points for a win, none for a loss. Two clubs: direct wins, direct quotient (scored / conceded), overall quotient. Three or more: a table of their direct games, the direct quotient among clubs still level, the overall quotient; two or more still level restart with the list for their number (62.2). Then fewer personal and technical fouls in the direct games, then in all games (62.3). Quotients keep four decimals (62.5) |

Readings and limits:
- **Sanctions** (ACB 7.1, BBL § 20 (2), forfeits): the engine records none, so these clauses never apply.
- **ACB 7.3.3** (the previous season's final classification) is not applied; a tie that survives the quotient sum uses the game's reproducible draw. Season one has no previous classification in the game's data, and the rule does not say how promoted clubs compare.
- **ACB 6.2/7.2** while games played differ: clubs level on win percentage with different games (for example 2-1 and 4-2) put the club with fewer games first. In the game's even leagues all clubs play every week, so this arises only with byes.
- **ACB quotient:** read as the sum of each game's quotient ("la suma de los cocientes"), rounded to a thousandth; a game conceding 0 points (a 2-0 default) counts as an infinite quotient.
- **FIP fouls:** the engine records personal fouls only (no technical fouls); team totals come from the players selected for each game, using full box scores or the per-player appearances kept for archived games. A tie that survives the fouls uses the reproducible draw (article 62 names no further criterion; 62.4 covers only competitions of three clubs). A direct quotient of 0:0 counts as equal totals.
- **Incomplete direct games during a season** (BBL, FIP): the texts describe final tables; the game applies the same criteria to the games played so far.

Not changed (the FIBA default stays, labelled):
- **Greece GBL:** the [ESAKE competition regulations 2025-2026](https://www.esake.gr/img/GBL_COMPETITIONS_REGULATIONS_2025-2026.pdf) (the latest published) give 2 points for a win and 1 for a loss (article 27), the same as FIBA, and leave ties to each season's special notice (article 28.2), which is not published; article 3 applies FIBA rules otherwise.
- **Turkey BSL and TBL:** tbf.org.tr refuses automated access (a browser check), so the 2026-27 statute "BSL 2026-2027 Sezonu Statüsü ve Lig Sıralaması" (in force from 28 August 2026) could not be read. Secondary sources list points, games between the clubs, overall difference and points scored. Local-only: the owner can open the TBF PDF in a browser.
- **Spain Primera FEB** was not among the candidates; it keeps the default.

## European competitions: research for step 3.5 (15 November 2026)

Checked from free sources by Claude; euroleaguebasketball.net refused direct downloads (HTTP 429), so its pages were read through search results and press reports of them.

- **EuroLeague Final Four: no third-place game.** The by-laws approved at the ECA meeting of 19 June 2025 removed it "starting with the 2025–26 Final Four" ([Eurohoops, 19 June 2025](https://www.eurohoops.net/en/euroleague/1839488/euroleague-to-introduce-new-penalties-including-win-deduction-for-actions-of-team-officials)). The 2027 Final Four (Abu Dhabi, 28 and 30 May 2027) is two semi-finals and the final.
- **EuroLeague places, 2026-27:** 20 clubs. Long-term licences: Anadolu Efes, ASVEL, Barcelona, Baskonia, Bayern, Fenerbahçe, Maccabi, Olimpia Milano, Olympiacos, Panathinaikos, Real Madrid, Žalgiris (CSKA suspended); wildcards: Dubai (five years), Crvena Zvezda, Partizan, Valencia, Virtus Bologna (three years to 2027-28), Paris and Beşiktaş (one year); EuroCup route: Hapoel Tel Aviv. **EuroCup route** (press accounts of the by-laws: Eurohoops, 14 March 2025 and 29 April 2026): the EuroCup champion takes a one-year EuroLeague licence, the runner-up only when two places are open, and a holder renews it by reaching the EuroLeague playoffs, at most twice. Domestic results do not decide EuroLeague entry. A reform to 24 clubs from 2027-28 is reported but not decided.
- **EuroCup 2026-27:** 32 clubs (21 five-year licences, 11 one-year places chosen by domestic rankings) in four groups of eight; groups as drawn on 8 July 2026; top four of each group to best-of-three eighth-finals, quarter-finals, semi-finals and finals.
- **Basketball Champions League, Season 11:** [Competition Regulations 2026-27](https://assets.fiba.basketball/image/upload/basketball-champions-league-209123-competition-regulations.pdf) (linked from the site menu; the competition page still links the 2025-26 edition). Qualification: two single-game tournaments, 14-20 September 2026 (QRT1: eight clubs from the quarter-finals; QRT2: sixteen from the round of 16), whose two winners join 30 direct entrants. Regular season: eight groups of four, home and away, with country protection at the draw. Play-ins: best of three, second-placed club at home in games 1 and 3 (A2-B3, B2-A3 and so on). Round of 16: four groups of four fixed by the draw pattern (I: A1, E1, C2/D3, G2/H3; J: B1, F1, D2/C3, H2/G3; K: C1, G1, B2/A3, E2/F3; L: D1, H1, A2/B3, F2/E3), top two through. Quarter-finals best of three, group winner at home in games 1 and 3. **The BCL Final Four keeps a third-place game** (article 19.3). Draw and line-up: [8 July 2026](https://www.championsleague.basketball/en/news/basketball-champions-league-season-11-draw-completed).

### Implemented EuroLeague format (steps 3.5b-c, format 57)

`src/world/european-formats.ts` (`euroleague-2026-1`): 10-20 entrants (the real field has 20), a double round robin from a seeded draw, ranked by the FIBA Appendix D default (the EuroLeague's own tie-break text was not checked); Play-In 7 v 8 and 9 v 10, then the loser of 7 v 8 against the winner of 9 v 10, single games at the better seed; playoffs 1-8, 2-7, 3-6, 4-5 best of five with games 1, 2 and 5 at the better seed; Final Four semi-finals (1-8 winner v 4-5 winner, 2-7 v 3-6) and final at one venue, no third-place game. Dates: Thursdays of weeks 3-32 (Tuesday too in eight evenly spread weeks), Play-In 20 and 22 April 2027, playoffs 27 April to 11 May, Final Four 25 and 27 May (real: 28 and 30 May, moved to Tuesday and Thursday so every club rests a day after its Saturday game).

### Implemented EuroCup format (step 3.5d, format 58)

`eurocup-2026-1`: published facts from the BKT EuroCup 2026-27 schedule ([Eurohoops, 29 July 2026](https://eurohoops.net/en/eurocup/1994861/bkt-eurocup-announces-the-2026-27-schedule)): four groups of eight, home and away; regular season 29 September 2026 to 13 January 2027 on Tuesdays and Wednesdays; eighth-finals 2-12 February, quarter-finals 9-19 March, semi-finals 31 March-9 April, finals 21, 27 and 30 April 2027, all best of three. **Not published there, so assumed:** the group draw method (no pots or country protection), the eighth-final pairings (A1-B4, B2-A3, B1-A4, A2-B3; C with D alike) and the later bracket (within each half), home advantage in best-of-three series (games 1 and 3 at the better seed) and the group ranking (FIBA Appendix D default). The official fixture PDF linked from that page was not read.

### Implemented BCL format (step 3.5e, format 59)

`bcl-2026-1`, following the 2026-27 regulations (qualification tournaments, eight groups of four with country protection, play-ins A2-B3 and so on with the second-placed club at home in games 1 and 3, the Round of 16 pattern, best-of-three quarter-finals with the group winner at home in games 1 and 3, and a Final Four with a third-place game). Published dates checked on 15 November 2026 (BCL draw news and games page): regular season from Tuesday 6 October 2026 on Tuesdays and Wednesdays, game days through 23 December, play-ins in January, competition end 16 May 2027. **Assumed:** squad strength instead of club rankings for direct places, qualification places and pots; qualification days (8-17 September at one venue); the regular-season round dates among the listed game days; play-in, Round of 16 and quarter-final dates; quarter-final pairings I1-J2, J1-I2, K1-L2, L1-K2 and Final Four semi-finals I/J against K/L on 11 May with third place and final on 13 May; the FIBA Appendix D default for every group.

### Next divisions, 2026-27 (step 3.4d-4, researched 15 November 2026)

Built into new worlds below the chosen leagues (`src/data/lower-divisions-2026.ts`; generated squads until promoted; never Italy or France):
- **Turkey, TB2L (tier 3):** 22 clubs in two groups of 11. Sources: basketfaul.com.tr draw report (2 September 2026), corumhaber.net (group B), Turkish Wikipedia; the TBF list (18 August 2026) blocks automated reading.
- **Spain, Segunda FEB (tier 3):** 28 clubs in Grupo A and Grupo B of 14. Sources: es.wikipedia.org/wiki/Segunda_FEB_2026-27, gigantes.com (22 July 2026), diariodeleon.es.
- **Germany, ProA (tier 2):** 18 clubs. Sources: 2basketballbundesliga.de/teams/, its table, English Wikipedia.
- **Greece, Elite League (tier 2):** 16 clubs. Sources: eliteleague.gr standings, allstarbasket.gr fixture list.
Groups are not modelled (one list per country); colours are from the clubs' public identities where a source gives one, otherwise neutral grey.

## Registration evidence and limits

BBL permits up to twelve on a match sheet, with at least ten fit players. Its domestic-player minima are four for ten selected, five for eleven, six for twelve, with additional U23 exceptions. Its registered list and late additions have exceptions too. The simple nationality field in the pack **does not prove legal German status or an exception**. Source: BBL regulations above, section 3.

Primera FEB separates season registration, formation status and non-EU eligibility. It permits 8–15 registered players, with formation minima that vary by list size and a two-player non-EU limit subject to exceptions. Homegrown/formation status cannot be inferred from nationality. Source: FEB regulations above, section 2.3.

`competition-registration.ts` accepts explicit sourced eligibility facts and returns `unverified` when a quota cannot be established. The tests use a synthetic rule; they do not certify a complete real-league ruleset. No current career has acquired these new restrictions yet.

## Still to verify before publishing real formats

- Current TBL statute, Greek top-division playoffs/relegation, complete ACB and Serie A playoff/registration rules. Retrieved ACB/LBA calendar announcements establish dates, but do not establish all rules.
- ~~BCL qualifying and entrants~~: resolved 15 November 2026, see "European competitions: research for step 3.5" below.
- ~~EuroLeague Final Four third-place game~~: resolved 15 November 2026: there is none (below).
- ~~EuroLeague licences and future one-year places~~: resolved 15 November 2026 from press accounts of the by-laws (below); no official 2026-27 text was found.
- Full registration windows, passport/formation evidence and exceptions for every league; real lower-tier identities for external promotion/relegation.

The approved game calendar uses generated Saturday domestic fixtures and midweek European fixtures, rather than importing actual fixture dates. A fixed 38-Saturday regular-season window ends 22 May in season one. The calendar helper rejects overlap and insufficient rest, and keeps weekly accounting boundaries separate from fixture counts. Postseason dates must also preserve the offseason and the following September opening; the helper is not yet wired into career finance/training/save validation.
