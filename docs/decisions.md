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

## Development release-clause policy

New player agreements may include an optional release amount from EUR 1,000 to EUR 500,000, in EUR 1,000 steps. No clause is added to existing agreements. Within the fictional development league, agreeing a clause caps the three-season salary premium at 5%, rather than 10%; the one- and two-season requirements remain unchanged. The contract review shows the actual salary requirement. This uniform game rule is provisional and is not a statement of any country's employment law or a claim about a player's personal preferences.

A buyer explicitly chooses a clause approach and reserves its exact amount for full payment when the player accepts. A clause removes the selling club's fee decision; player choice, affordability, registration timing and squad protection still apply. Installments belong to negotiated transfers. A clause on one agreement cannot release a separate future agreement. Existing wages, earlier transfer debt and historical registrations retain their original treatment. Competition-specific clauses and the wider agent/bonus/loan model remain future work.

## Development scout staffing policy

Training coaches and scouts share the existing EUR 150,000 annual staff allocation. Scout contracts charge their full season fee immediately, retain the commitment after release and renew only when the new season's allocation and cash permit. The confirmed limit is three active scouts per club, equally applied to AI. Two baseline club observations remain available; each hired scout supplies one additional named observation per matchday. A person cannot observe two targets on the same matchday. Releasing a scout cancels their queued observation explicitly; completed club reports remain.

Scouts have fictional judging and reporting skills on a 1-10 scale. The overall half-star display summarizes those skills and is not another bonus. A successful club observation supplies 100 evidence points; a scout supplies 100 plus five times the sum of their two skills. Report depth is the whole number of accumulated hundreds, capped at three. No minutes supplies no evidence. Existing uncertain ranges, systematic bias and aging still apply, so even the best report does not expose an outsider's exact ratings. This is a provisional development coefficient, not a calibrated scouting accuracy claim.

Scout contracts and frozen observation attribution are retained for the career. New careers enable scout recruitment when finance and scouting are enabled. Older saves opt in prospectively; no report or pending baseline observation receives a retroactive benefit. AI aims for one affordable scout before hiring extra training coaches; existing coach renewals precede scout renewals at rollover. Regional travel, discovery coverage, potential and personality reports await their supporting world and player models.

## Development fitness coaching policy

Each club may appoint one fitness coach. The role shares the EUR 150,000 annual allocation with training coaches and scouts, charges the full season fee on appointment, and retains paid commitments after release. New hires require remaining cash after wages and transfer holds and settled arrears. Appointments are available on matchdays 1-9; matchday 10 has no remaining weekly training interval. The same rules apply to AI clubs.

On medically available days within a normal training week, the recovery skill adds `skill / 10` condition points per day, capped at one. The workload skill reduces the chosen plan's practice condition cost by `skill * 2.5%`, capped at 25%. Daily condition remains within 35-100. Injured days retain their original recovery, with no fitness bonus, no practice, and unchanged injury return dates. There is no offseason bonus or direct skill-rating multiplier. Improved condition can affect the existing readiness threshold for useful practice. These are provisional development coefficients, not medical claims or calibrated real-world staff effects.

The weekly report stores the applied appointment and compares the actual final condition with the same week, workload and availability without fitness coaching. It reports the actual capped difference, including zero for players who already finish fully rested. Hiring, release and renewal cannot rewrite a completed week. New careers opt in; older saves retain absent report fields and unchanged training until activation.

Rival clubs seek one fitness coach after scout coverage and before extra training coaches. On opening day, existing training coaches renew first, then scouts, then fitness coaches if the shared budget and cash permit. This order is deterministic and gives no club an additional budget.

## Evidence still required

1. Which season pack can meet field-level roster and rules coverage across all fifteen competitions?
2. What are the actual formats, registration constraints, qualification rules, and calendars for that pack?
3. Which portrait/data bundles have a documented basis for the intended distribution?
4. Which parameters can be fitted to reliable statistics, and which remain transparent game assumptions?
5. What performance targets are sustainable with the full player and fixture population on a representative laptop/tablet?

These are research and validation tasks. They should not be turned into questions asking the user to supply facts that can be investigated.
