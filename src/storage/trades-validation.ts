import type { EmploymentContract, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { EmploymentTrade, TradeProposal } from '../domain/trades';
import type { WorldContext } from '../domain/world';
import { isNbaClub, roundKey, seasonRounds, worldOf } from '../world/career-world';
import { managedClubAtRound, managedClubFor } from '../world/career';
import { dateForRound } from '../world/season';
import { addMarketDays } from '../world/market-policy';
import {
  answerTradeProposal, checkTrade, computerTradeDates, computerTradeTargets, offseasonTradeWindow, planComputerTrades, TRADE_RULES, tradeDeadline, tradeMoves,
  tradeWeekOf, usesTrades, type TradeContext, type TradeSide, type TradeView,
} from '../world/trades-policy';
import { offseasonTradeReason } from '../world/trades';

/** NBA step 9: trades between NBA clubs (provisional format number; whoever merges takes the next free one). */
export const TRADES_FORMAT = 94;

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
const ids = (value: unknown, min: number, max: number): value is string[] => Array.isArray(value) && value.length >= min && value.length <= max && value.every(item => typeof item === 'string') && new Set(value).size === value.length;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** A completed trade's two sides, as its moves list them (the first club's players first). */
export function tradeSides(trade: Pick<EmploymentTrade, 'clubIds' | 'moves'>): [TradeSide, TradeSide] {
  return [0, 1].map(index => ({ clubId: trade.clubIds[index]!, playerIds: trade.moves.filter(move => move.fromClubId === trade.clubIds[index]).map(move => move.playerId) })) as unknown as [TradeSide, TradeSide];
}
const inSeason = (trade: Pick<EmploymentTrade, 'seasonNumber' | 'startsSeason'>) => trade.startsSeason === trade.seasonNumber;

/** Format 94: the shape and calendar of `employment.trades` (each trade's terms are checked at its first contract). */
export function validateTradeRecords(value: unknown, context: WorldContext, seasonNumber: number, round: number, status: SeasonState['status']): EmploymentTrade[] {
  if (value === undefined) return [];
  if (!usesTrades(context)) fail('employment.trades', 'needs a world with NBA trades');
  if (!Array.isArray(value) || value.length > 20_000) fail('employment.trades', 'must be a bounded list of completed trades');
  const world = worldOf(context), rounds = seasonRounds(context);
  let previous = 0;
  for (const [index, raw] of value.entries()) {
    const path = `employment.trades[${index}]`;
    const trade = record(raw, path, ['id', 'seasonNumber', 'completedOn', 'startsSeason', 'startsRound', 'source', 'clubIds', 'moves', ...(raw !== null && typeof raw === 'object' && Object.hasOwn(raw, 'proposalId') ? ['proposalId'] : [])]);
    if (trade.id !== `employment-trade-${index + 1}`) fail(`${path}.id`, 'must use sequential trade identities');
    if (trade.source !== 'manager' && trade.source !== 'computer' || (trade.source === 'manager') !== (typeof trade.proposalId === 'string')) fail(`${path}.source`, 'must name a manager\'s accepted offer or a computer trade');
    if (!integer(trade.seasonNumber, 1, seasonNumber) || !integer(trade.startsSeason, 1, seasonNumber + 1) || !integer(trade.startsRound, 1, rounds)) fail(path, 'must identify its season and registration boundary');
    const during = trade.startsSeason === trade.seasonNumber;
    if (during ? trade.startsRound < 2 || trade.startsRound >= rounds || trade.seasonNumber === seasonNumber && trade.startsRound > round : trade.startsSeason !== trade.seasonNumber + 1 || trade.startsRound !== 1 || trade.seasonNumber >= seasonNumber) fail(path, 'must register in season at a later week or at the next season\'s start');
    if (trade.completedOn !== dateForRound(trade.startsRound, trade.startsSeason)) fail(`${path}.completedOn`, 'must be its registration day');
    const key = roundKey(trade.startsSeason, trade.startsRound);
    if (key < previous) fail(path, 'must keep chronological order');
    previous = key;
    if (during && trade.startsSeason === seasonNumber && status === 'complete' && trade.startsRound > round) fail(path, 'cannot come after the season');
    if (!ids(trade.clubIds, 2, 2) || !(trade.clubIds as string[]).every(clubId => isNbaClub(world, clubId))) fail(`${path}.clubIds`, 'must name two different NBA clubs');
    const clubIds = trade.clubIds as [string, string];
    if (!Array.isArray(trade.moves) || trade.moves.length < 2 || trade.moves.length > TRADE_RULES.maxPlayersPerSide * 2) fail(`${path}.moves`, 'must move one to three players each way');
    let firstSide = true;
    for (const [moveIndex, rawMove] of trade.moves.entries()) {
      const move = record(rawMove, `${path}.moves[${moveIndex}]`, ['playerId', 'fromClubId', 'toClubId', 'releasedContractIds', 'contractIds']);
      if (typeof move.playerId !== 'string' || !clubIds.includes(move.fromClubId as string) || !clubIds.includes(move.toClubId as string) || move.fromClubId === move.toClubId) fail(`${path}.moves[${moveIndex}]`, 'must move a player between the two clubs');
      if (!ids(move.releasedContractIds, 1, 10) || !ids(move.contractIds, 1, 10) || (move.contractIds as string[]).length !== (move.releasedContractIds as string[]).length) fail(`${path}.moves[${moveIndex}]`, 'must carry each released term on in one trade contract');
      if (move.fromClubId === clubIds[0] ? !firstSide : (firstSide = false)) fail(`${path}.moves`, 'must list the first club\'s players first');
    }
    const sides = tradeSides(trade as unknown as EmploymentTrade);
    if (sides.some(side => side.playerIds.length < 1 || side.playerIds.length > TRADE_RULES.maxPlayersPerSide)) fail(`${path}.moves`, 'must move one to three players each way');
    if (trade.source === 'computer' && (!during || !computerTradeDates(trade.seasonNumber as number).some(date => tradeWeekOf(context, trade.seasonNumber as number, date) === (trade.startsRound as number) - 1))) fail(path, 'must be a computer trade at one of the season\'s trade dates');
  }
  return value as EmploymentTrade[];
}

/**
 * Format 94: a trade at its first contract: legal at the record before it (rosters, salary matching, contracts held),
 * and its released terms and `trade` contracts exactly those the trade gives (the terms carried on unchanged).
 */
export function validateTradeAt(trade: EmploymentTrade, prefix: SeasonEmployment, contracts: readonly EmploymentContract[], index: number, context: WorldContext, path: string): void {
  const [first, second] = tradeSides(trade), rounds = seasonRounds(context);
  const view: TradeView = inSeason(trade) ? { phase: 'season', season: trade.startsSeason, round: trade.startsRound } : { phase: 'offseason', season: trade.startsSeason, round: 1 };
  // Offseason trades complete at the season change, when every NBA squad must hold 13-15 players.
  const legality: TradeView = inSeason(trade) ? view : { phase: 'season', season: trade.startsSeason, round: 1 };
  const reason = checkTrade({ world: worldOf(context), employment: prefix }, legality, first, second).reason;
  if (reason) fail(path, `must complete a legal trade (${reason})`);
  const signed = inSeason(trade) ? { season: trade.seasonNumber, round: trade.startsRound } : { season: trade.seasonNumber, round: rounds };
  const expected = tradeMoves(prefix, view, first, second, signed, index + 1);
  if (!same(trade.moves, expected.moves) || !same(contracts.slice(index, index + expected.contracts.length), expected.contracts)) fail(path, 'must release the traded players\' terms and carry each on unchanged at the new club');
}

/** The employment record at a boundary: every agreement before index `end`, with the releases they explain. */
function employmentBefore(employment: SeasonEmployment, end: number, seasonNumber: number): SeasonEmployment {
  const contracts = employment.contracts.slice(0, end), present = new Set(contracts.map(contract => contract.id));
  return { ...employment, contracts, transfers: employment.transfers.filter(transfer => present.has(transfer.contractId)), buyouts: employment.buyouts.filter(buyout => buyout.seasonNumber < seasonNumber), ...(employment.departures ? { departures: employment.departures.filter(departure => departure.startsSeason <= seasonNumber) } : {}), market: null };
}

/** The index of the first agreement signed after a boundary, or of the first contract of one of `trades` (whichever comes first). */
function boundaryEnd(employment: SeasonEmployment, seasonNumber: number, round: number, trades: readonly EmploymentTrade[]): number {
  const tradeContracts = new Set(trades.flatMap(trade => trade.moves.flatMap(move => move.contractIds)));
  const key = roundKey(seasonNumber, round);
  const end = employment.contracts.findIndex(contract => roundKey(contract.signedSeason, contract.signedRound) > key || tradeContracts.has(contract.id));
  return end < 0 ? employment.contracts.length : end;
}

function contextAt(state: SeasonState, employment: SeasonEmployment, seasonNumber: number, round: number, status: SeasonState['status'], date: string): TradeContext {
  return { ...state, employment, seasonNumber, round, status, date };
}

/**
 * Format 94: the manager's trade journal (`trades-1`) and every computer trade decided again. Offers follow the trade
 * windows, one waiting at a time; in-season answers are decided again at their boundary; completed offers name their
 * trade; offseason agreements complete or are called off at the season change. Computer trades at each fixed date are
 * planned again from the seed and the record at that boundary.
 */
export function validateTradesState(state: SeasonState, version: number): void {
  const world = worldOf(state);
  if (Object.hasOwn(world, 'nbaTrades') && version < TRADES_FORMAT) fail('world.nbaTrades', `requires format ${TRADES_FORMAT} or later`);
  if (Object.hasOwn(state, 'trades') && version < TRADES_FORMAT) fail('trades', `requires format ${TRADES_FORMAT} or later`);
  if (Object.hasOwn(state.employment ?? {}, 'trades') && version < TRADES_FORMAT) fail('employment.trades', `requires format ${TRADES_FORMAT} or later`);
  const expected = usesTrades(state) && !!state.employment?.enabledSince;
  if (Object.hasOwn(state, 'trades') !== expected) fail('trades', 'must be kept exactly in careers with NBA trades');
  if (!expected) { if (state.employment?.trades) fail('employment.trades', 'needs a career with NBA trades'); return; }
  const journal = record(state.trades, 'trades', ['model', 'proposals']);
  if (journal.model !== TRADE_RULES.model || !Array.isArray(journal.proposals) || journal.proposals.length > 5_000) fail('trades', 'must retain a supported bounded offer journal');
  const employment = state.employment, trades = employment.trades ?? [], rounds = seasonRounds(state);
  const current = (year: number, round: number) => roundKey(year, round) <= roundKey(state.seasonNumber, state.round);
  let previousProposed = '', open = 0;
  const linked = new Set<string>();
  for (const [index, raw] of (journal.proposals as unknown[]).entries()) {
    const path = `trades.proposals[${index}]`;
    const proposal = record(raw, path, ['id', 'seasonNumber', 'phase', 'round', 'proposedOn', 'answerOn', 'fromClubId', 'toClubId', 'sends', 'receives', 'status', 'settledOn', 'reason', 'tradeId']) as unknown as TradeProposal;
    if (proposal.id !== `trade-proposal-${index + 1}`) fail(`${path}.id`, 'must use sequential offer identities');
    if (!integer(proposal.seasonNumber, 1, state.seasonNumber) || proposal.phase !== 'season' && proposal.phase !== 'offseason' || !integer(proposal.round, 1, rounds)) fail(path, 'must identify its season and week');
    if (typeof proposal.fromClubId !== 'string' || typeof proposal.toClubId !== 'string' || !isNbaClub(world, proposal.fromClubId) || !isNbaClub(world, proposal.toClubId) || proposal.fromClubId === proposal.toClubId) fail(path, 'must name two different NBA clubs');
    if (!ids(proposal.sends, 1, TRADE_RULES.maxPlayersPerSide) || !ids(proposal.receives, 1, TRADE_RULES.maxPlayersPerSide)) fail(path, 'must offer and ask for one to three players');
    if (!['pending', 'declined', 'agreed', 'completed', 'called-off', 'withdrawn'].includes(proposal.status) || proposal.settledOn !== null && typeof proposal.settledOn !== 'string' || proposal.reason !== null && typeof proposal.reason !== 'string' || proposal.tradeId !== null && typeof proposal.tradeId !== 'string') fail(path, 'must record a supported answer');
    const year = proposal.seasonNumber, season = proposal.phase === 'season';
    if (proposal.proposedOn < previousProposed) fail(path, 'must keep chronological order');
    if (open) fail(path, 'cannot be made while another offer waits for its answer');
    previousProposed = proposal.proposedOn;
    if (season) {
      if (proposal.round >= rounds || proposal.proposedOn !== dateForRound(proposal.round, year) || proposal.answerOn !== dateForRound(proposal.round + 1, year) || proposal.proposedOn > tradeDeadline(year)) fail(path, 'must be made in season by the trade deadline and answered the next week');
      if (!current(year, proposal.round) || managedClubAtRound(state, year, proposal.round) !== proposal.fromClubId) fail(path, 'must come from the manager\'s club at that week');
      const proposedAt = employmentBefore(employment, boundaryEnd(employment, year, proposal.round, []), year);
      const legal = checkTrade({ world, employment: proposedAt }, { phase: 'season', season: year, round: proposal.round }, { clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives });
      if (legal.reason) fail(path, `must be a legal trade when offered (${legal.reason})`);
      const answered = current(year, proposal.round + 1);
      if (proposal.status === 'pending') { if (answered) fail(path, 'must be answered at the next week'); open += 1; continue; }
      if (proposal.status === 'withdrawn') { if (proposal.settledOn === null || proposal.settledOn < proposal.proposedOn || proposal.settledOn >= proposal.answerOn || proposal.tradeId !== null) fail(path, 'must be withdrawn before the answer'); continue; }
      if (!answered || proposal.settledOn !== proposal.answerOn || proposal.status !== 'declined' && proposal.status !== 'completed') fail(path, 'must be answered at the next week');
      const atAnswer = employmentBefore(employment, boundaryEnd(employment, year, proposal.round + 1, trades.filter(trade => trade.startsSeason === year && trade.startsRound === proposal.round + 1 && inSeason(trade))), year);
      const answer = managedClubAtRound(state, year, proposal.round) !== proposal.fromClubId ? { accept: false, reason: 'The offer lapsed when you left the club.' } : answerTradeProposal(contextAt(state, atAnswer, year, proposal.round + 1, 'active', proposal.answerOn), proposal, proposal.answerOn);
      if (answer.accept !== (proposal.status === 'completed') || !answer.accept && (proposal.reason !== answer.reason || proposal.tradeId !== null)) fail(path, 'must carry the other club\'s answer');
    } else {
      const window = offseasonTradeWindow(state, year);
      if (proposal.round !== rounds || proposal.proposedOn < window.opens || proposal.proposedOn >= window.closes || proposal.answerOn !== addMarketDays(proposal.proposedOn, 1)) fail(path, 'must be made in the offseason after the draft window and answered the next day');
      if (managedClubFor(state, year, true) !== proposal.fromClubId) fail(path, 'must come from the manager\'s club that offseason');
      const live = year === state.seasonNumber && state.status === 'complete';
      // Answered on the first recruitment day on or after the answer day (the calendar may skip quiet days).
      const answeredInTime = (settled: string | null) => settled !== null && settled >= proposal.answerOn && settled <= (live ? state.date : window.closes);
      if (live && proposal.proposedOn > state.date || !live && year >= state.seasonNumber) fail(path, 'cannot be made after the current day');
      if (proposal.status === 'pending') { if (!live || proposal.answerOn <= state.date) fail(path, 'must be answered on its day'); open += 1; continue; }
      if (proposal.status === 'withdrawn') { if (proposal.settledOn === null || proposal.settledOn < proposal.proposedOn || proposal.tradeId !== null) fail(path, 'must be withdrawn while open'); continue; }
      if (proposal.status === 'declined') {
        const atClose = proposal.settledOn === dateForRound(1, year + 1) && proposal.reason === 'Recruitment closed before the club answered.';
        if (proposal.tradeId !== null || typeof proposal.reason !== 'string' || !(atClose ? !live : answeredInTime(proposal.settledOn))) fail(path, 'must be declined on its answer day or when recruitment closed');
        continue;
      }
      if (!answeredInTime(proposal.settledOn)) fail(path, 'must be answered on the next recruitment day');
      if (proposal.status === 'agreed') { if (!live || proposal.tradeId !== null) fail(path, 'must complete or be called off at the season change'); continue; }
      if (live || proposal.status !== 'completed' && proposal.status !== 'called-off') fail(path, 'must complete or be called off at the season change');
      if (proposal.status === 'called-off') {
        const later = trades.filter(trade => trade.source === 'manager' && trade.seasonNumber === year && !inSeason(trade) && Number(trade.proposalId!.slice('trade-proposal-'.length)) > index + 1);
        const atChange = employmentBefore(employment, boundaryEnd(employment, year, rounds, later), year + 1);
        const reason = offseasonTradeReason({ world, seasonNumber: year, employment: atChange }, proposal);
        if (!reason || proposal.reason !== reason || proposal.tradeId !== null) fail(path, 'must be called off only when no longer legal at the season change');
      }
    }
    if (proposal.status === 'completed') {
      const trade = trades.find(item => item.id === proposal.tradeId);
      const sides = trade ? tradeSides(trade) : null;
      const when = season ? { startsSeason: year, startsRound: proposal.round + 1 } : { startsSeason: year + 1, startsRound: 1 };
      if (!trade || trade.source !== 'manager' || trade.proposalId !== proposal.id || trade.seasonNumber !== year || trade.startsSeason !== when.startsSeason || trade.startsRound !== when.startsRound || !same(sides, [{ clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives }]) || proposal.reason !== null) fail(path, 'must name the trade it completed');
      linked.add(trade.id);
    }
  }
  if (trades.some(trade => trade.source === 'manager' && !linked.has(trade.id))) fail('employment.trades', 'must link every manager\'s trade to its accepted offer');
  validateComputerTrades(state, trades);
}

/** Every computer trade planned again at its boundary from the seed and the record then (fewer only when none was found). */
function validateComputerTrades(state: SeasonState, trades: readonly EmploymentTrade[]): void {
  const employment = state.employment;
  for (let year = 1; year <= state.seasonNumber; year += 1) {
    const targets = computerTradeTargets(state.seed, year), byBoundary = new Map<number, string[]>();
    for (const date of computerTradeDates(year)) {
      const week = tradeWeekOf(state, year, date);
      if (week === null) continue;
      const boundary = week + 1;
      if (year === state.seasonNumber && state.status === 'active' && boundary > state.round) continue;
      byBoundary.set(boundary, [...(byBoundary.get(boundary) ?? []), date]);
    }
    for (const [boundary, dates] of byBoundary) {
      const actual = trades.filter(trade => trade.source === 'computer' && trade.seasonNumber === year && trade.startsRound === boundary);
      let used = 0;
      for (const date of dates) {
        const atBoundary = employmentBefore(employment, boundaryEnd(employment, year, boundary, actual.slice(used)), year);
        const plans = planComputerTrades(contextAt(state, atBoundary, year, boundary, 'active', dateForRound(boundary, year)), date, targets.get(date) ?? 0);
        const recorded = actual.slice(used, used + plans.length).map(trade => { const [first, second] = tradeSides(trade); return { first, second }; });
        if (!same(recorded, plans)) fail('employment.trades', `must hold exactly the computer trades of ${date}`);
        used += plans.length;
      }
      if (used !== actual.length) fail('employment.trades', `must hold only the computer trades of season ${year}'s trade dates`);
    }
    if (trades.some(trade => trade.source === 'computer' && trade.seasonNumber === year && !byBoundary.has(trade.startsRound))) fail('employment.trades', 'must hold computer trades only at their trade dates');
  }
}
