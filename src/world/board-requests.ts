import type { PresidentTraitLevel } from '../data/development-presidents';
import type { BoardRequest, BoardRequestKind } from '../domain/board';
import type { SeasonState } from '../domain/season';
import type { Position } from '../domain/types';
import { seasonRounds } from './career-world';
import { rosterForRound } from './rosters';
import { isRegularFixture } from './season';
import { isRecovering } from './health';
import { maxTicketPriceFor, TICKET_PRICE_STEP } from './finance';
import { clubRosterLimit } from './club-roster-policy';
import { gameSeconds, PRESIDENT_RULES } from './presidents';

/**
 * Format 70 (board-2 careers): what an interfering president asks of the manager, with a deadline. Met requests add
 * confidence and ignored ones remove it (`PRESIDENT_RULES.requests`). Only the manager's club receives requests.
 */
const level = (value: PresidentTraitLevel) => value - 1;
function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

export type RequestState = Pick<SeasonState, 'board' | 'seed' | 'seasonNumber' | 'round' | 'date' | 'rosters' | 'fixtures' | 'finance' | 'injuries'> & Partial<Pick<SeasonState, 'physio' | 'recruitment' | 'world' | 'dataPackId'>>;
export type RequestTerms = Omit<BoardRequest, 'id' | 'clubId' | 'seasonNumber' | 'round' | 'date' | 'deadlineRound' | 'outcome' | 'resolvedRound'>;

const clubGames = (state: Pick<SeasonState, 'fixtures'>, clubId: string, fromRound: number, toRound: number) => state.fixtures.filter(fixture => isRegularFixture(fixture) && fixture.result && fixture.round >= fromRound && fixture.round <= toRound && [fixture.homeClubId, fixture.awayClubId].includes(clubId));
/** Seconds a player has played for the club in counted games between two weeks. */
export function requestSeconds(state: Pick<SeasonState, 'fixtures'>, clubId: string, playerId: string, fromRound: number, toRound: number): number {
  return clubGames(state, clubId, fromRound, toRound).reduce((sum, fixture) => sum + (gameSeconds(fixture.result)[playerId]?.secondsPlayed ?? 0), 0);
}

/** Whether a request is met at the state's review, or withdrawn because its subject left the club. */
export function requestStatus(state: RequestState, request: BoardRequest): 'met' | 'withdrawn' | null {
  const roster = rosterForRound(state.rosters, request.clubId, state.round);
  if (request.kind === 'raise-ticket-price') {
    const plan = state.finance.plans[request.clubId];
    return plan && !plan.delegated && plan.price >= request.ticketPrice! ? 'met' : null;
  }
  if (request.kind === 'sign-player') {
    const before = new Set(rosterForRound(state.rosters, request.clubId, request.round).players.map(player => player.id));
    return roster.players.some(player => !before.has(player.id) && player.position === request.position) ? 'met' : null;
  }
  if (!roster.players.some(player => player.id === request.playerId)) return 'withdrawn';
  return requestSeconds(state, request.clubId, request.playerId!, request.round + 1, state.round) >= request.minutes! * 60 ? 'met' : null;
}

/** Settle open requests at this week's review: met, withdrawn, or ignored once the deadline review passes unmet. */
export function resolveBoardRequests(state: RequestState): BoardRequest[] {
  return (state.board.requests ?? []).map(request => {
    if (request.outcome !== 'open' || request.seasonNumber !== state.seasonNumber || state.round <= request.round) return request;
    const status = requestStatus(state, request);
    if (status) return { ...request, outcome: status, resolvedRound: state.round };
    return state.round >= request.deadlineRound ? { ...request, outcome: 'ignored' as const, resolvedRound: state.round } : request;
  });
}

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** The ticket-price request the president could make at this review (it reads the club's ticket plan of the moment). */
function ticketCandidate(state: RequestState, clubId: string): RequestTerms[] {
  const plan = state.finance.enabledSince ? state.finance.plans[clubId] : undefined;
  if (!plan) return [];
  // Raise the home ticket price by a tenth (whole euros), within the club's maximum.
  const maximum = maxTicketPriceFor(state, clubId), current = plan.price;
  const target = Math.min(maximum, Math.ceil(current * (100 + PRESIDENT_RULES.requests.ticketRaisePercent) / 100 / TICKET_PRICE_STEP) * TICKET_PRICE_STEP);
  return target > current ? [{ kind: 'raise-ticket-price', ticketPrice: target }] : [];
}


/** The requests that read only registrations, results and injuries, in a fixed order (after the ticket request). */
function squadCandidates(state: RequestState, clubId: string, deadlineRound: number): RequestTerms[] {
  const rules = PRESIDENT_RULES.requests, candidates: RequestTerms[] = [];
  const roster = rosterForRound(state.rosters, clubId, state.round);
  if (state.recruitment?.enabledSince && deadlineRound < seasonRounds(state) && roster.players.length < clubRosterLimit(state)) {
    // Sign a player for the thinnest position (fewest registered players; ties in court order).
    const counts = POSITIONS.map(position => roster.players.filter(player => player.position === position).length);
    candidates.push({ kind: 'sign-player', position: POSITIONS[counts.indexOf(Math.min(...counts))]! });
  }
  // Give minutes to the fit registered player who has played least this season.
  const healthy = roster.players.filter(player => !state.injuries.some(injury => injury.playerId === player.id && isRecovering(injury, state.date, state.physio)));
  const least = healthy.map(player => ({ id: player.id, seconds: requestSeconds(state, clubId, player.id, 1, state.round) })).sort((a, b) => a.seconds - b.seconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (least) candidates.push({ kind: 'play-player', playerId: least.id, minutes: rules.playMinutes });
  return candidates;
}

/**
 * After a weekly review, an interfering president may ask the manager for something: one request open at a time, at
 * most two a season, from the third week and only while counted games remain before the deadline. One seeded draw
 * decides; reading screens never draws.
 */
export function issueBoardRequest(state: RequestState, clubId: string, interference: PresidentTraitLevel): BoardRequest[] {
  const requests = state.board.requests ?? [], draw = requestDraw(state, clubId, interference);
  if (!draw) return requests;
  const candidates = [...ticketCandidate(state, clubId), ...draw.squad];
  if (!candidates.length) return requests;
  const pick = candidates[draw.kindHash % candidates.length]!;
  return [...requests, { id: `board-request-${requests.length + 1}`, clubId, ...pick, seasonNumber: state.seasonNumber, round: state.round, date: state.date, deadlineRound: draw.deadlineRound, outcome: 'open', resolvedRound: null }];
}

/** A review's request draw: the seeded kind draw and the candidates that read only the squad, results and injuries. */
export interface RequestDraw { deadlineRound: number; kindHash: number; squad: RequestTerms[]; ticketPlan: boolean }

/**
 * Whether the president asks at this review (null when the rules or the seeded draw say no), with what the save check
 * can rebuild (22 November 2026). The ticket request reads the club's ticket plan of that moment, which the save does
 * not journal; `ticketPlan` says only whether the club had a plan then.
 */
export function requestDraw(state: RequestState, clubId: string, interference: PresidentTraitLevel): RequestDraw | null {
  const rules = PRESIDENT_RULES.requests, requests = state.board.requests ?? [];
  const deadlineRound = state.round + rules.deadlineWeeks;
  const ownSeason = requests.filter(request => request.clubId === clubId && request.seasonNumber === state.seasonNumber);
  if (state.round < rules.firstRound || deadlineRound > seasonRounds(state) || ownSeason.length >= rules.maxPerSeason || requests.some(request => request.outcome === 'open')) return null;
  const chance = rules.weeklyChance[level(interference)]!;
  if (hash(state.seed, `president-request|${state.seasonNumber}|${state.round}|${clubId}`) % 10_000 >= Math.round(chance * 10_000)) return null;
  if (!state.fixtures.some(fixture => isRegularFixture(fixture) && !fixture.result && fixture.round > state.round && fixture.round <= deadlineRound && [fixture.homeClubId, fixture.awayClubId].includes(clubId))) return null;
  return { deadlineRound, kindHash: hash(state.seed, `president-request-kind|${state.seasonNumber}|${state.round}|${clubId}`), squad: squadCandidates(state, clubId, deadlineRound), ticketPlan: !!(state.finance.enabledSince && state.finance.plans[clubId]) };
}

export const REQUEST_KINDS: readonly BoardRequestKind[] = ['raise-ticket-price', 'sign-player', 'play-player'];
