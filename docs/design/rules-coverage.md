# Match rules: evidence and acceptance matrix

Research checked: 5 November 2026. This increment uses a **FIBA 2024 exhibition baseline**. It does not certify the rules of all fifteen planned competitions. Simulation probabilities, fatigue, injury incidence and coaching policies remain game models requiring calibration.

Implementation review: 6 November 2026. The legacy `rules-2` engine and new `possession-3` engine share the rules layer described below. The original rule scenarios remain pinned to `rules-2` to preserve the compatibility baseline. New possession scenarios additionally exercise clock and horn boundaries, period progression, foul-outs, mandatory replacements, legal coaching windows, accounting and mode equality. Nine earlier follow-up scenarios cover shooting-foul accounting, free-throw coaching windows and a queued timeout crossing 2:00. Court-scene and playback checks remain separate from sporting-rule coverage; the implementation status records combined verification. This increment does not add competition-specific rule overrides.

## Pinned sources

- **OBR24:** [FIBA Official Basketball Rules 2024, version 1.0a](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-v10a.pdf), effective 1 October 2024. Page numbers below are the document's printed page numbers.
- **OBRI24:** [FIBA Official Interpretations 2024, version 1.0a](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-obri-v10a.pdf), effective 1 October 2024. These provide the timing examples needed to distinguish a queued coaching request from a granted opportunity.
- **EL25:** [EuroLeague Bylaws 2025–26](https://ftpserver.euroleague.net/general/2025_26_EuroLeague_Bylaws.pdf), Article 23 and Appendix XI, pages 153 and 441–442.

FIBA's [current downloads](https://about.fiba.basketball/en/services/resource-hub/downloads) now list the 2026 edition, effective 1 October 2026. A current download URL must not silently change a historical 2025–26 simulation's rules. Competition configurations need their own edition, amendments and effective date.

## Core rulings used in this increment

The OBR24 references establish these implementation boundaries:

- Five personal fouls exclude a player (40.1). In-game default occurs below two available players (21.1), not merely below five. An award may retain the score or become 2–0 (21.2).
- Team penalty begins after four quarter fouls. Later nonshooting defensive personal fouls award two free throws; team-control fouls remain throw-ins. Fourth-quarter totals continue through overtime (41).
- Following rim contact, retained control resets to 14 seconds and changed control to 24. A defensive foul yields a backcourt 24 reset or a frontcourt minimum of 14 (29.2).
- Timeout and substitution opportunities differ after goals. The late-game substitution exception starts at 2:00 in quarter four and overtime (18–19).
- Timeout allowances are two in the first half, three in the second with at most two in the final two minutes, and one per overtime (18.2.5–6).
- The first-control loser receives the possession arrow; later period starts use it (12.6).

These are a compact summary, not a substitute for the referenced articles and interpretations.

## Acceptance matrix

The following scenarios are acceptance requirements. Focused checks live in [rules.test.ts](../../tests/rules.test.ts) and [rules-followup.test.ts](../../tests/rules-followup.test.ts), foundation checks in [match.test.ts](../../tests/match.test.ts), and persistence checks in [storage.test.ts](../../tests/storage.test.ts). “Partial” means the named checks establish a narrower implementation than the full article or scenario. It does not mean the remaining cases have passed.

| ID | Rule reference | Required scenario and engineering assertion | Verification status |
| --- | --- | --- | --- |
| R01 | OBR24 8.1, 8.7 | Regulation and repeated overtime finish at consistent boundaries in every playback mode. | Foundation tests: mode equality, quarter boundary, overtime and runaway guard |
| R02 | OBR24 29.1.1–2 | Compare clock expiry before release, a timely release, rim contact and an airball; no invalid scoring event survives. | Partial: expired-clock turnover and clock-aware urgency tested; release/flight and airball cases remain abstract |
| R03 | OBR24 29.2.2, 29.2.7 | Feed offensive rebound, defensive rebound and defensive-foul scenarios into the same clock reducer; both clocks stay nonnegative. | Focused tests: rim rebounds, non-rim block recovery, defensive-foul reset helper; full backcourt action model remains absent |
| R04 | OBR24 34.2.1–2, 41.2 | Compare fourth/fifth defensive team fouls, team-control fouls, successful shots with fouls and unsuccessful shooting fouls. | Focused tests cover fourth/fifth nonshooting awards, the team-control exception, made/missed two- and three-point shooting fouls, and-one awards, and no field-goal attempt for an unsuccessful fouled shot |
| R05 | OBR24 41.1.3 | Compare quarter transition with overtime transition; repeated overtime preserves the correct penalty state. | Focused quarter-reset and first-overtime carry tests; repeated carry uses the same reviewed branch |
| R06 | OBR24 4.1.2, 40.1 | A newly excluded player receives no later active exposure; re-entry is rejected and pending commands cannot restore eligibility. | Focused fifth-foul pause, replacement, no further exposure, rejected re-entry, assistant replacement and final-horn cleanup tests |
| R07 | OBR24 21.1–2 | Depleted roster fixtures distinguish continued play from default; awarded results remain separate from player scoring totals. | Focused two-player continuation and both default-award cases; persistence test retains separate player totals |
| R08 | OBR24 18.2.3–4, 19.2.2–3 | A command queued during play remains pending until the matching opportunity; a normal rebound opens neither a timeout nor substitution. | Focused live-ball queue/cancellation, whistle application and rebound-window checks |
| R09 | OBRI24 18/19-4 | Test scoring and non-scoring teams independently after a field goal, including the response to an opponent's permitted substitution. | Focused manual and automatic reciprocal late-basket substitution/timeout tests |
| R10 | OBR24 18.2.5–6; OBRI24 18/19-21–23 | Requests crossing 2:00 use the entitlement at grant time; halftime and each overtime do not inherit unused allowances. | Allowance tests plus a naturally generated request before 2:00 granted after 2:00; the first unused slot is lost and a third late timeout is rejected |
| R11 | OBRI24 18/19-1–2, 18/19-6 | A pre-tip request waits; first-free-throw and post-last-free-throw boundaries do not collapse into one generic dead ball. | Focused tests cover pre-tip queue, pre-first-throw timeout/non-shooter substitution, both teams queued between attempts, granting after the last made throw, and retaining requests during the live rebound after the last miss; shooter protection and horn penalties also covered |
| R12 | OBR24 19.2.4, 19.3.8, 43.2.1 | Test attempted immediate substitution reversal and mandatory replacement of a pending free-throw shooter. | Focused reversal lock, ordinary shooter protection and mandatory injured-shooter replacement tests |
| R13 | OBR24 12.6.2–6 | Alternate initial control winner; test period start, held ball, ordinary possession change and interrupted arrow administration. | Partial: period-arrow and held-ball retained-clock tests; throw-in interruption exceptions are not modeled |
| R14 | OBR24 5.2–8 | Injury stoppage and mandatory replacement preserve exposure, clock and pending penalties; reduced-injury mode changes both teams equally. | Partial: in-match removal, mandatory replacement, shared setting and saved generated injury tested; no treatment/return or rehabilitation model; incidence remains provisional |
| R15 | Engine consistency contract | Save and restore with unresolved free throws, queued commands and an eligibility interruption; replay consumes identical random state. | Persistence tests for live commands, unfinished free throws, required replacements and continued deterministic results |
| R16 | Engine consistency contract | Watched, quarter-skipped and instant runs stop at the same mandatory human decision with the same events and score. | Focused fifth-foul stop across all modes; injury uses the same required-replacement gate |

The simulation should resolve deterministic test scenarios through its normal state transition functions. Tests should not approve behavior merely because a helper returns the same value used by the implementation.

## Coaching timing details

The interpretation examples carry practical consequences for the command queue. A timeout may be available to the team conceding a field goal even when a substitution is unavailable. In OBRI24 18/19-4, a permitted late-game substitution by that team also allows its opponent to substitute, with timeout opportunities for both. OBRI24 18/19-6 distinguishes requests before the first free throw, between attempts, after the final successful attempt and after the throw-in becomes live. OBRI24 18/19-23 shows why a request timestamp cannot preserve a timeout entitlement that expires before the request is granted. These are separate state transitions, not UI timing effects. [Official interpretations, pages 41–46](https://assets.fiba.basketball/image/upload/documents-corporate-fiba-official-rules-2024-obri-v10a.pdf#page=41).

Pre-tip lineup editing is a setup action. Pausing the viewer is a presentation action. Neither should consume game time, timeout allowances, recovery exposure or randomness. This is the game's implementation contract; it is not an additional basketball rule.

## Competition differences already verified

EuroLeague 2025–26 expressly applies FIBA rules with Appendix XI amendments. Those amendments use jump balls for overtime starts and held-ball situations. The team gaining initial control starts the fourth quarter; the other team starts the second and third. Player technical fouls are excluded from team-foul totals. Media timeouts also have a defined competition procedure. Therefore a FIBA possession arrow and generic technical-foul treatment cannot be presented as EuroLeague compliance. [EL25, Appendix XI](https://ftpserver.euroleague.net/general/2025_26_EuroLeague_Bylaws.pdf#page=441).

EuroLeague's separate [2025–26 rules update](https://mediacentre.euroleague.net/en/app/2/communication/communication/preview/23532) also describes season-specific officiating and replay changes. Full EuroCup, BCL and domestic competition overrides remain an audit task. Acquiring EuroLeague statistics does not automatically select EuroLeague sporting rules for the fictional exhibition.

## Explicitly outside the verified subset

The current action representation uses integer elapsed seconds and resolves a shot and its outcome together. A successful boundary shot is treated as released before the horn; it is not a separately timed ball-flight simulation. Saved court trajectories animate that resolved event in presentation time and do not add a new release-time or collision ruling. Unblocked misses and missed free throws assume rim contact, while blocked-shot offensive recoveries retain the remaining shot clock. The possession-arrow throw-in administration is atomic. Injuries are detected at action boundaries, remove the player for the rest of the exhibition, and do not yet model treatment or return.

The assistant's condition and foul-trouble thresholds are provisional coaching policies, not derived basketball rules. The diagnostic [benchmark script](../../scripts/benchmark-match.mjs) records distributions and accounting checks; its optional official-source shooting-rate comparison does not validate those policies or the fictional roster's strength.

Until implemented and tested, the engine must not claim coverage for:

- Technical, unsportsmanlike, disqualifying and fighting penalties; simultaneous or offsetting penalties; coach and bench sanctions.
- Replay reviews, coach challenges, correctable errors, equipment faults and referee discretion.
- Lane violations, goaltending, interference, separately timed release/flight adjudication, footwork, eight-second backcourt progression, and three-/five-second violations.
- All throw-in locations and the late-game advance-to-frontcourt choice; possession-arrow interruption exceptions beyond implemented scenarios.
- Competition media timeouts, registration rules, pregame forfeits, disciplinary consequences and standings awards.
- Empirically calibrated injury risk, rehabilitation, tactics, fatigue, player strength or scoring distributions.

A disclosed omission is not a completed rules test. Each future engine version should update this matrix and [implementation status](../implementation-status.md) together, including any simplified event representation.
