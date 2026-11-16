import { financeLedgerCount } from './finance-ledger';
import type { CareerAnchor, CareerMove, CareerMovePhase, CareerMoveReason, SeasonCareer } from '../domain/career';
import type { BoardRestart } from '../domain/board';
import type { SeasonState } from '../domain/season';
import type { SeasonAcademy } from '../domain/academy';
import { applyFacilityEvent, facilityEventAnchor } from './facilities';
import { automateSponsorship, handOverCommercialControl } from './commercial';
import { roundOrdinal, seasonRounds, lastCommittedWeek } from './career-world';
import type { WorldContext } from '../domain/world';
import { CAREER_MODEL, CAREER_RULES, careerPointKey, usesCareerRules } from './career-rules';

/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);

export function createCareer(): SeasonCareer { return { model: 'career-1', enabledSince: null, moves: [] }; }

/**
 * The club the manager ran in `seasonNumber`: during the season itself (`offseason` false, through its final board
 * review) or during that season's offseason. A move at the end of a season hands its offseason to the new club.
 * Careers without moves, and older formats, always manage the current club.
 */
export function managedClubFor(state: Pick<SeasonState, 'managedClubId'> & { career?: SeasonCareer }, seasonNumber: number, offseason: boolean): string {
  // A mid-season move (format 63) hands the rest of that season to the new club, so it is not later than its end.
  const later = state.career?.moves.find(move => move.seasonNumber > seasonNumber || move.seasonNumber === seasonNumber && !offseason && move.phase !== 'season');
  return later ? later.fromClubId : state.managedClubId;
}

/**
 * The club whose games the manager ran in week `round` of `seasonNumber` (its pre-match boundary included). A
 * mid-season move before week X hands week X onwards to the new club; season-end and offseason moves leave the season.
 */
export function managedClubAtRound(state: Pick<SeasonState, 'managedClubId'> & { career?: SeasonCareer }, seasonNumber: number, round: number): string {
  const later = state.career?.moves.find(move => move.seasonNumber > seasonNumber || move.seasonNumber === seasonNumber && (move.phase !== 'season' || move.round! > round));
  return later ? later.fromClubId : state.managedClubId;
}

/** The club managed when the finance ledger held `ledgerCount` entries; commands at a move's own position follow it. */
export function managedClubAtLedger(state: Pick<SeasonState, 'managedClubId'> & { career?: SeasonCareer }, ledgerCount: number): string {
  return state.career?.moves.find(move => ledgerCount < move.ledgerCount)?.fromClubId ?? state.managedClubId;
}

/** The club whose fixture the current season's prepared or final match belongs to. */
export function matchClubFor(state: Pick<SeasonState, 'managedClubId' | 'seasonNumber'> & { career?: SeasonCareer }): string {
  return managedClubFor(state, state.seasonNumber, false);
}

/** Season ends from `effectiveFrom` onwards can bring dismissal or a job change. */
export function careerMovesGovern(career: SeasonCareer | undefined, seasonNumber: number): boolean {
  const anchor = career?.enabledSince;
  return !!anchor && seasonNumber >= anchor.effectiveFrom;
}

export function careerEventAnchor(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'date' | 'fixtures'> & WorldContext, mode: 'career' | 'prospective'): CareerAnchor {
  const completed = lastCommittedWeek(state);
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed, seasonRounds(state)), effectiveFrom: mode === 'career' ? 1 : state.seasonNumber + 1 };
}

/**
 * Format 37 recorded the switch before dismissal and offers existed. On migration, decisions start with the first
 * season end still to come, so a season that already ended is never judged afterwards.
 */
export function deferCareerDecisions(career: SeasonCareer, state: Pick<SeasonState, 'seasonNumber' | 'status'>): SeasonCareer {
  if (!career.enabledSince) return career;
  const next = (state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1) + 1;
  return career.enabledSince.effectiveFrom >= next ? career : { ...career, enabledSince: { ...career.enabledSince, effectiveFrom: next } };
}

/** New careers can change clubs from the end of their first season; older careers from the end of the next one. */
export function enableCareerMoves(state: SeasonState, mode: 'career' | 'prospective' = 'prospective'): SeasonState {
  if (state.career?.enabledSince) return state;
  if (!state.board?.enabledSince) throw new Error('Dismissal and job changes require board reviews.');
  if (mode === 'career' && (state.seasonNumber !== 1 || state.round !== 1 || state.fixtures.some(fixture => fixture.result))) throw new Error('Dismissal and job changes can cover the first season only at the start of a new career.');
  if (mode !== 'career') return { ...state, career: { ...createCareer(), enabledSince: careerEventAnchor(state, mode) } };
  // Format 63: a new career follows the career-2 rules, and the board starts the new coach from a fresh confidence.
  const restart: BoardRestart = { clubId: state.managedClubId, seasonNumber: 1, round: 1, phase: 'season', date: state.date, reviewCount: state.board.reviews.length, confidence: CAREER_RULES.freshConfidence, coach: 'manager' };
  return { ...state, career: { model: CAREER_MODEL, enabledSince: careerEventAnchor(state, mode), moves: [] }, board: { ...state.board, restarts: [...(state.board.restarts ?? []), restart] } };
}

/** A departing manager's individual academy instructions end: the former club's current prospects return to balanced work. */
export function releaseAcademyFocus(academy: SeasonAcademy, clubId: string): SeasonAcademy {
  // Graduates keep the focus they last trained with.
  const graduated = new Set(academy.graduates.map(graduate => graduate.prospectId));
  const current = new Set(academy.prospects.filter(prospect => prospect.clubId === clubId && !graduated.has(prospect.player.id)).map(prospect => prospect.player.id));
  return { ...academy, focus: Object.fromEntries(Object.entries(academy.focus).map(([id, focus]) => [id, current.has(id) ? 'balanced' : focus])) };
}

/** Why a move at the current season end is not possible, or null. Job offers and dismissal add their own rules. */
export function careerMoveRefusal(state: SeasonState, toClubId: string): string | null {
  if (!careerMovesGovern(state.career, state.seasonNumber)) return 'Job changes are not active in this season.';
  if (state.status !== 'complete' || state.round !== seasonRounds(state)) return 'Clubs change managers only when a season ends.';
  // Career-2 careers may already have moved during the season; one move per career point.
  if (usesCareerRules(state.career) ? movedAtPoint(state, 'end') : state.career.moves.some(move => move.seasonNumber === state.seasonNumber)) return 'You have already changed clubs this season.';
  if (toClubId === state.managedClubId) return 'You already manage this club.';
  if (!state.clubs.some(club => club.id === toClubId)) return 'Choose a club in this league.';
  return null;
}

/**
 * Hand the manager to another club at the end of a season, before its offseason opens. The former club continues
 * under automatic control in every area; the new club starts like a new career, with the manager in charge of the
 * areas a new career controls manually. Contracts, staff, players, results and history are unchanged.
 */
export function appointManager(state: SeasonState, toClubId: string, reason: CareerMoveReason): SeasonState {
  const refusal = careerMoveRefusal(state, toClubId);
  if (refusal) throw new Error(refusal);
  return transferManager(state, toClubId, reason, 'end');
}

/** The career point of a move made now: before this week's games, at the season end, or in its offseason. */
export function currentMovePhase(state: Pick<SeasonState, 'status'>, atSeasonEnd: boolean): CareerMovePhase {
  return state.status !== 'complete' ? 'season' : atSeasonEnd ? 'end' : 'offseason';
}

/** Whether a move already happened at this career point and date (at most one move per point). */
export function movedAtPoint(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'date'> & { career?: SeasonCareer }, phase: CareerMovePhase): boolean {
  const key = careerPointKey(state.seasonNumber, state.round, phase);
  return (state.career?.moves ?? []).some(move => move.round !== undefined && careerPointKey(move.seasonNumber, move.round, move.phase!) === key && move.date === state.date);
}

/** Restart a board's confidence for a new coach (format 63, career-2 careers). */
export function restartBoard(state: SeasonState, clubId: string, coach: BoardRestart['coach'], phase: CareerMovePhase): SeasonState {
  const restart: BoardRestart = { clubId, seasonNumber: state.seasonNumber, round: state.round, phase, date: state.date, reviewCount: state.board.reviews.length, confidence: CAREER_RULES.freshConfidence, coach };
  return { ...state, board: { ...state.board, restarts: [...(state.board.restarts ?? []), restart] } };
}

/**
 * Hand the manager to another club. Career-1 careers move only at a season end (`appointManager`); career-2 careers
 * also move before a week's games (a mid-season dismissal or a resignation) and in the offseason. The caller checks
 * the rules and offers, and prepares the new club's match when the week has one.
 */
export function transferManager(state: SeasonState, toClubId: string, reason: CareerMoveReason, phase: CareerMovePhase): SeasonState {
  if (toClubId === state.managedClubId || !state.clubs.some(club => club.id === toClubId)) throw new Error('Choose another club in this league.');
  if (phase !== 'end' && !usesCareerRules(state.career)) throw new Error('Clubs change managers only when a season ends.');
  const from = state.managedClubId;
  const move: CareerMove = { seasonNumber: state.seasonNumber, date: state.date, fromClubId: from, toClubId, reason, ledgerCount: financeLedgerCount(state.finance), ...(usesCareerRules(state.career) ? { round: state.round, phase } : {}) };
  let next: SeasonState = {
    ...state,
    managedClubId: toClubId,
    career: { ...state.career, moves: [...state.career.moves, move] },
    plans: { ...state.plans, [from]: { ...state.plans[from]!, autoSubstitutions: true, ...(Object.hasOwn(state.plans[from]!, 'matchday') ? { matchday: null } : {}) }, [toClubId]: { ...state.plans[toClubId]!, autoSubstitutions: state.plans[from]!.autoSubstitutions } },
    training: { ...state.training, plans: { ...state.training.plans, [from]: { ...state.training.plans[from]!, delegated: true } } },
    finance: { ...state.finance, plans: { ...state.finance.plans, [from]: { ...state.finance.plans[from]!, delegated: true }, [toClubId]: { ...state.finance.plans[toClubId]!, delegated: false } } },
    payroll: { ...state.payroll, delegated: { ...state.payroll.delegated, [from]: true, [toClubId]: false } },
    scouting: { ...state.scouting, clubs: { ...state.scouting.clubs, [from]: { ...state.scouting.clubs[from]!, delegated: true }, [toClubId]: { ...state.scouting.clubs[toClubId]!, delegated: false } } },
    commercial: handOverCommercialControl(state.commercial, from, toClubId),
    academy: releaseAcademyFocus(state.academy, from),
  };
  // Facility control changes are journaled like the manager's own switches, so every replay reproduces them.
  if (!state.facilities.enabledSince) next = { ...next, facilities: { ...next.facilities, delegated: { ...next.facilities.delegated, [from]: true, [toClubId]: false } } };
  else {
    if (!next.facilities.delegated[from]) next = applyFacilityEvent(next, { ...facilityEventAnchor(next), type: 'delegate', clubId: from, delegated: true });
    if (next.facilities.delegated[toClubId]) next = applyFacilityEvent(next, { ...facilityEventAnchor(next), type: 'delegate', clubId: toClubId, delegated: false });
  }
  // Automatic sponsorship never leaves an acceptable offer waiting, so the former club decides at once.
  return automateSponsorship(next);
}
