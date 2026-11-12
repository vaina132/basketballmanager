# Project handover

Prepared 12 November 2026 and updated at every Level 7 step. Repository: `basketballmanager`; active branch: `level-7`, created from `main` at `acc5c27`. [CLAUDE.md](CLAUDE.md) records the owner's working agreement.

## Active work: Level 7 (facilities, business, board and career)

The owner approved the review's plan on 12 November 2026 and delegated the open choices to the recommended defaults below. Each step is implemented, tested, committed and recorded here. Work stops for a summary at the end of the level.

| Step | Status |
| --- | --- |
| 0. Working agreement in CLAUDE.md | Done |
| P1. Shared current-schema test helper | Done |
| P2. Genuine format-30 fixtures and a committed capture script | Done |
| P3. Save and load responsiveness | Done |
| P4. Named `createSeason` options | Done |
| P5. Documentation corrections | Done |
| 7.1 Sponsorship negotiations and commercial management | Done |
| 7.2 Board funding requests and president traits | Done |
| 7.3 Board consequences when dismissal is off | Next |
| 7.4 Press and player events | Planned |
| 7.5 Optional dismissal and job changes | Planned |
| 7.6 Rivalries | Planned |
| 7.7 Facility maintenance and deterioration | Planned |
| 7.8 Level 7 acceptance and summary | Planned |

Approved choices:

- **Sponsorship (7.1):** one exclusive main-sponsor slot per club; the current fixed EUR 200,000 deal becomes an explicit inherited agreement. Fictional sponsors make dated offers for one to three seasons, valued at roughly 75-125% of EUR 200,000 from venue demand, last season's results and actual attendance. One request for improved terms per offer, answered deterministically. Two dated installments (opening matchday and matchday six) are booked only when due; an optional top-half bonus is booked only if earned. No early termination in this foundation. Manual/Automatic control; AI clubs follow the same rules; an unsold slot earns nothing. Older saves keep fixed sponsorship until explicitly enabled, without changing the current season's payment.
- **Funding requests (7.2):** one-off board capital for facility projects only. The staff and player salary allocations keep their existing rules.
- **Dismissal (7.5):** enabled for new careers; existing saves opt in.
- **Press (7.4):** add an Inbox destination once real press events exist; urgent items also appear on the manager's desk.
- "Richer player relationships", listed with this work in the plan, remains Level 5 work.

Step notes:

- **P1:** `SEASON_SCHEMA_VERSION` in `src/domain/season.ts` is the single current season format number; `season-storage.ts` derives its accepted formats from it. `tests/helpers/season-format.ts` provides `expectedMigration(rawState, fromFormat)` and `currentSeasonFile(state)`. When a format adds a top-level system, add one row to its `ADDED_BY_FORMAT` table instead of editing each storage test. Verified: typecheck; 1,909 of 1,910 tests in the full serial run, the remaining format-13 compatibility test exceeding its own 30-second limit while a CPU profiler ran alongside; that file then passed alone (24/24). Avoid running heavy jobs during the suite.
- **P2:** `npm.cmd run fixtures:capture` (`scripts/capture-season-fixtures.mjs`) records genuine current-format saves into `tests/fixtures/season<version>-board-*.json.gz` and refuses to overwrite them without `--force`. Run it before every save-format change, on unchanged code. The format-30 set (provenance in `tests/fixtures/README.md`) is guarded by `tests/season30-continuation.test.js` (4/4). Strict parse timings on an idle machine: 0.6 MB matchday-five save 65-75 ms, 1.96 MB completed season 150-160 ms, 1.23 MB season-two opening 130-195 ms, 2.68 MB six-season format-26 save 550-595 ms (older formats are validated twice: as written and after migration). Measurements taken while the test suite runs are roughly ten times slower and must not be compared.
- **P3:** strict save validation no longer runs on the interface thread. `src/storage/season-codec.ts` and `season-codec.worker.ts` serialize and parse in one reusable module worker, started on first use; if workers are unavailable or the worker fails, waiting and later requests run on the main thread instead. `App.tsx` uses a module-level codec for autosave, manual save, checkpoint restore, the main menu, import and export. `career-saves.ts` adds `readCurrentCareer(codec, known?)` for the menu (current save only, reusing a career already validated at the same nonzero revision); `readCareerSaves(codec)` validates identical save text once, and the full history loads only when Save history opens. `src/world/pure-cache.ts` caches pure calendar conversions in `season.ts`, `lifecycle-policy.ts` and `youth-competition.ts`; inputs are validated outside the caches. Measured on an idle machine: a 21-season format-29 career loads in 14.7 s instead of 16.7 s and validates for saving in 6.6 s instead of 7.6 s; the 1.2 MB season-two opening parses in 85-97 ms instead of 130-195 ms. A headless Edge check of the production preview confirmed new-career autosave through the season-codec worker, the menu summary, history listing, Continue, export download and import, with no page errors. The full serial suite (100 files, 1,925 tests) passed in 283 seconds, down from roughly 750-895 seconds, because simulation and validation share the cached calendar helpers.
- **P4:** `createSeason` also accepts named options, e.g. `createSeason({ seed, managedClubId, injuryMode, manager, ...NEW_CAREER_SYSTEMS })`; unknown option names throw. `NEW_CAREER_SYSTEMS` (in `src/world/season.ts`) is the single list of systems a new career enables, used by the New career screen and the fixture capture script; add new systems there instead of appending another positional flag. The positional form keeps working for existing callers and tests. `tests/season-options.test.ts` proves both forms create identical careers and keep the same validation messages. Verified: build; full suite 101 files / 1,930 tests in 268 seconds.
- **P5:** `docs/architecture.md` section 11 now states the current format (30) and 32 MiB limit and describes the save worker; `docs/design/club-and-world.md` marks its cash-forecast passages as superseded by the user's decision to omit forecasts from Club. Documentation only.
- **7.1a sponsorship engine and format 31 (committed; interface follows in 7.1b):** `src/domain/commercial.ts`, `src/data/development-sponsors.ts` (6 incumbent + 18 fictional sponsors), `src/world/commercial-policy.ts` (appeal, offers, request response, best offer, payments due), `src/world/commercial.ts` (commands and calendar hooks) and `src/storage/commercial-validation.ts` (strict replay). `SeasonState.commercial` makes this save format 31; formats 1-30 migrate with negotiations disabled. Calendar: `processCommercialRound` after `prepareFinanceRound` (matchday-six installment, renewal offers, automatic choices); `completeCommercialSeason` after the final review (earned bonuses, second-round offers); `startCommercialSeason` before `startFinanceSeason` at rollover (expiry). `startFinanceSeason` books first installments under agreements instead of the fixed EUR 200,000 from the season after activation. Agreement payments are `sponsor` ledger entries with a `sponsorship` detail. Shared helpers keep finance, board and transfer-audit validation consistent: `openingSponsorshipClubs` and `sponsorshipPaymentsDue`. Two latent assumptions that every sponsorship payment falls on the opening day were corrected in the recruitment-resolve and transfer-payment audits (equivalent for older saves). New careers enable negotiations through `NEW_CAREER_SYSTEMS`; the positional `createSeason` form cannot enable them. Tests: `tests/commercial.test.ts` (12), `tests/commercial-storage.test.js` (15, including tampering cases); nine older suites' private encoders now use `SEASON_SCHEMA_VERSION`. Verified: typecheck, build, full suite 103 files / 1,957 tests (470 s while Windows Defender and WMI kept CPU at 60-80%; timings during that period are not comparable).
- **7.1b sponsorship interface:** `src/ui/SponsorshipPanel.tsx` (+ `sponsorship-panel.css`, reusing the facilities panel's control, enable and disclosure styles) sits in Club > Operations after Venue: current sponsor and season fee, dated installment status, next-season outlook, offer cards (per-season fee, guaranteed total, top-half bonus, Review, Ask for 10% more once, Decline), a keyboard-focusable review with the real payment schedule, Manual/Automatic control and an offer history disclosure. `App.tsx` routes every action through the world commands with autosave; the manager's desk shows "Sponsor offers waiting" (urgent in the offseason) and "No sponsor for next season" only when true. Ledger rows name the sponsor and installment. A browser check exposed that clubs processed earlier could receive offers from another club's current sponsor; `sponsorAvailable` now keeps a current sponsor exclusive to its club until its agreement ends (regression test added). Verified: `tests/sponsorship-ui.test.tsx` (5); headless Edge on the production preview with an imported matchday-six save — desk notice, three offers, no horizontal overflow at 1440/768/390 px, one request answered immediately, keyboard review and signing, keyboard-reachable control, no page errors.
- **7.1c balance and documentation:** a six-season, all-automatic diagnostic first showed sponsorship averaging 3-10% above the former EUR 200,000 because home attendance was treated as neutral at 50% full; the attendance factor now centres on a typical 80% (`SPONSORSHIP_NEUTRAL_FILL`). Rerun with seeds 227 and 71: mean agreement fee EUR 202,588 and EUR 190,471, per-season league means EUR 191,500-217,833, range EUR 154,000-277,000 per club-season, 17 agreements each (mean 2.41 seasons, 5-6 with bonuses), no unsold slots or unpaid costs, about 7.3 MB saves after six seasons. The diagnostic scripts are in this session's scratchpad, not the repository; the coefficients are recorded in `docs/decisions.md#sponsorship-negotiation-policy`. Status, architecture, plan and README describe the feature. Verified: build; full serial suite 104 files / 1,962 tests. An A/B parse timing of the six-season format-26 fixture (P4 commit vs this step, back to back) gave medians of about 965 ms vs 975 ms: no regression. Absolute timings on this machine roughly doubled during the afternoon (same code measured about 470 ms earlier), so compare timings only side by side.
- **7.2a board funding engine and format 32 (interface follows in 7.2b):** format-31 fixtures (`season31-board-*`, guarded by `tests/season31-continuation.test.js`) were captured first. `src/data/development-presidents.ts` gives each club a fictional president with generosity 1-5 and owner capital per season (EUR 120,000-250,000). `src/world/board-funding-policy.ts` decides requests: eligible only for a facility upgrade the club cannot fund (no active project, no arrears, board reviews enabled, not within two matchdays of a refusal, and never while committed wages and fees exceed cash, via the new unclamped `getSpendablePosition`); approved when the latest reviewed confidence reaches `65 - 5 x generosity` and the amount fits the season's remaining owner capital. Requests are facilities journal events of type `funding` with recorded evidence; an approval books a `board-capital` ledger entry (`boardCapital` detail) and is immediately followed by the funded upgrade's ordinary `start` event, which the facilities replay, finance checks and validation all enforce. `requestBoardFunding` serves the manager; `automateFacilities` (AI clubs and the manager's Automatic control) asks only when the rules approve, for the shortfall to its EUR 150,000 cushion. `facilities.fundingSince` opts careers in (new careers via `NEW_CAREER_SYSTEMS.boardFunding`; older saves migrate to format 32 with it null). Tests: `tests/board-funding.test.ts` (10, including tampering); the full suite passed 106 files / 1,976 tests. A seed-227 exploration saw eight automatic approvals across rival clubs in about two seasons (EUR 132,000-337,000 per club), bounded by owner capital and the finite facility levels.
- **7.2b board funding interface:** Club > Board gains a "President & owner capital" section (`BoardPanel.tsx`): president name and investor label, owner capital left this season, the confidence needed and whether it is met, an "Enable funding requests" action for older careers (disabled with a reason until facilities are on) and a dated request history with the board's reason for each refusal. Club > Operations > Facilities: when money is the only obstacle, the upgrade review shows an "Ask the board" block (`FacilityBoardFunding` in `FacilitiesPanel.tsx`) with the amount, confidence against the president's threshold, capital left and the expected answer before asking; approval starts construction and moves focus to it, a refusal keeps the review open with the two-matchday wait. Refusal wording comes from one helper, `boardFundingRefusal`, used by the quote, the history and the notice (money now formatted as on screen, e.g. €42,500). A browser check exposed an older focus bug: after any action that autosaves, the page is briefly inert and focus fell to the page body (facility start/cancel and sponsor signing were affected too). `src/ui/focus-when-ready.ts` now waits for the save to finish before moving focus, without stealing focus the player has moved elsewhere; those four actions use it. Tests: `tests/board-funding-ui.test.tsx` (6), two more engine tests (refusal wording; opting in mid-season and after the final matchday both validate); the career driver moved to `tests/helpers/board-funding.ts`. Verified: typecheck, build, 8 related files / 61 tests; headless Edge on the production preview with genuine format-32 saves — approval (keyboard), refusal with wait and focus, Board history, older-career opt-in, no horizontal overflow at 1440/768/390 px, no page errors; the sponsorship check also passed again with focus on the signed sponsor.
- **7.2c documentation:** `docs/decisions.md#board-funding-policy` records the rules and coefficients; status, architecture, plan and README describe the feature and format 32; the board-limits note above is updated. Verified: build; full serial suite 107 files / 1,984 tests (405 s).
- **7.3a board verdicts engine and format 33 (interface follows in 7.3b):** format-32 fixtures (`season32-board-*`, guarded by `tests/season32-continuation.test.js`) were captured first at `ecf460c`. `src/world/board-consequences.ts` turns each club's final (matchday-ten) review confidence into a season verdict using the existing labels (Confident 65+, Steady 45-64, Concerned 30-44, Under pressure below 30; `boardConfidenceLabel` now shares these thresholds). While consequences govern a season, the previous season's verdict sets that season's shared staff allocation (110/100/90/80% of EUR 150,000, `staffAllocation`) and the president's owner capital (150/100/50/0%, `ownerCapital`). The fixed `STAFF_BUDGET` is now only the base: every staff policy, AI hiring and renewal, finance appointment guard, the Staff screen, the budget bar and the save checks use `staffAllocation`; board funding quotes and the Board card use `ownerCapital`. The coaching-only limit (`COACHING_BUDGET`) stays EUR 150,000. Signed staff contracts are never cut, but renewals on the new season's opening day must fit the new allocation. `board.consequencesSince` (format 33) is the opt-in anchor: consequences govern only seasons after the one in which it was recorded; new careers enable it through `NEW_CAREER_SYSTEMS.boardConsequences`, older saves migrate with it null (`enableBoardConsequences`). Because staff and finance checks run before the board is validated, they read the board through a defensive `budgetBoard` helper; `validateBoard` then proves the anchor and every review exact. While bumping the format, a migration line from 7.2 was found to reset `facilities.fundingSince` for format-32 saves, which would have made a genuine format-32 save with a funding decision unloadable; format 32 now keeps it (the continuation test covers loading that fixture). A three-season automatic exploration (seed 227) produced all four verdicts, budgets followed them (e.g. EUR 120,000 staff and no owner capital after Under pressure), every club stayed within its allocation and the 4 MB save validated in 0.36 s. Tests: `tests/board-consequences.test.ts` (9, including tampering and a backdated switch that would cut existing budgets), format-32 migration in the continuation test, and updated options/funding tests. Verified: typecheck, build, full serial suite 109 files / 1,998 tests (543 s). An earlier full run stalled for 48 minutes inside one file and then failed on its own time limit; the same file passes alone in 20 s, so the stall was the machine sleeping, not the code.
- **7.3b board verdict interface:** Club > Board gains a "Season verdict & budgets" section (`VerdictSection` in `BoardPanel.tsx`) between the objectives and the president: this season's staff budget and owner capital with the verdict that set them, and next season's budgets — previewed from today's confidence before the final review ("If the season ended today"), then the final verdict. Older careers see "Enable season verdicts" (`enableBoardConsequences`, wired in `App.tsx`). Review rules explain the thresholds and effects. After the final review, the manager's desk board notice becomes "Season verdict · <label>" with next season's budgets (urgent when Concerned or Under pressure); the budget details add "Set by the board" when a verdict governs the staff budget. `verdictBudgets` previews budgets for any verdict. The shared first-season driver is `playFirstSeason` in `tests/helpers/board-funding.ts`. Tests: `tests/board-verdict-ui.test.tsx` (4); related files 7 / 51 tests passed. Headless Edge on the production preview with genuine format-33 saves: desk notice, Board section at 1440/768/390 px without overflow, new-season explanation, older-career opt-in, no page errors.
- **Remaining long-career cost (not fixed in P3):** validation grows faster than career length (21 seasons: about 7 s per save, now in the background while save-sensitive buttons wait). Profiles attribute about 31% to the academy history replay (`getYouthPlayerStatus`, `processAcademyWeek`) and 24% to the relationship replay, where `getPlayerRelationship` → `gamesFor` rescans every fixture of every season for each player at each preparation. Caching those needs care because some world functions mutate shallow copies; treat it as a dedicated performance step before release.

## Current state and stopping point

The latest completed feature is **board funding requests and club presidents (Level 7 step 7.2: Club > Board president card, "Ask the board" in facility reviews)** on branch `level-7`, after **Club > Main sponsor (7.1)**; see the step notes above. The next step is 7.3, board consequences when dismissal is off. Before Level 7 began, the latest feature was **Club > Board expectations and confidence** (`2b3fad5`), and the original handover cleanup is `dff4479`. The sections below describe the state at that original handover unless a step note above says otherwise.

The next agent should continue from the existing implementation, not restart discovery or rebuild the UI. Read [AGENTS.md](AGENTS.md), the current milestone table in [implementation-plan.md](docs/implementation-plan.md), and the newest sections and explicit limits in [implementation-status.md](docs/implementation-status.md). Older status sections describe earlier increments and are not always statements of today's capabilities.

The game is a working development career, **not the complete agreed first release**. Foundation milestone 1 is complete; milestones 2-7 remain partial; integrated release milestone 8 is pending.

## What is implemented

- **Entry and career:** main menu, new career, club choice, manager profile/date of birth/nationality suggestions with free text, injury options, optional replay code, home/away club management and repeated season rollover. The playable database is a fictional six-club league with ten senior matchdays per season.
- **Match and coaching:** deterministic possession engine, large diagonal animated court, pause/skip, instructions sliders, legal substitution queue with drag/click/keyboard routes, stamina bars, injuries/foul-outs, timeouts, assistant advice, box scores, 1-5 ability stars, 1.0-10.0 match ratings, PIR and MVP. Playback uses the recorded simulation state.
- **Career persistence:** local transactional checkpoints, five recent revisions, stale-write protection, save history, export/import, archived fixtures and original registered squads. Matchday completion, offseason advancement and rollover use a cancellable worker.
- **Management:** squad/performance reports; weekly training; coaches, scouts, fitness coaches, physios, assistants and youth coaches; persistent health/rehabilitation; age-adjusted practice, decline and retirement; scouting ranges, filters, shortlist/observe/report/recruit flow; wage agreements, renewals, negotiations, competing bids, paid/free in-season signings, installments, release clauses and buyouts.
- **Club and youth:** ticket policy, actual finance ledger and fixed sponsorship; funded arena/training/youth infrastructure, construction, upkeep and optional delegation; academy intake, practice and promotion; youth fixtures, results, injury availability and historical reports.
- **Dynamics:** explicit senior playing-time roles, eligible-game concerns, manager conversations, promises, morale/trust and bounded future-match focus. Transfers close promises without rewriting history. Deeper personality, chemistry and contract-role negotiations remain unfinished.
- **Board:** fixed objectives, automatic dated reviews, confidence components and history. Details below.

## Latest increment: board expectations

Main files:

| Responsibility | Location |
| --- | --- |
| Persisted types | `src/domain/board.ts` |
| Objectives, reviews and read-only summaries | `src/world/board.ts` |
| Calendar hooks | `src/world/season.ts` |
| Strict historical evidence validation | `src/storage/board-validation.ts` |
| Compact interface | `src/ui/BoardPanel.tsx`, `src/ui/board-panel.css` |
| Navigation and actual review notices | `src/App.tsx`, `src/ui/ManagerDesk.tsx` |
| Policy, integration and persistence tests | `tests/board.test.ts`, `tests/board-integration.test.ts`, `tests/board-storage.test.js` |

Important behavior to preserve:

- New careers include the opening matchday. Existing careers use **Club > Board > Enable board reviews**, excluding the current matchday even if it has not been played. Activation on matchday 10 or in the offseason waits for the next season. No retrospective targets.
- All clubs receive the same policy. The strongest eight registered players determine a frozen squad assessment. Upper/middle/lower thirds target 60%/50%/40% wins, rounded up over the communicated window. Transfers and later training do not change that season's target. The assessment uses registered base attributes, not a forecast of future growth.
- Financial discipline compares unpaid club costs plus overdue transfer installments with the amount inherited at the mandate's start. Spending affordable cash is not penalized. If finances were disabled at mandate creation, finance remains unassessed until the next mandate.
- `processBoardRound` runs after all current senior results, finance, payroll and due transfer collections, before next-day actions. `prepareBoardSeason` freezes the next mandate after opening registrations and finances. Historical review ledger/roster boundaries must remain reproducible.
- The first two counted games have no sporting assessment. Thereafter wins are compared with target pace with a half-win tolerance and a bounded contribution. Injury allowance uses actual carried absences and dated rehabilitation, not a new injury counted as a whole missed game.
- Confidence starts at 50, moves at most eight points per dated review and carries between seasons. Components and evidence are visible. These are provisional game coefficients.
- **Board confidence currently has no dismissal, budget, recruitment or match effects.** Do not describe those consequences as implemented.

## What is in progress

No unfinished code changes, active feature branch or pending implementation task is being handed over. Board work, its migrations and its validation are complete. Diagnostic browser/server helpers from feature verification were closed; this handover starts no development server. The full release remains unfinished as described below.

## Next steps according to the plan

1. **Sponsorship negotiations and commercial management** is the next management increment. Extend the fixed sponsorship foundation with explicit terms, dated decisions, optional delegation and actual cash consequences. Start with `src/world/finance.ts` (`ANNUAL_SPONSORSHIP`, `enableFinance`, `startFinanceSeason`), `src/domain/finance.ts`, `src/ui/ClubWorkspace.tsx` and finance/storage tests. Define scope and migration behavior before changing state. Preserve existing commitments and board historical payment evidence; do not add fictional spending power.
2. Subsequent work includes board funding requests and employment consequences, press, optional dismissal/job changes, richer player relationships, and broader facility finance/maintenance. These are planned, not active implementations.
3. In parallel, build validated opening-day data packs and actual competition configurations, calendars, registration, promotion/relegation and qualification transitions.
4. Continue rules coverage, match/tactics calibration, economy/AI/population calibration, richer court movement and performance optimization before release acceptance.

The confirmed first release still requires men's top **and second divisions** in Turkey, Spain, Greece, Germany, Italy and France, plus **EuroLeague, EuroCup and Basketball Champions League**: twelve domestic divisions and three European competitions. It targets English, desktop/laptop with tablet support, single-player local saves, a long-running club career and full manager control within real game budgets.

### Real data status

The reproducible reference importer has retrieved official 2025-26 EuroLeague/EuroCup records covering 40 clubs and 727 distinct player IDs. **These records are not integrated into career squads or game ratings.** They contain all-season registration history, not a verified opening-day roster. The rest of the competitions, historical roster reconstruction, rating estimates, source coverage and intended distribution permissions remain open.

See [real-data.md](docs/real-data.md), [data-acquisition.md](docs/data-acquisition.md) and [data-and-sources.md](docs/design/data-and-sources.md). The user accepts paid data if needed, but wants specific, simple instructions rather than an open-ended research assignment. Preserve unknown values and label estimates. Do not infer real salaries, personality, potential, historical club officials or image-use rights from their absence.

## Known bugs, risks and unfinished systems

- **Test-runner contention:** a four-worker handover run passed 1,869 cases, but the youth-competition storage suite's explicit 60-second `beforeAll` timed out before its 41 cases ran. The isolated recheck passed all 41. This is a reproducible risk under parallel load; use the serial verification command below. Do not weaken assertions or mistake fixture setup timeouts for an application behavior failure. Earlier runs also reported occasional worker shutdown delays.
- **Large saves are slow:** strict historical validation/loading remains costly. The board six-season diagnostic produced a roughly 6.5 MB year-seven save; parsing measured 8.157 seconds wall / 2.640 seconds CPU in that run. An earlier 21 MB career took about 15 seconds wall / 9.1 seconds CPU. These are environment-specific observations, not performance targets. Career exports/imports have a 32 MiB ceiling; long-running journals also have bounds, so “unlimited seasons” is still a product goal rather than unlimited storage.
- **Bundle size:** the production main chunk is about 606.76 kB minified / 173.99 kB gzip and triggers Vite's 500 kB advisory. Build succeeds. Watched and instantly skipped managed matches still run on the main thread; committed world transitions use the worker.
- **Board model limits:** confidence decides facility capital requests (7.2) and nothing else yet; exact squad-strength ties share the best rank and can create collectively aspirational targets. Presidents have only a generosity trait and seasonal owner capital; development/culture objectives and employment consequences are absent.
- **Match rules and calibration are incomplete:** technical/unsportsmanlike/disqualifying fouls and combined penalties, several timing/violation/adjudication rules, full movement/screens/help/zone behavior and competition-specific coverage remain open. See [rules-coverage.md](docs/design/rules-coverage.md). PIR omits fouls drawn and blocks against because those statistics are not retained.
- **Management/release gaps:** no integrated real leagues/database, complete economy, agents/loans, regional scouting, rich personalities/chemistry, full youth coaching or complete career/job model. Named career slots and exclusive multi-tab writer leases are not implemented. Five local checkpoints share one season slot across careers; export files to retain separate careers. Browser storage is local to its origin/browser.
- There is no confirmed unresolved board correctness defect from the completed policy, storage, integration, browser and multi-season checks. Passing consistency checks do not establish realistic economic, sporting or psychological calibration.

## Key decisions and conventions

### Game interface

Follow [AGENTS.md](AGENTS.md) and [game design section 11](docs/game-design.md#11-interface-structure). The user repeatedly rejected website/landing-page and corporate-software layouts.

- Use charcoal/slate surfaces, amber accent, compact navigation, portraits/icons, readable tables, condition bars and direct actions. Put detailed explanations/accounting in disclosures. Display only actual implemented game state and working actions.
- Keep the large court directly below the score. Coaching follows the players/court. No budgets on Match, standalone shot-clock/possession panel, duplicate named-player picker or removed match-analysis/settings disclosure.
- Keep drag, tap/click and keyboard substitutions on the same legal queue; pause and settle playback before edits. Team instructions use labeled sliders and the authoritative same values across screens.
- Preserve the exact budget labels **Remaining budget**, **Remaining staff budget**, **Player salary budget**. Cash and the separate season allocations are not one shared pool. Club budget/finance links open Operations even when Board was the last selected view.
- Own-player skills can be exact; outsider ability must remain unknown or within legitimate scouting/report ranges. Shortlisting alone does not start an observation.
- Preserve visible keyboard focus, semantic labels, contrast, reduced motion and desktop/tablet behavior. Never invent fixtures, money, messages, board reactions or unavailable navigation to fill the screen.

### Domain, simulation and saving

- TypeScript/React/Vite; no account or backend is required. `src/App.tsx` orchestrates UI and authoritative commands; domain logic belongs in `src/world/`, `src/engine/` and typed `src/domain/` modules.
- Use read-only selectors/quotes and immutable commands. `*-policy.ts` modules share guards with manual and AI/delegated actions. Human and AI must obey the same rules and budgets.
- Use seeded simulation randomness. Reading UI/advice, rendering or sorting must not consume RNG or change match results. Presentation follows the displayed playback snapshot, not a later simulated boundary.
- Money is integer euro cents. Simulated dates are ISO calendar dates with UTC arithmetic. Retain original registration snapshots, fixture statistics, contracts and ledger receipts; never reconstruct old events from today's roster.
- `createSeason` accepts named options; add new systems to `SeasonSystems` and `NEW_CAREER_SYSTEMS` (sponsorship was the first, then board funding and board verdicts). The frozen positional form (23 arguments, board last) remains for existing callers and cannot enable newer systems.
- `src/world/season.ts` owns atomic calendar transitions. `src/world/season.worker.ts` computes a world transition in isolation; UI installs it once or discards a cancelled job.
- **Season schema/envelope: 33 (`SEASON_SCHEMA_VERSION`). Standalone match envelope: 2.** New simulation uses `possession-3`; saved `rules-2` matches keep their original engine. Season formats 1-32 migrate while preserving their earlier enabled systems, active match and continuation; new optional systems generally opt in prospectively.
- Before a schema/runtime change, capture **genuine current-format fixtures and independent continuations before editing the implementation** (`npm.cmd run fixtures:capture` on unchanged code). Then bump `SEASON_SCHEMA_VERSION`, extend the `SeasonFormatVersion` union, add the new system to both migration paths in `parseSeason`, add one row to `ADDED_BY_FORMAT` in `tests/helpers/season-format.ts` and a strip step in `tests/helpers/legacy-season.ts`, and add migration and corruption-rejection tests. Do not fabricate an “old” fixture just by changing a version number.
- `src/storage/season-storage.ts` and subsystem validators rebuild historical evidence. `career-saves.ts`, `season-journal.ts` and `season-indexed-db.ts` handle local checkpoints and stale-write protection. Keep record ordering, command guards and UI figures consistent.
- Squad Dynamics freezes morale for all clubs before matches and before new-day AI conversations. Board reviews are separate and have no engine modifier. Do not conflate board confidence with player morale.
- Match the surrounding file's style; some domain/test files use semicolons and UI files omit them. Avoid unrelated mass formatting. Keep UTF-8 text intact in PowerShell.

## Run and test

Requires **Node.js 24.14 or newer**. Use the committed lockfile. In PowerShell, `npm.cmd` avoids execution-policy errors from `npm.ps1`. Run tests from PowerShell: invoking vitest from Git Bash fails every file at load because vitest is loaded twice through `/c/...` and `C:/...` path spellings.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the URL Vite prints. On Windows, double-click **Start game.cmd** for the user-facing launcher; it installs missing locked dependencies and opens the browser. Keep its window open. `npm.cmd ci` is only needed when dependencies are absent or the lockfile changes.

```powershell
# Complete regression, one worker to avoid fixture-setup contention
npm.cmd test -- --maxWorkers=1 --testTimeout=120000

# Includes TypeScript checking, then builds dist/
npm.cmd run build

# Optional focused checks / preview
npm.cmd run typecheck
npm.cmd test -- tests/board.test.ts tests/board-integration.test.ts tests/board-storage.test.js --maxWorkers=1 --testTimeout=120000
npm.cmd run preview
npm.cmd run benchmark:match
```

The earlier full four-worker run passed 1,910 cases across 98 files; serial execution is preferable on this workspace because some suites have explicit fixture-setup limits. A local focused failure should be investigated; do not raise timeouts blindly or suppress failed assertions.

For reference data, use **Open real data.cmd** or `npm.cmd run data:fetch`. Generated data lives under `.local-data/europe-2025-26/`, separate from the game build.

## Verification at handover

Re-verified before Level 7 began, on unchanged source `acc5c27`: typecheck and build passed (known chunk advisory) and the serial suite passed 1,910 tests across 98 files in 895.6 seconds.

Fresh verification on 12 November 2026, using unchanged application source from `2b3fad5`:

- `npm.cmd run build`: **passed**, including TypeScript checking. The known main-chunk size advisory remains.
- `npm.cmd test -- --maxWorkers=1 --testTimeout=120000`: **1,910 tests passed across 98 files**, no failed or skipped cases; 620.33 seconds in this environment.
- The earlier four-worker attempt hit only the youth-storage fixture-setup timeout described above. Its isolated 41-case recheck also passed. No test assertions or product code were changed to obtain the serial pass.
- `git diff --check`: passed. README cleanup and this handover are documentation-only changes after application verification.
- No test-owned development/preview/browser helpers are left running. No new feature work is pending from this session.

The completed board feature also passed 11 production-browser workflow groups at 1440/768/390 px, including new career, keyboard legacy activation, actual Continue worker/autosave, budget navigation, evidence/history, final review/rollover, finance-disabled and late-activation states, exact reload, and real concern/injury cases. The final singular/plural correction passed a focused production smoke.

Its six-season standard-injury diagnostic completed 60 reviews and retained seven mandates through the next opening, with bounded confidence and exact imported continuation/reload. It did not naturally produce arrears or paid transfers; focused tests cover arrears/payment-prefix reconstruction and integration tests cover a real paid signing.

Local evidence, if this workspace is retained: `.artifacts/handover-build.txt`, `.artifacts/handover-tests.txt`, `.artifacts/handover-tests-recheck.txt`, `.artifacts/handover-tests-serial.txt`, `.artifacts/board-production-ui-report.json`, `.artifacts/board-production-ui-context-report.json`, `.artifacts/board-population-report.json`.

**Portability:** `.artifacts/`, `.local-data/`, `node_modules/`, `dist/`, coverage and environment files are intentionally ignored. Diagnostic scripts/reports/screenshots and downloaded reference data are not guaranteed in a fresh checkout. Committed `tests/` and `tests/fixtures/` are the portable regression evidence; fixture provenance is documented in [tests/fixtures/README.md](tests/fixtures/README.md). No ignored caches, generated bundles, large diagnostic saves or credentials should be force-added for handover.

No deployment or Git push is part of this handover. This session stops after documentation and local commits; no further implementation is included in this handover.
