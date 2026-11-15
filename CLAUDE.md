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

The project needs Node 24.14 or newer. If `node --version` shows an older default, put `/opt/node24/bin` first in `PATH` for every node and npm command (shell state may not carry over between commands, so prefix each one):

```bash
PATH=/opt/node24/bin:$PATH npm ci
PATH=/opt/node24/bin:$PATH npm test -- tests/postseason.test.ts --maxWorkers=1 --testTimeout=120000   # focused tests
PATH=/opt/node24/bin:$PATH npm test -- --maxWorkers=1 --testTimeout=120000 > full-suite.log 2>&1        # full suite, about 10 minutes: run it in the background
PATH=/opt/node24/bin:$PATH npm run build
git diff --check
```

The full suite passes when the end of `full-suite.log` shows every test file and every test passed. Delete the log before committing. Long tests set their own time limits; never raise limits or weaken assertions to make a run pass.

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

These rules apply when you run in a Claude Code cloud session (a temporary Linux machine). They replace the local rules about approval and commits.

### Start
- Run git pull. Read CLAUDE.md, AGENTS.md and HANDOVER.md. Read other docs only in the sections the current step needs. Never read docs/implementation-status.md, docs/architecture.md or docs/handover-history.md in full.
- Check node --version. The project needs Node 24.14 or newer. If the default is older, put /opt/node24/bin first in PATH for every node and npm command.
- Run npm ci.

### Work
- Work directly on main. Never create branches or pull requests.
- Take the next step from HANDOVER.md in plan order. The plan order is my approval for the next step inside the current level. Never start a new level: stop and write a level summary in HANDOVER.md instead.
- Do not add features or change the design beyond the plan. Put ideas under "Suggestions for the owner" in HANDOVER.md.
- Never call API-Sports or Supabase. Never spend money. Tasks that need my private data pack, keys or Edge are local-only: list them in HANDOVER.md and continue with the next step that does not need them.
- Never write secret values into any file. This repository is public.

### Finish a step
- Add or update tests. Run the focused tests, then the full suite (npm test -- --maxWorkers=1 --testTimeout=120000, about 10 minutes, run it in the background) plus npm run build.
- Every push to main goes live on Vercel. Push only when the full suite and the build pass.
- Update HANDOVER.md, then commit code and notes together with a clear message (for example "feat: LNB playoff fixtures (step 3.4b)") and push to main.
- List any browser checks you could not run under "Owner checks" in HANDOVER.md.

### If you have to stop early
- Anything not pushed is lost when the session ends.
- If tests and build pass, commit and push the partial work as "wip: <step> partial" with notes in HANDOVER.md about what is done and what is left.
- If they do not pass, do not push code. Push only the HANDOVER.md notes.
