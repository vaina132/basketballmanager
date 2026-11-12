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

Work directly on `main`; do not create branches. Do not commit or push: leave each finished step as uncommitted changes on `main`, tell the owner it is ready and suggest a commit message; the owner commits and pushes (owner's instructions, 12 November 2026).

Communicate progress and any request for help in plain, non-technical language with step-by-step guidance. Keep real-data costs low: prefer free sources and ask before any paid option.

## Running checks on Windows

Use PowerShell with `npm.cmd`:

```powershell
npm.cmd test -- --maxWorkers=1 --testTimeout=120000
npm.cmd run build
```

Running vitest from Git Bash fails every test file before any test runs, because vitest is loaded twice through different path spellings (`/c/...` and `C:/...`). That is an environment quirk, not a code failure.
