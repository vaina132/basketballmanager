# Project handover

Prepared 12 November 2026. Repository: `basketballmanager`; branch: `main`.

## Current state and stopping point

The current feature is complete: **Club > Board expectations and confidence**. It is already committed in `2b3fad5` (`ew123b`). No application implementation is in progress, and no new feature was started during handover preparation. The handover cleanup only corrects stale README descriptions of aging, facility effects and the season save format; it is committed in `dff4479`.

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
- **Board model limits:** confidence is descriptive; exact squad-strength ties share the best rank and can create collectively aspirational targets. Broader president traits, development/culture objectives and economic/employment consequences are absent.
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
- `createSeason` still uses positional feature flags; board is currently the 23rd argument. Preserve existing argument order/defaults when extending it, and update the new-career call and migration fixtures deliberately.
- `src/world/season.ts` owns atomic calendar transitions. `src/world/season.worker.ts` computes a world transition in isolation; UI installs it once or discards a cancelled job.
- **Season schema/envelope: 30. Standalone match envelope: 2.** New simulation uses `possession-3`; saved `rules-2` matches keep their original engine. Season formats 1-29 migrate while preserving their earlier enabled systems, active match and continuation; new optional systems generally opt in prospectively.
- Before a schema/runtime change, capture **genuine current-format fixtures and independent continuations before editing the implementation**. Add migration and corruption-rejection tests, update strict allowed keys, schema/envelope versions and legacy helper stripping consistently. Do not fabricate an “old” fixture just by changing a version number.
- `src/storage/season-storage.ts` and subsystem validators rebuild historical evidence. `career-saves.ts`, `season-journal.ts` and `season-indexed-db.ts` handle local checkpoints and stale-write protection. Keep record ordering, command guards and UI figures consistent.
- Squad Dynamics freezes morale for all clubs before matches and before new-day AI conversations. Board reviews are separate and have no engine modifier. Do not conflate board confidence with player morale.
- Match the surrounding file's style; some domain/test files use semicolons and UI files omit them. Avoid unrelated mass formatting. Keep UTF-8 text intact in PowerShell.

## Run and test

Requires **Node.js 24.14 or newer**. Use the committed lockfile. In PowerShell, `npm.cmd` avoids execution-policy errors from `npm.ps1`.

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
