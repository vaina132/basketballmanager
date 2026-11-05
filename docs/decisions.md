# Decision record

Updated: 5 November 2026. This records the user's answers, not inferred approval of every proposed formula.

## Confirmed in discovery

| ID | Decision | Source |
| --- | --- | --- |
| D01 | Several domestic leagues plus European competitions in first release | Round 1 |
| D02 | Latest completed verifiable season, opening-day world that diverges through simulation | Round 1 |
| D03 | Diagonal 2.5D viewer with stylized recognizable players | Round 1 |
| D04 | Chosen-club career, unlimited seasons, optional dismissal and job changes | Round 1 |
| D05 | Single-player local saves with import/export; no account | Round 1 |
| D06 | Full managerial control within board budgets | Round 1 |
| D07 | Men's basketball: Turkey, Spain, Greece, Germany, Italy, France | Round 2 |
| D08 | EuroLeague, EuroCup, Basketball Champions League | Round 2 |
| D09 | Fully playable top two divisions in all six countries | Round 2 |
| D10 | Exact own-squad skill ratings; outsiders use scouting ranges; personality/potential described | Round 2 |
| D11 | Verified identities/rosters, labeled missing-value estimates, usable photos with illustrated fallbacks | Round 2 |
| D12 | English, desktop/laptop priority, tablet support | Round 2 |

## Confirmed in discovery round three

| ID | Topic | Confirmed answer |
| --- | --- | --- |
| D13 | Youth development | Academy prospect roster, simplified youth fixtures, development, senior promotion; add youth team coach and youth infrastructure |
| D14 | Facilities/business | Direct facility spending, ticket prices, sponsorship and arena projects, with optional automatic management; arena/stadium, training and youth facilities included |
| D15 | Media/conversations | Meaningful events; routine media delegated |
| D16 | Match decisions | Free pause, critical-event auto-pause, changes applied at legal boundaries |
| D17 | Injury settings | Realistic default, reduced-injury option applied equally to clubs |
| D18 | Visual direction | Restrained dark interface, clear tables, portraits, one accent |

## Subsequent clarification

| ID | Topic | Confirmed preference |
| --- | --- | --- |
| D19 | Real data acquisition | User is willing to pay for high-quality player/club data if justified; free is acceptable. Provide concrete instructions at the relevant milestone. No spending limit or purchase authorization has been supplied. See [acquisition plan](data-acquisition.md). |

## Engineering defaults proposed by the design

These can be resolved through implementation evidence without another general permission round. Escalate only material changes to agreed behavior.

- Versioned, deterministic match/world engines; seeded randomness and saved random state.
- One sporting engine for every playback mode; club AI subject to the same constraints.
- React and TypeScript management interface; Vite build; PixiJS court renderer; worker-based simulation; IndexedDB storage.
- Explicit source/schema/calibration/rules versions; immutable starting data packs.
- Keep all agreed competitions in first-release acceptance; use smaller synthetic fixtures during engineering.
- EUR as the comparable reporting currency, annual gross salary view and monthly payroll by default; preserve native currency and source conventions in data. Label simplified tax/exchange assumptions.
- Historical knowledge uses information available by the career start where obtainable. Full-season results may calibrate aggregate behavior but do not reveal future individual events to the manager. Estimated ratings must disclose their evidence window.
- A truthful common start date follows the actual roster snapshot; do not label end-of-season membership as opening-day membership.
- Third divisions and countries outside the six selected ones can use background representations, sufficient for recruitment, scheduling load, and competition entry.
- Manual saves and reloads are available. No forced irreversible mode is needed for the first release.
- One youth team coach slot is proposed; the role was explicitly requested but its maximum was not specified.
- No deployment, remote repository operation, or new external account is needed for this design phase.

## Evidence still required

1. Which season pack can meet field-level roster and rules coverage across all fifteen competitions?
2. What are the actual formats, registration constraints, qualification rules, and calendars for that pack?
3. Which portrait/data bundles have a documented basis for the intended distribution?
4. Which parameters can be fitted to reliable statistics, and which remain transparent game assumptions?
5. What performance targets are sustainable with the full player and fixture population on a representative laptop/tablet?

These are research and validation tasks. They should not be turned into questions asking the user to supply facts that can be investigated.
