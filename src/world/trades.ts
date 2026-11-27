import type { EmploymentContract } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { EmploymentTrade, SeasonTrades, TradeProposal } from '../domain/trades';
import type { Team } from '../domain/types';
import { getContractedClubs, getContractedClubsForRound } from './employment-policy';
import { reconcileMatchdayPlan } from './matchday-selection';
import { dateForRound } from './season';
import {
  answerTradeProposal, checkTrade, computerTradeDates, computerTradeTargets, planComputerTrades, tradeAnswerDate, tradeMoves, tradeSigning, tradeView,
  tradeWeekOf, tradeWindowReason, usesTrades, type TradeCheck, type TradeSide, type TradeView,
} from './trades-policy';

/**
 * NBA step 9 (provisional format 94): trades between NBA clubs. The manager proposes; the other club answers at the
 * next boundary (the next week in season, the next recruitment day in the offseason). Accepted in-season trades register
 * at once; accepted offseason trades take effect when the new season starts. Computer clubs trade at fixed dates.
 * Every trade moves the players' terms unchanged as new `trade` contracts; the former records stay.
 */
export function createTrades(): SeasonTrades { return { model: 'trades-1', proposals: [] }; }

export const MANAGER_TRADE_LIMIT = 3;

/** The manager's offer checked now: open window, his club, no other offer waiting, and a legal trade. */
export function quoteTradeProposal(state: SeasonState, toClubId: string, sends: readonly string[], receives: readonly string[]): TradeCheck {
  const view = tradeView(state), first: TradeSide = { clubId: state.managedClubId, playerIds: sends }, second: TradeSide = { clubId: toClubId, playerIds: receives };
  const check = checkTrade(state, view, first, second);
  const reason = tradeProposalReason(state) ?? check.reason;
  return { ...check, reason };
}

function tradeProposalReason(state: SeasonState): string | null {
  if (!state.trades || !usesTrades(state)) return 'Trades between NAL clubs are part of new NAL careers.';
  if (!state.managedClubId) return 'Without a club you cannot propose trades.';
  const window = tradeWindowReason(state);
  if (window) return window;
  if (state.trades.proposals.some(proposal => proposal.status === 'pending')) return 'Wait for the answer to your current trade offer, or withdraw it.';
  return null;
}

/** Send a trade offer to another NBA club; it answers at the next boundary. */
export function proposeTrade(state: SeasonState, toClubId: string, sends: readonly string[], receives: readonly string[]): SeasonState {
  const quote = quoteTradeProposal(state, toClubId, sends, receives);
  if (quote.reason) throw new Error(quote.reason);
  const proposal: TradeProposal = {
    id: `trade-proposal-${state.trades!.proposals.length + 1}`, seasonNumber: state.seasonNumber, phase: state.status === 'complete' ? 'offseason' : 'season', round: state.round,
    proposedOn: state.date, answerOn: tradeAnswerDate(state), fromClubId: state.managedClubId, toClubId, sends: [...sends], receives: [...receives], status: 'pending', settledOn: null, reason: null, tradeId: null,
  };
  return { ...state, trades: { ...state.trades!, proposals: [...state.trades!.proposals, proposal] } };
}

/** Take back an offer before the answer, or call off an agreed offseason trade before the season change. */
export function withdrawTradeProposal(state: SeasonState, proposalId: string): SeasonState {
  const proposal = state.trades?.proposals.find(item => item.id === proposalId);
  if (!proposal || proposal.status !== 'pending' && proposal.status !== 'agreed') throw new Error('Choose a trade offer that is still open.');
  return replaceProposal(state, { ...proposal, status: 'withdrawn', settledOn: state.date, reason: 'You withdrew the offer.' });
}

function replaceProposal(state: SeasonState, proposal: TradeProposal): SeasonState {
  return { ...state, trades: { ...state.trades!, proposals: state.trades!.proposals.map(item => item.id === proposal.id ? proposal : item) } };
}

/** A trade written into employment: the released terms, the new `trade` contracts and, in season, registration and wages. */
export function completeTrade(state: SeasonState, first: TradeSide, second: TradeSide, source: EmploymentTrade['source'], proposalId?: string): SeasonState {
  const view = tradeView(state), signed = tradeSigning(state);
  const { moves, contracts } = tradeMoves(state.employment, view, first, second, signed, state.employment.contracts.length + 1);
  const trade: EmploymentTrade = {
    id: `employment-trade-${(state.employment.trades?.length ?? 0) + 1}`, seasonNumber: state.seasonNumber, completedOn: dateForRound(view.round, view.season), startsSeason: view.season, startsRound: view.round,
    source, ...(proposalId ? { proposalId } : {}), clubIds: [first.clubId, second.clubId], moves,
  };
  const next: SeasonState = { ...state, employment: { ...state.employment, contracts: [...state.employment.contracts, ...contracts], trades: [...(state.employment.trades ?? []), trade] } };
  return view.phase === 'season' ? registerTrade(next, trade, contracts) : next;
}

/** In season: the two clubs' registrations at this boundary (one snapshot per club and week) and the new wage agreements. */
function registerTrade(state: SeasonState, trade: EmploymentTrade, contracts: readonly EmploymentContract[]): SeasonState {
  const round = state.round, season = state.seasonNumber;
  const existing = new Set(state.rosters.filter(roster => roster.fromRound === round).map(roster => roster.clubId));
  const affected = new Set([...trade.clubIds, ...existing]);
  const canonical = getContractedClubsForRound(state, season, round);
  const clubs: Team[] = state.clubs.map(club => affected.has(club.id) ? { ...club, players: canonical.find(item => item.id === club.id)!.players } : club);
  const rosters = [...state.rosters.filter(roster => roster.fromRound !== round || !affected.has(roster.clubId)), ...clubs.filter(club => affected.has(club.id)).map(club => ({ id: `roster-s${season}-${club.id}-r${round}`, clubId: club.id, fromRound: round, players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })) }))];
  const traded = new Set(trade.clubIds);
  const plans = Object.fromEntries(clubs.map(club => {
    const plan = state.plans[club.id]!;
    if (!traded.has(club.id)) return [club.id, plan];
    const registered = new Set(club.players.map(player => player.id));
    const lineup = [...new Set([...plan.lineup.filter(id => registered.has(id)), ...club.players.map(player => player.id)])].slice(0, 5);
    return [club.id, reconcileMatchdayPlan({ ...plan, lineup }, club)];
  }));
  const training = { ...state.training, plans: Object.fromEntries(clubs.map(club => {
    const plan = state.training.plans[club.id]!;
    return [club.id, traded.has(club.id) ? { ...plan, individual: Object.fromEntries(club.players.map(player => [player.id, plan.individual[player.id] ?? 'team'])) } : plan];
  })) };
  // Each arriving player's current term is paid by his new club from this week; his former club's agreement ends the week before.
  const agreements = state.payroll.enabledSince ? contracts.filter(contract => contract.startsSeason === season && contract.startsRound === round).map(contract => ({ id: `wage-s${season}-${contract.playerId}-r${round}`, playerId: contract.playerId, clubId: contract.clubId, seasonNumber: season, startsRound: round, seasonWage: contract.seasonWage })) : [];
  return { ...state, clubs, rosters, plans, training, payroll: { ...state.payroll, agreements: [...state.payroll.agreements, ...agreements] } };
}

/**
 * In season, at each week's boundary after the week's arrivals (format 94): the manager's offer due now is answered
 * (an accepted trade registers at once), then the computer clubs' trades of the dates in the week just played.
 */
export function processTradeBoundary(state: SeasonState): SeasonState {
  if (!state.trades || !usesTrades(state) || state.status !== 'active' || state.round < 2) return state;
  let next = state;
  for (const proposal of next.trades!.proposals.filter(item => item.status === 'pending' && item.phase === 'season' && item.seasonNumber === state.seasonNumber && item.round === state.round - 1)) next = answerProposal(next, proposal);
  const week = state.round - 1, targets = computerTradeTargets(state.seed, state.seasonNumber);
  for (const date of computerTradeDates(state.seasonNumber).filter(item => tradeWeekOf(state, state.seasonNumber, item) === week)) {
    for (const plan of planComputerTrades(next, date, targets.get(date) ?? 0)) next = completeTrade(next, plan.first, plan.second, 'computer');
  }
  return next;
}

/** The other club's answer at its boundary; in season an accepted trade completes now, in the offseason it is agreed for the season change. */
function answerProposal(state: SeasonState, proposal: TradeProposal): SeasonState {
  if (proposal.fromClubId !== state.managedClubId) return replaceProposal(state, { ...proposal, status: 'declined', settledOn: state.date, reason: 'The offer lapsed when you left the club.' });
  const answer = answerTradeProposal(state, proposal, proposal.answerOn);
  if (!answer.accept) return replaceProposal(state, { ...proposal, status: 'declined', settledOn: state.date, reason: answer.reason });
  if (proposal.phase === 'offseason') return replaceProposal(state, { ...proposal, status: 'agreed', settledOn: state.date });
  const completed = completeTrade(state, { clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives }, 'manager', proposal.id);
  return replaceProposal(completed, { ...proposal, status: 'completed', settledOn: state.date, tradeId: completed.employment.trades!.at(-1)!.id });
}

/** Offseason: offers whose answer day has come are answered (after a recruitment day). */
export function answerOffseasonTrades(state: SeasonState): SeasonState {
  if (!state.trades || !usesTrades(state) || state.status !== 'complete') return state;
  let next = state;
  for (const proposal of next.trades!.proposals.filter(item => item.status === 'pending' && item.phase === 'offseason' && item.seasonNumber === state.seasonNumber && item.answerOn <= state.date)) next = answerProposal(next, proposal);
  return next;
}

/**
 * At the season change, after recruitment closed (format 94): each agreed offseason trade completes when it is still
 * legal for next season (rosters 13-15 and salary matching), else it is called off. Offers still waiting lapse.
 */
export function applyOffseasonTrades(state: SeasonState): SeasonState {
  if (!state.trades || !usesTrades(state) || state.status !== 'complete') return state;
  let next = state;
  for (const proposal of next.trades!.proposals.filter(item => item.seasonNumber === state.seasonNumber && item.phase === 'offseason' && (item.status === 'agreed' || item.status === 'pending'))) {
    const completedOn = dateForRound(1, state.seasonNumber + 1);
    if (proposal.status === 'pending') { next = replaceProposal(next, { ...proposal, status: 'declined', settledOn: completedOn, reason: 'Recruitment closed before the club answered.' }); continue; }
    const reason = offseasonTradeReason(next, proposal);
    // The answer's day stays the settling day; the season change only completes or calls off the agreement.
    if (reason) { next = replaceProposal(next, { ...proposal, status: 'called-off', reason }); continue; }
    next = completeTrade(next, { clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives }, 'manager', proposal.id);
    next = replaceProposal(next, { ...proposal, status: 'completed', tradeId: next.employment.trades!.at(-1)!.id });
  }
  return next.employment.trades?.length !== state.employment.trades?.length ? { ...next, clubs: getContractedClubs(next, next.seasonNumber + 1) } : next;
}

/** Why an agreed offseason trade cannot complete at the season change: the full roster rule (13-15) applies then. */
export function offseasonTradeReason(state: Pick<SeasonState, 'employment' | 'world' | 'seasonNumber'>, proposal: Pick<TradeProposal, 'fromClubId' | 'toClubId' | 'sends' | 'receives'>): string | null {
  const view: TradeView = { phase: 'season', season: state.seasonNumber + 1, round: 1 };
  return checkTrade(state, view, { clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives }).reason;
}

/** The manager's offers, latest first, and the season's completed trades for the trade screen. */
export function managerTradeProposals(state: SeasonState): readonly TradeProposal[] { return [...(state.trades?.proposals ?? [])].reverse(); }
export function seasonTrades(state: SeasonState, seasonNumber = state.seasonNumber): readonly EmploymentTrade[] {
  return (state.employment.trades ?? []).filter(trade => trade.seasonNumber === seasonNumber);
}
