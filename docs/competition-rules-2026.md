# Competition rules research, 2026–27

Checked 15 November 2026. This is a source register for Sprint 3, **not a claim that these competitions are playable**. Raw source captures are private working artifacts under `.artifacts/sprint3-source-*.json`. The generic calendar, series, standings and registration modules are foundations; career integration remains open.

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

The France promotion bracket's semi-final pairing differs from a conventional eight-seed bracket: QFA (1–8) meets QFB (3–6), and QFC (2–7) meets QFD (4–5). Preserve the official table instead of applying the generic helper blindly.

Serie A2's first play-in round is 10–13 and 11–12; the winners visit 9 and 8 respectively. Those two winners enter as the last two playoff seeds. The BSL's final domestic order also includes a Turkish Cup provision. National cups are outside this sprint; do not fabricate cup results to apply it.

## Registration evidence and limits

BBL permits up to twelve on a match sheet, with at least ten fit players. Its domestic-player minima are four for ten selected, five for eleven, six for twelve, with additional U23 exceptions. Its registered list and late additions have exceptions too. The simple nationality field in the pack **does not prove legal German status or an exception**. Source: BBL regulations above, section 3.

Primera FEB separates season registration, formation status and non-EU eligibility. It permits 8–15 registered players, with formation minima that vary by list size and a two-player non-EU limit subject to exceptions. Homegrown/formation status cannot be inferred from nationality. Source: FEB regulations above, section 2.3.

`competition-registration.ts` accepts explicit sourced eligibility facts and returns `unverified` when a quota cannot be established. The tests use a synthetic rule; they do not certify a complete real-league ruleset. No current career has acquired these new restrictions yet.

## Still to verify before publishing real formats

- Current TBL statute, Greek top-division playoffs/relegation, complete ACB and Serie A playoff/registration rules. Retrieved ACB/LBA calendar announcements establish dates, but do not establish all rules.
- BCL's current qualifying draw/seedings and all 54 entrants' direct/qualifying status. Its competition page currently links a PDF whose body says **2025–26**; that PDF cannot certify the 2026–27 registration rules.
- EuroLeague Final Four third-place game: the current format page lists semi-finals and final only. The earlier plan assumed a third-place game; do not implement it without current evidence.
- EuroLeague long-term licences and allocation of future one-year places. The plan's provisional Paris/Beşiktaş assumption still needs confirmation.
- Full registration windows, passport/formation evidence and exceptions for every league; real lower-tier identities for external promotion/relegation.

The approved game calendar uses generated Saturday domestic fixtures and midweek European fixtures, rather than importing actual fixture dates. A fixed 38-Saturday regular-season window ends 22 May in season one. The calendar helper rejects overlap and insufficient rest, and keeps weekly accounting boundaries separate from fixture counts. Postseason dates must also preserve the offseason and the following September opening; the helper is not yet wired into career finance/training/save validation.
