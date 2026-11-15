# Working agreement

The project owner set these instructions for any agent continuing this project:

> This project was started by another agent. Continue it and take it through the next levels defined in the project plan.
>
> 1. Read CLAUDE.md, AGENTS.md, HANDOVER.md and the plan and design docs, then review the codebase.
> 2. Before writing any code, report back on:
>    - Which levels of the plan are complete, which is in progress and what remains
>    - Anything in the existing code that doesn't match the plan or design, or would block the next level (bugs, missing tests, shortcuts)
>    - Anything in the plan that is unclear or contradictory
> 3. Break the next level into steps, in the order the plan sets. Fixes needed to build it properly come first. Do not add features or change the design beyond the plan. If you think something is missing, list it separately as a suggestion.
>
> Wait for my approval. Then work one step at a time: implement, add or update tests, run them, commit and update HANDOVER.md. At the end of each level, stop and summarize before starting the next.

"Levels" are the milestones in [docs/implementation-plan.md](docs/implementation-plan.md). Interface rules live in [AGENTS.md](AGENTS.md); the current state, active level and next step live in [HANDOVER.md](HANDOVER.md).

Since Level 7 was accepted, the levels are the owner's sprints, listed in order in [HANDOVER.md](HANDOVER.md); sprint 3, the multi-league world, is active.

The working agreement above and the rules below up to "Where to read" are for local sessions on the owner's Windows machine. Cloud sessions follow [Cloud sessions](#cloud-sessions) instead where the two differ.

Work directly on `main`; do not create branches. Do not commit or push: leave each finished step as uncommitted changes on `main`, tell the owner it is ready and suggest a commit message; the owner commits and pushes (owner's instructions, 12 November 2026).

Communicate progress and any request for help in plain, non-technical language with step-by-step guidance. Keep real-data costs low: prefer free sources and ask before any paid option.

## Running checks on Windows

Use PowerShell with `npm.cmd`:

```powershell
npm.cmd test -- --maxWorkers=1 --testTimeout=120000
npm.cmd run build
```

Running vitest from Git Bash fails every test file before any test runs, because vitest is loaded twice through different path spellings (`/c/...` and `C:/...`). That is an environment quirk, not a code failure.

## Running checks on Linux (cloud sessions)

Node 24.14 or newer is needed; if the default is older, prefix each node and npm command with `PATH=/opt/node24/bin:$PATH`.

```bash
PATH=/opt/node24/bin:$PATH npm ci
PATH=/opt/node24/bin:$PATH npm run build                                            # every push
PATH=/opt/node24/bin:$PATH npm test -- tests/<changed>.test.ts --maxWorkers=4         # focused tests of what changed
PATH=/opt/node24/bin:$PATH npm run test:quick -- --maxWorkers=4                     # only when saves, calendar or match engine changed (about 2.5 minutes)
PATH=/opt/node24/bin:$PATH npm test -- --maxWorkers=4 > full-suite.log 2>&1           # full suite: end of sprint and before release only (about 5 minutes)
```

## Where to read

Read only what the current step needs. To read one section of a long file, list its headings with `grep -n "^## " <file>` and print that range with `sed -n '<start>,<end>p' <file>`.

| Question | Where |
| --- | --- |
| What is the current step, what comes next, which rules must hold, what is local-only? | [HANDOVER.md](HANDOVER.md), all of it (it is kept short) |
| How must screens look and behave? | [AGENTS.md](AGENTS.md), all of it |
| What does a sprint-3 step require? | [docs/multi-league-world.md](docs/multi-league-world.md): "Levels of detail in this game", "Competition formats", "One calendar", "Steps" and the section of the step in hand. Skip the step 3.1 and 3.2 history |
| Which official format, ranking or registration rule applies to a league, and what is still unverified? | [docs/competition-rules-2026.md](docs/competition-rules-2026.md) |
| Why was a rule or default chosen? Which reversible defaults exist? | [docs/decisions.md](docs/decisions.md): only the section on the topic |
| What are the milestones and their status? | [docs/implementation-plan.md](docs/implementation-plan.md): the status table at the top only |
| What is the intended design of an area? | [docs/game-design.md](docs/game-design.md): the numbered section for that area (for example 9 for competitions, 11 for the interface) |
| Which module owns what? | [docs/architecture.md](docs/architecture.md): section 2 or the numbered section for the subsystem; never in full |
| How was an earlier feature built and verified? | [docs/implementation-status.md](docs/implementation-status.md) or [docs/handover-history.md](docs/handover-history.md): search for the feature, step or format number and read that entry only; never in full |
| Where did a save fixture come from? | [tests/fixtures/README.md](tests/fixtures/README.md): the paragraph for that format |
| How does the real-data pipeline work? (local-only) | [docs/real-data-pilot.md](docs/real-data-pilot.md) "How it works" and [docs/player-data-quality.md](docs/player-data-quality.md) |

## Cloud sessions

These rules apply in a Claude Code cloud session (a temporary Linux machine) and replace the local rules about approval and commits.

- **Start:** git pull; read CLAUDE.md, AGENTS.md and HANDOVER.md, other docs only where the step needs them; npm ci.
- **Work:** directly on main, no branches or pull requests. Take the next step from HANDOVER.md in plan order; never start a new level without my approval. Ideas go under "Suggestions for the owner".
- **Development mode (15 November 2026):** build features first, test later; parallel agents allowed for independent features. Before each push: `npm run build` plus focused tests of what changed (the quick tier only for saves, calendar or match engine). The full suite runs at the end of each sprint and before release. Group work into few, larger pushes. Details in HANDOVER.md, "Development mode until release".
- **Limits:** never call API-Sports or Supabase unless I ask for it in the session; never spend money; never write secret values into any file (this repository is public).
- **Finish:** every push to main goes live on Vercel, so push only when the build and the focused tests pass. Update HANDOVER.md briefly, commit code and notes together with a clear message, push to main. List browser checks you could not run under "Owner checks".
- **Stopping early:** anything not pushed is lost. Push working partial code as "wip: <step> partial" with a note; if it does not build, push only the HANDOVER.md note.
