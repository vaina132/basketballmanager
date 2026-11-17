import { asCareer1 } from './career-rules';
import { financeAtLedgerBoundary, financeLedgerCount } from '../../src/world/finance-ledger';
import type { SeasonState } from '../../src/domain/season';

/** Recreate the actual pre-roster schema, including the archive data those versions discarded. */
export function stripRosterHistory(state: Record<string, unknown>): void {
  stripScouts(state);
  delete state.recruitment;
  delete state.market;
  delete state.negotiations;
  delete state.scouting;
  delete state.employment;
  delete state.rosters;
  for (const fixture of state.fixtures as Array<{ result: Record<string, unknown> | null }>) if (fixture.result) delete fixture.result.rosterIds;
  for (const archive of (state.history ?? []) as Array<{ rosters?: unknown; summary?: unknown; fixtures: Array<{ result: Record<string, unknown> }> }>) {
    delete archive.rosters;
    delete archive.summary;
    for (const fixture of archive.fixtures) { delete fixture.result.rosterIds; delete fixture.result.stats; delete fixture.result.appearances; }
  }
  const training = state.training as { lastWeek: Record<string, unknown> | null } | undefined;
  if (training?.lastWeek) delete training.lastWeek.rosterIds;
}

/** Pre-18 files cannot retain commands or registration fields introduced by this release. */
export function stripInSeasonRecruitment(value: object): void {
  const state = value as Record<string, unknown>;
  stripInSeasonTransfers(value);
  delete state.recruitment;
  const employment = state.employment as { contracts?: Array<Record<string, unknown>> } | undefined;
  for (const contract of employment?.contracts ?? []) delete contract.startsRound;
}

/** Format18 retains free-agent recruitment but has no current-season club transfers. */
export function stripInSeasonTransfers(value: object): void {
  stripScouts(value);
  const state = value as Record<string, unknown>;
  const employment = state.employment as { transfers?: Array<Record<string, unknown>> } | undefined;
  for (const transfer of employment?.transfers ?? []) delete transfer.startsRound;
  const recruitment = state.recruitment as { transfersEnabledSince?: unknown; offers: Array<Record<string, unknown>> } | undefined;
  if (recruitment) {
    delete recruitment.transfersEnabledSince;
    for (const offer of recruitment.offers) { delete offer.seasons; delete offer.transfer; }
  }
}

/** Existing legacy fixtures have scout recruitment disabled and no scout payments. */
export function stripScouts(value: object): void {
  stripFitness(value);
  const state = value as Record<string, unknown>;
  delete state.scouts;
}

/** Format21 has no fitness staff; legacy fixtures create no fitness appointments. */
export function stripFitness(value: object): void {
  stripPhysio(value);
  delete (value as Record<string, unknown>).fitness;
}

/** Format22 predates physio appointments and rehabilitation. */
export function stripPhysio(value: object): void {
  stripAssistant(value);
  delete (value as Record<string, unknown>).physio;
}

/** Format23 predates paid assistant appointments. */
export function stripAssistant(value: object): void {
  stripAcademy(value);
  delete (value as Record<string, unknown>).assistant;
}

/** Format24 predates academy prospects and paid youth coaches. */
export function stripAcademy(value: object): void {
  stripLifecycle(value);
  delete (value as Record<string, unknown>).academy;
  delete (value as Record<string, unknown>).youth;
}

/** Careers saved before format 65 keep the `facilities-1` model: three facilities and no repairs (nor loans and leases). */
export function withLegacyFacilities(state: SeasonState): SeasonState {
  return withoutFacilityFinancing({ ...state, facilities: { ...state.facilities, model: 'facilities-1' } });
}

/** Careers saved before format 71 pay for facility projects upfront: no `financing` and no `debts` (an untouched career has none). */
export function withoutFacilityFinancing(state: SeasonState): SeasonState {
  const { financing: _financing, debts: _debts, ...facilities } = state.facilities;
  return { ...state, facilities };
}

/** Past player statistics cannot be recovered from an old-format archive. */
export function withUnavailableArchivedStats(state: SeasonState): SeasonState {
  const result = structuredClone(state);
  for (const archive of result.history) {
    delete archive.summary;
    for (const fixture of archive.fixtures) { fixture.result.stats = null; delete fixture.result.appearances; }
  }
  return result;
}

/** Format25 predates dated senior aging and retirement reviews. */
export function stripLifecycle(value: object): void {
  stripYouthCompetition(value);
  delete (value as Record<string, unknown>).lifecycle;
}

/** Format26 predates youth competition and its additional academy intake records. */
export function stripYouthCompetition(value: object): void {
  stripFacilities(value);
  delete (value as Record<string, unknown>).youthCompetition;
}

/** Format27 predates club facility approvals, construction and upkeep. */
export function stripFacilities(value: object): void {
  stripRelationships(value);
  delete (value as Record<string, unknown>).facilities;
}

/** Format28 predates player relationships and frozen match morale. */
export function stripRelationships(value: object): void {
  stripBoard(value);
  delete (value as Record<string, unknown>).relationships;
}

/** Format29 predates board mandates and dated confidence reviews. */
export function stripBoard(value: object): void {
  stripCommercial(value);
  delete (value as Record<string, unknown>).board;
}

/** Format30 predates negotiated sponsorship agreements. */
export function stripCommercial(value: object): void {
  stripBoardFunding(value);
  delete (value as Record<string, unknown>).commercial;
}

/** Format34 predates rivalries. */
export function stripRivalries(value: object): void {
  stripFacilityMaintenance(value);
  delete (value as Record<string, unknown>).rivalries;
}

/** Format35 predates upkeep plans and facility condition. */
export function stripFacilityMaintenance(value: object): void {
  stripCareer(value);
  const facilities = (value as { facilities?: Record<string, unknown> }).facilities;
  if (facilities) delete facilities.maintenanceSince;
}

/** Format36 predates dismissal and job changes. */
export function stripCareer(value: object): void {
  delete (value as Record<string, unknown>).career;
  // These rule-replay fixtures predate archive blocks; retain their complete original transaction layout.
  const state = value as Partial<SeasonState>;
  if (state.finance?.archives) state.finance = financeAtLedgerBoundary(state.finance, financeLedgerCount(state.finance));
}

/** Format31 predates board funding requests. */
export function stripBoardFunding(value: object): void {
  stripBoardConsequences(value);
  const facilities = (value as { facilities?: Record<string, unknown> }).facilities;
  if (facilities) delete facilities.fundingSince;
}

/** Format32 predates board verdicts that set later budgets. */
export function stripBoardConsequences(value: object): void {
  stripRivalries(value);
  const board = (value as { board?: Record<string, unknown> }).board;
  if (board) delete board.consequencesSince;
}

/** Format 52 and earlier have no record of clubs outside the full world and no lower-division lists. */
export function stripBackground(value: object): void {
  const state = value as Record<string, unknown>;
  delete state.background;
  if (state.world && typeof state.world === 'object') delete (state.world as Record<string, unknown>).lowerDivisions;
}

/** createSeason options for a new career as created before the saved ideas level (formats 63-71). */
/** Also without the opening staff of format 74 (`coaching-2`), which only newer formats accept. */
export const BEFORE_SAVED_IDEAS = { media: false, namingRights: false, presidents: false, simpleFacilities: false, staffing: false } as const;

/**
 * An untouched new career on the rules saved before the saved ideas level: Level 7 career rules (`career-1`), the
 * three original facilities (`facilities-1`) paid upfront (no loans or leases), the original squad dynamics
 * (`relationships-1`) and, in real-data worlds, the world's opening club money in every season (no format-72
 * `economySeasons`; season one is identical either way). Create it with `BEFORE_SAVED_IDEAS`; grown rivalries are
 * converted after play with `withFixedRivalries`.
 */
export function beforeSavedIdeas(state: SeasonState): SeasonState {
  return withLegacyYouthCompetition(withOpeningMoney(withLegacyRelationships(withLegacyFacilities(asCareer1(state)))));
}

/** Youth injuries that never recur (`youth-competition-1`), as in every career created before youth recurrence (format 72). */
export function withLegacyYouthCompetition<T extends Pick<SeasonState, 'youthCompetition'>>(state: T): T {
  return state.youthCompetition.model === 'youth-competition-1' ? state : { ...state, youthCompetition: { ...state.youthCompetition, model: 'youth-competition-1' } };
}

/** Format 72: a career that keeps the world's opening club money, as every career created before format 72. */
export function withOpeningMoney<T extends Partial<Pick<SeasonState, 'economySeasons'>>>(state: T): T {
  const { economySeasons: _records, ...older } = state;
  return older as T;
}

/** An untouched new career's squad dynamics on the original rules (`relationships-1`, before format 66; new careers use `relationships-3`). */
export function withLegacyRelationships(state: SeasonState): SeasonState {
  if (state.relationships.model === 'relationships-1') return state;
  if (state.relationships.events.some(event => event.type !== 'prepare')) throw new Error('Convert only an untouched new career.');
  const { squadRanks: _ranks, ...relationships } = state.relationships;
  return { ...state, relationships: { ...relationships, model: 'relationships-1' } };
}
