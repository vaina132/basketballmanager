# Courtside: European Basketball Manager

A browser basketball management game in development. The design targets the top two men's divisions in Turkey, Spain, Greece, Germany, Italy and France, plus EuroLeague, EuroCup and Basketball Champions League.

The playable development version includes a **fictional six-club league with season rollover and offseason recruitment** and standalone exhibitions. Choose a club, coach its home and away games, complete ten matchdays, renew contracts and recruit for the following year. Review current and retained past-season player statistics, box scores, tables and results. The possession engine includes passing, drives, defensive matchups, a tested subset of FIBA 2024 rules, a large animated diagonal court and live stamina bars. The game opens at a main menu with New career, Continue, Load saves, Import and Exhibition. New careers collect your manager profile and club before opening the manager's desk. The full historical management career remains in development.

Real reference data is now available separately: **double-click `Open real data.cmd`** in this folder to browse 40 clubs and 727 players from official 2025-26 EuroLeague/EuroCup records. No account or payment is needed. Search, player statistics and spreadsheet exports work offline after downloading. See [coverage and source details](docs/real-data.md); these records are not yet integrated into the career game.

## Run locally

Requires Node.js 24.14 or newer.

On Windows, double-click **Start game.cmd** to launch the game in your browser. Keep its window open while playing; closing it stops the local server. It installs the locked dependencies if they are missing.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Choose **New career**, enter your manager name, date of birth and nationality, select a club, then review the injury setting and press **Start career**. The available pack is the fictional development league beginning 5 September 2026.

After each finished match, **Continue** records the matchday results and prepares the next fixture. After finalizing the last matchday, **Review offseason** opens recruitment; secure at least eight players or delegate recruitment before starting the following year. Careers with contracts disabled retain **Next season**. The Season selector in Competitions opens earlier tables and results. **Autosave** records a checkpoint when a new game starts, after each completed matchday, after season rollover, and after contract and scouting decisions. **Save season** also saves during a match. Open **Save history** in the footer to restore one of the five most recent checkpoints; **Continue saved career** on the main menu opens the latest.

**Main menu** pauses and saves an active career; **Resume current career** returns to it. Click your manager identity in the sidebar, or **Manager profile** in the footer, to edit your details. Date of birth determines age on the simulated calendar. Older saves can add a profile without restarting. Export/import still works for file backups; local history retains five snapshots across careers, so export a separate file to keep a career permanently.

Choose Standard, Reduced or Off injuries when starting a game; the setting applies to every club. Injuries carry between fixtures, recovering players are kept out of the lineup, and Squad shows a medical report with return dates and history. Original format-1 season saves retain injuries off when loaded.

**Training** opens weekly plans for your club. Delegate to the assistant or choose Recovery, Light, Standard or Heavy workload, a team focus, and individual player focuses. The week runs after you finish a matchday and press Continue; heavier work trades freshness for development. Injured players miss unavailable days. The latest report shows participation, gains and condition changes. Older careers have an **Enable training** button. Use **Save season** to save plan edits before the next automatic checkpoint.

**Squad → Season statistics** shows sortable per-game, total and per-40-minute figures. Select a player to review their match history, including injury absences and unused games. **Competitions → League player statistics** compares all clubs with position, club, name and participation filters; player reports link to match box scores. These figures use committed results, so they update after Continue. Use the season selector in Squad or Competitions to revisit archived player statistics and match box scores. Newly completed seasons retain player records. Archives imported from formats 1-8 have team results only; their missing player statistics are shown as unavailable.

**Staff** manages up to three training coaches. Review their skills and season fees, recruit within the coaching allocation, assign a specialty or Balanced coverage, and choose whether their contract renews next season. Releasing a coach keeps that season's fee committed. Coaching improves future training gains; weekly reports show its contribution. Older careers have an **Enable coaching** button. Save season keeps staff edits before the next automatic checkpoint.

**Club** manages ticket prices and the club ledger. Set a price or delegate ticketing, inspect the next home gate forecast, and review income, costs, cash and outstanding obligations. The current matchday's price is locked; edits apply when the next matchday is prepared. Continue books home ticket income and operating costs once. Coaching fees are paid from cash as well as consuming the coaching allocation; unpaid costs block new appointments. Older careers can enable finances explicitly. Use Save season to keep ticket edits before the next checkpoint.

**Squad → Wages** shows each player's season wage, charges and remaining commitment. Wages are charged in ten matchday installments, including for injured or unused players. Settle a player's remaining season wages early for a 5% discount, or delegate settlement decisions. Automatic payroll preserves the other players' remaining wages and a EUR 100,000 cash buffer. Coaching recruitment also respects future wage commitments. Older careers can enable payroll after enabling club finances; charges begin prospectively. Save season keeps payroll decisions before the next automatic checkpoint.

**Transfers** manages employment contracts and next season's squad. Renew expiring players during the season; after the final matchday, recruit available players from the development league. Review annual wages and one-to-three-year terms before signing. Every club has a EUR 240,000 annual wage allocation and must register eight to twelve players. Budget checks protect room to complete an eight-player squad. Initial contracts expire after the current season; accepted renewals and signings take effect next season, leaving current matches and registrations unchanged. Switching to **Assistant** immediately renews players toward a squad of ten and recruits during the offseason. Signed contracts remain binding if you return to Manual. Contract activation, delegation changes and accepted offers save automatically. New careers enable contracts; imported formats 1–9 retain an **Enable player contracts** action after finances and payroll are enabled.

**Scouting** lets you shortlist players and assign up to two registered outsiders per matchday. Reports arrive when Continue commits that matchday. A player needs court time to improve your knowledge; unused players produce a **No minutes** review. Successful observations improve report depth through three levels, while outsider skills always remain ranges. Reports keep their assessment date and widen as they age. Your own squad shows exact current skills; departing players retain an uncertain assessment from their time at your club. Switch assignments to **Assistant** to fill available slots automatically. Scouting and Transfers link directly to the same reports and shortlist. Assignment, cancellation, shortlist and delegation decisions save automatically. New careers enable scouting; imported formats 1–10 keep it disabled until you choose **Enable scouting**. New observations require an active season and a registered player, so they cannot be assigned during the offseason or to unattached free agents.

The first scouting model uses club observation capacity, without hired scouts or extra fees. AI recruitment uses its own exact squad knowledge, saved outsider estimates or a neutral estimate for unknown players. Regional searches, scout staff, potential/personality assessments and calibrated observation accuracy remain future work; no unmodeled personal traits are invented.

Build static assets with `npm run build`; the output is `dist/`. Deployment remains under the project owner's control.

In Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy blocks `npm.ps1`.

```sh
npm test
npm run typecheck
npm run build
npm run benchmark:match
```

## Design documents

- [Game design](docs/game-design.md): product scope, play loop, interface, requirements and acceptance stories.
- [Decision record](docs/decisions.md): the eighteen discovery answers and proposed engineering defaults.
- [Club and world mechanics](docs/design/club-and-world.md): players, training, injuries, staff, scouting, finances, facilities, business, youth and AI.
- [Match simulation](docs/design/match-simulation.md): the target rules/action engine, tactics, shared playback and calibration.
- [Rules evidence and coverage](docs/design/rules-coverage.md): pinned FIBA articles, competition differences, scenario checks and remaining omissions.
- [Data and sources](docs/design/data-and-sources.md): historical roster reconstruction, official source candidates, estimated ratings and asset provenance.
- [Data acquisition](docs/data-acquisition.md): free/paid supplier shortlist, sample checks and a ready-to-send enquiry.
- [Real data available now](docs/real-data.md): downloaded official EuroLeague/EuroCup records, local browser/CSV exports, and measured coverage limits.
- [Architecture](docs/architecture.md): state, workers, persistence, versioning and browser boundaries.
- [Implementation plan](docs/implementation-plan.md): milestones and their acceptance conditions.
- [Current status](docs/implementation-status.md): implemented behavior, checks and remaining work.

## Project boundaries

The exhibition supports watching/pausing, quarter skipping, instant simulation, tactical changes, queued substitutions and timeouts, foul-outs, team penalties, shot-clock resets, basic injuries, assistant rotations, squad profiles, box scores, and local save/import/export. Mandatory replacements pause every playback mode until resolved. New exhibitions resolve separate advances, completed passes, drives and shots. Court spacing, the assigned defender, player attributes and fatigue influence shot creation. Completed passes can lead to makes or misses; qualifying made baskets credit the actual passer with an assist. The court animates those recorded actions alongside free throws, rebounds, turnovers and substitutions; reduced-motion and text-only views use the same events. Coaching feedback reports completed passes, drives and shot contests. These are discrete action sequences; full movement physics, competition-specific rules and statistical calibration remain later work. See the status document for precise limits and verification results.

Exhibition saves use format 2. New matches use `possession-3` and save the live handler, passing context, positions and defensive assignments. Earlier `rules-2` matches retain their original engine and deterministic continuation; starting a new exhibition selects the new engine. Court scenes remain optional presentation metadata, with a static fallback for events without scenes. Saves restore the resolved sporting state; a partly watched animation resumes at that action's completed state. Format-1 prototype saves remain unsupported and are not overwritten on load. This development save format is not yet a stable career format.

Season files use a separate format-11 `basketball-manager-season` envelope. Local season storage retains five transactional checkpoints, separate from exhibitions. They retain the manager profile, active match, club instructions, lineup, condition, career injury history, current schedule, completed box scores, training, coaching contracts, the financial ledger, wage agreements, full employment history, scouting observations and shortlists. New archives retain player box scores, registered roster snapshots, jersey numbers, scores and final standings. Previously discarded box scores in old saves cannot be recovered. Valid formats 1 to 10 migrate without changing their active match or random state, with scouting disabled until explicitly enabled. Formats 1–9 also keep player contracts disabled until explicitly enabled; format 10 retains its employment state. Formats 1 to 7 keep the manager profile unset until supplied; later versions retain it. Original roster ownership is reconstructed for old results and reports, while archived player statistics discarded by formats 1–8 remain unavailable. Formats 1–3 keep training disabled until enabled; formats 1–4 keep coaching disabled until enabled; formats 1–5 keep finances disabled until enabled; formats 1–6 keep player payroll disabled until enabled. Existing management state is preserved. Season saves do not overwrite the exhibition slot. Matchdays and season transitions run in a cancellable worker and commit once. Each new year begins on the first Saturday of September, applying offseason recovery and contracted roster changes together. All sixty catalog players retain their identities, condition and development even while unattached. Aging, the full club economy and detailed rehabilitation remain in development. Injury incidence and recovery durations remain provisional game models.

If another tab saves newer progress, this tab cannot overwrite it: load the latest checkpoint to continue, or export the current game to preserve a different timeline. Failed automatic saves leave the current game open and show a persistent recovery message. The five checkpoints share one local season slot across clubs; use file exports to retain separate careers. Autosave happens at game creation, calendar boundaries and contract/scouting decisions, not after every match action.

The initial training model is provisional: 100 practice points raise a skill by one, with a maximum gain of two per skill and a rating ceiling of 20. Assigned coaches can add bounded practice gains; facilities, age, latent potential and training injuries do not affect it yet. Training runs between matchdays 1–10; offseason rollover grants recovery but no skill points. Assistant, fitness, physio, scout and youth-coach recruitment remain future systems.

The financial model uses fictional venues, sponsors and estimates: EUR 500,000 opening cash, EUR 200,000 annual sponsorship, EUR 15,000 operating costs per matchday, full-season coaching fees and authored starting wages. Midseason finance activation prorates sponsorship and charges existing current-year coaching contracts. Receipts settle unpaid costs before adding available cash; there is no free overdraft. Attendance depends on price, capacity and earlier results using provisional coefficients. Payroll uses a ten-installment development schedule, not the planned monthly payroll calendar; each new schedule uses that year's agreed employment wage. Wage charges can create unpaid club obligations and are not necessarily cash payments. The initial contract model accepts annual salaries at or above the player's authored asking wage, up to EUR 50,000 in EUR 500 steps, with no upfront signing fee. Transfers currently mean offseason free-agent signings and nonrenewal departures. Transfer fees, midseason moves, early termination, loans, agents, competing offers, regional scouting networks, sponsorship negotiations, facilities, debt recovery and board sanctions remain unimplemented. Finances do not constitute a calibrated full-club economy yet.

The agreed first release includes all twelve domestic divisions and the three European competitions. Smaller development fixtures do not reduce that scope. Realistic statistical behavior, the historical data pack and full competition rules require validation before release.

The code's Apache license does not grant rights to third-party player photos, club marks or datasets. The development fixture uses fictional identities and code-drawn appearance. Real data and images need separate source/asset manifests; estimates must be labeled.
