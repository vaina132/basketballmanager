# The NBA (playable, new careers only)

Owner decisions, 23 November 2026:

- The NBA is **playable**: the manager can coach an NBA team.
- It is offered **like any other league**: the player chooses it in the career setup just like a European country, alone or together with other countries. In a world with both, players move between the NBA and Europe and the manager can move between jobs.
- **Real team and player names.** NBA player rights (NBPA / THINK450) join the licensing list in HANDOVER.md, settled before any sale.
- **Data from API-Sports** (Pro plan, 7,500 requests a day): 30 teams, 2026-27 rosters, box scores of every 2025-26 game and of 2026-27 so far. The data is published to the Supabase pack like the European clubs.
- **Currency:** the game shows **euros by default**. A game setting lets the player switch the shown currency (euros or US dollars) for the whole game. Money is stored in euro cents as today; the setting changes the display only (fixed game rate, default 1.16 USD per EUR, reversible).
- **Ratings:** one shared 1-20 scale anchored on Europe. NBA stars rate higher than EuroLeague stars and may reach 20. European ratings stay exactly as they are.
- **Salaries:** estimated (no licensed salary source). They must reflect reality: **the NBA pays far more than Europe**. A 2026-27 NBA team payroll is roughly $150-200M (salary cap about $155M in 2025-26, luxury tax about $188M), the minimum salary about $1.2M and a maximum contract 25-35% of the cap ($39-55M); a top EuroLeague payroll is about €25-40M. Each team's estimated total is shaped on its published payroll.

- **Young European talents go to the NBA** (owner, 23 November 2026), in worlds with the NBA and European countries:
  - **Through the draft:** real draft-eligible European players (aged 19-22, never drafted) join the draft pool alongside the generated prospects. An NBA club that drafts a player under contract in Europe holds his draft rights. He stays at his European club ("draft and stash") until the club brings him over in an offseason. The NBA club pays up to the CBA buyout allowance (about $875k) and his European club receives the buyout. First-round picks usually join within 0-2 seasons; second-rounders often stay longer.
  - **By other means:** undrafted European players good enough for the NBA get NBA free-agent offers when their contracts end, or through a buyout clause. They choose the NBA over European offers. NBA players without NBA offers go to Europe.
  - **The manager is told:** a European club's manager gets an Inbox notice when his player is drafted or signs in the NBA. An NBA manager sees his stashed draft rights on Transfers > Draft.

## Rules used (reversible defaults unless the owner decided)

- Match: 4 x 12 minutes, 5-minute overtime, foul-out at 6, team-foul penalty from the 5th foul in a quarter (2nd in the last two minutes), seven timeouts, three-point line 7.24 m (corners 6.71 m). FIBA matches stay bit for bit as today.
- Season: 82 games (division rivals 4x, six conference teams 4x, four 3x, the other conference 2x), mid-October to mid-April; back-to-back games allowed for NBA clubs only (at most 16). Play-in (7-10) and best-of-seven playoffs per conference, then the Finals (home court by record). NBA tie-breaks. No relegation.
- Left out of the first version: the NBA Cup, two-way contracts and the G League, trading draft picks, sign-and-trade, player/team options, restricted free agency, the second apron's hard limits, the stretch provision, repeater tax, All-Star game and awards, summer league.
- Economy: salary cap with simplified Bird rights, one mid-level exception a season, minimum and maximum contracts by age band, rookie scale by pick, roster 13-15, luxury tax paid at the end of the regular season and shared among non-payers. Contracts stay at most 3 seasons for now.
- Draft: lottery for the 14 non-playoff teams (2019 odds), two rounds of 30, generated prospects (about 25% international) shown with scouting estimates.
- Trades: player for player between NBA clubs, salary matching over the cap (125% + $100k), deadline the first Thursday of February; about 4-8 computer trades a season; the manager's offers are answered in the Inbox.
- Career: NBA jobs ask for a reputation of about 60-70; NBA owners judge wins and the playoffs. NBA clubs have no academy; their players miss FIBA windows.

## Steps (formats from 90; whoever merges takes the next free number)

0. This note and the decisions.
1. NBA data: clubs, conferences and divisions, arenas, rosters, positions, heights, ages, head coaches, logos, photos.
2. NBA ratings on the shared scale (two-stage solve: Europe exactly as today, then the NBA level fitted to it); publish the pack (older clients ignore a 30-club league).
3. Rules per competition in the match engine (`src/engine/rulesets.ts`), protected by a FIBA golden test written first.
4. World builder: the NBA league in `worldFromPack`, alone or with European countries.
5. Schedule, calendar, standings, play-in and playoffs. After this step the NBA becomes choosable.
6. Economy, salary cap, luxury tax and the currency setting.
7. Free agency and moves between the NBA and Europe.
8. The draft.
9. Trades.
10. Career: NBA jobs.
11. Screens: Competitions NBA tab or League tab, conference/division standings, bracket, draft, trades, cap sheet.
12. Measurement: NBA match calibration (about 114 points a team, pace about 99, 42% of shots from three), five automatic seasons, speed and save size.
13. Notes.

The technical plan per step is in [nba-plan.md](nba-plan.md).
