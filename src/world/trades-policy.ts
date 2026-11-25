import type { EmploymentContract, SeasonEmployment } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { EmploymentTrade, TradeMove, TradeProposal } from '../domain/trades';
import type { Position, SkillAttributes } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { isNbaClub, nbaClubIds, seasonRounds } from './career-world';
import { clubContractsForRound, contractForRound, effectiveContractsForRound, MAX_CONTRACT_SEASONS } from './employment-policy';
import { addMarketDays, getMarketWindow, MARKET_WINDOW_DAYS } from './market-policy';
import { NBA_CAP_RULES, NBA_SALARY_CAP, usdToCents } from './nba-cap';
import { nbaDeadMoney } from './nba-cap-policy';
import { nbaOwnerCeiling } from './nba-owner';
import { usesNbaFreeAgency } from './nba-free-agency';
import { overallRating } from './overall-rating';
import { getCareerPlayer, getCareerPlayerAge, type CareerPlayerContext } from './player-catalog';
import { dateForRound } from './season';
import { steeringCoaches } from './head-coaches';
import { styleFit } from './coach-steering';
import { managedClubAtRound } from './career';

/**
 * NBA step 9 (provisional format 94, `trades-1`): the rules of trades between NBA clubs, shared by the manager's offers,
 * the other club's answer and the computer clubs' own trades. Only worlds with `world.nbaTrades` (and the NBA's money
 * rules) use them; European clubs and older careers never trade.
 *
 * Sources: [S] the 2023 CBA's salary matching for teams over the cap after a trade (incoming salary up to 125% of the
 * outgoing salary plus $100,000) and the trade deadline (the first Thursday of February in recent seasons); [D] rosters
 * of 13-15 (`NBA_CAP_RULES.roster`); [E] the computer clubs' valuation, the trade dates (the 15th of each month and
 * deadline day), about 4-8 computer trades a season, and the offseason opening a fixed number of days after the season's
 * end (the draft window). Left out (docs/nba.md): draft picks, cash, sign-and-trade, trade exceptions, the aprons' limits.
 */
export const TRADE_RULES = Object.freeze({
  model: 'trades-1' as const,
  maxPlayersPerSide: 3,
  /** [S] Over the cap after the trade, a club takes back at most 125% of the salary it sends out plus $100,000. */
  salaryMatchPercent: 125,
  salaryMatchExtraUsd: 100_000,
  /** [E] Offseason trades open this many days after the offseason begins (after the draft window), until recruitment closes. */
  offseasonOpensAfterDays: 14,
  /** [E] Computer trades fall on the 15th of each month from the season's first week to the deadline, and on deadline day. */
  computerDay: 15,
  /** [E] Computer trades a season: between these numbers (fewer only when no fair trade is found). */
  computerPerSeason: Object.freeze({ min: 4, max: 8 }),
  /** [E] Valuation: a player's overall rating above this level is worth something in a trade. */
  replacementRating: 40,
  /** [E] The least gain (in value points) a computer club wants from a trade; a seeded part is added. */
  computerMargin: 0.3,
  computerMarginSpread: 0.7,
  managerMargin: 0.5,
  marginSpread: 1.5,
  /** [E] Clubs ranked 1-10 by squad strength buy now (contenders), 21-30 rebuild. */
  contenders: 10,
  rebuilders: 10,
});

/** Whether a career's world has NBA trades. */
export const usesTrades = (context: WorldContext): boolean => !!context.world?.nbaTrades && context.world.nba?.cap === 'nba-cap-1';

/** $100,000 in the game's money. */
export const TRADE_SALARY_EXTRA = usdToCents(TRADE_RULES.salaryMatchExtraUsd);

/** The trade deadline of a season: the first Thursday of February of the season's second calendar year. */
export function tradeDeadline(seasonNumber: number): string {
  const year = Number(dateForRound(1, seasonNumber).slice(0, 4)) + 1;
  const first = new Date(Date.UTC(year, 1, 1));
  first.setUTCDate(1 + (4 - first.getUTCDay() + 7) % 7);
  return first.toISOString().slice(0, 10);
}

/** The computer trade dates of a season, in order: the 15th of each month from the first week to the deadline, then deadline day. */
export function computerTradeDates(seasonNumber: number): string[] {
  const start = dateForRound(1, seasonNumber), deadline = tradeDeadline(seasonNumber), dates: string[] = [];
  for (let month = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`); ; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const date = `${month.toISOString().slice(0, 7)}-${String(TRADE_RULES.computerDay).padStart(2, '0')}`;
    if (date >= deadline) break;
    if (date >= start) dates.push(date);
  }
  return [...dates, deadline];
}

/** The week whose days hold a date: computer trades of that date register at the next week's boundary. */
export function tradeWeekOf(context: WorldContext, seasonNumber: number, date: string): number | null {
  const rounds = seasonRounds(context);
  for (let round = 1; round < rounds; round += 1) if (date >= dateForRound(round, seasonNumber) && date < dateForRound(round + 1, seasonNumber)) return round;
  return null;
}

/** Seeded uniform number in [0, 1) for trade choices (never match randomness). */
export function tradeUnit(seed: number, ...parts: (string | number)[]): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `trade:${parts.join(':')}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 15; hash = Math.imul(hash, 2246822507) >>> 0; hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

/**
 * How many computer trades each date of a season aims for: a seeded season total of 4-8, deadline day first (1-3), the
 * rest spread over the monthly dates in a seeded order.
 */
export function computerTradeTargets(seed: number, seasonNumber: number): Map<string, number> {
  const dates = computerTradeDates(seasonNumber), { min, max } = TRADE_RULES.computerPerSeason;
  const total = min + Math.floor(tradeUnit(seed, 'season-total', seasonNumber) * (max - min + 1));
  const deadline = Math.min(3, total, 1 + Math.floor(tradeUnit(seed, 'deadline', seasonNumber) * 3));
  const targets = new Map(dates.map(date => [date, 0]));
  targets.set(dates.at(-1)!, deadline);
  const monthly = dates.slice(0, -1).sort((a, b) => tradeUnit(seed, 'month', seasonNumber, a) - tradeUnit(seed, 'month', seasonNumber, b) || (a < b ? -1 : 1));
  for (let left = total - deadline, index = 0; left > 0 && monthly.length; left -= 1, index += 1) { const date = monthly[index % monthly.length]!; targets.set(date, targets.get(date)! + 1); }
  return targets;
}

/** What a trade check reads: the career at the trade's boundary. */
export type TradeContext = CareerPlayerContext & Pick<SeasonState, 'seed' | 'employment' | 'seasonNumber' | 'round' | 'status' | 'managedClubId'> & Partial<Pick<SeasonState, 'coaches' | 'board' | 'career' | 'date' | 'market'>>;

/** Which contracts a trade moves: in season, those in force at this week; in the offseason, next season's. */
export interface TradeView { phase: 'season' | 'offseason'; season: number; round: number }
export function tradeView(context: Pick<SeasonState, 'status' | 'seasonNumber' | 'round'>): TradeView {
  return context.status === 'complete' ? { phase: 'offseason', season: context.seasonNumber + 1, round: 1 } : { phase: 'season', season: context.seasonNumber, round: context.round };
}

export interface TradeSide { clubId: string; playerIds: readonly string[] }
export interface TradeClubCheck {
  clubId: string;
  outgoing: number; incoming: number; payrollBefore: number; payrollAfter: number;
  /** Over the cap after the trade, so the salary must match. */
  overCap: boolean;
  /** The most incoming salary this club may take back (null when it stays under the cap). */
  maxIncoming: number | null;
  rosterBefore: number; rosterAfter: number;
}
export interface TradeCheck { reason: string | null; clubs: [TradeClubCheck, TradeClubCheck] }

const SEASON_REASON = 'Trades are open from the season start until the trade deadline, and in the offseason after the draft window.';

/** Whether trades are open now, for the manager's offers (in season until the deadline week; in the offseason after the draft window with a later recruitment day left). */
export function tradeWindowReason(state: Pick<SeasonState, 'status' | 'seasonNumber' | 'round' | 'date'> & WorldContext & { market?: SeasonState['market'] }): string | null {
  if (!usesTrades(state)) return 'Trades between NBA clubs are part of new NBA careers.';
  if (state.status === 'active') return state.round < seasonRounds(state) && dateForRound(state.round, state.seasonNumber) <= tradeDeadline(state.seasonNumber) ? null : `The trade deadline (${tradeDeadline(state.seasonNumber)}) has passed. Trades open again in the offseason after the draft.`;
  const window = state.market ? getMarketWindow({ market: state.market, seasonNumber: state.seasonNumber }) : null;
  if (!window || window.closed) return SEASON_REASON;
  const opens = addMarketDays(window.openedOn, TRADE_RULES.offseasonOpensAfterDays);
  if (state.date < opens) return `Offseason trades open on ${opens}, after the draft window.`;
  if (state.date >= window.closesOn) return 'Recruitment has closed; trades open again at the season start.';
  return null;
}

/** The day the other club answers an offer made now: the next week's first day in season, the next recruitment day in the offseason. */
export function tradeAnswerDate(state: Pick<SeasonState, 'status' | 'seasonNumber' | 'round' | 'date'>): string {
  return state.status === 'active' ? dateForRound(state.round + 1, state.seasonNumber) : addMarketDays(state.date, 1);
}

/** The offseason's trade window for a season: from the draft window's end to the last recruitment day. */
export function offseasonTradeWindow(context: WorldContext, seasonNumber: number): { opens: string; closes: string } {
  const openedOn = dateForRound(seasonRounds(context), seasonNumber);
  return { opens: addMarketDays(openedOn, TRADE_RULES.offseasonOpensAfterDays), closes: addMarketDays(openedOn, MARKET_WINDOW_DAYS) };
}

/** A player's terms with a club that a trade releases: in force at the view and every later term there, in journal order. */
export function tradeReleasedContracts(employment: SeasonEmployment, view: TradeView, playerId: string, clubId: string): EmploymentContract[] {
  const ids = new Set<string>();
  const own = employment.contracts.filter(contract => contract.playerId === playerId);
  const through = Math.max(view.season, ...own.map(contract => contract.endsSeason));
  for (let year = view.season; year <= through; year += 1) for (const contract of effectiveContractsForRound(employment, year, year === view.season ? view.round : 1)) if (contract.playerId === playerId && contract.clubId === clubId) ids.add(contract.id);
  return employment.contracts.filter(contract => ids.has(contract.id));
}

/** The `trade` contracts that carry a moving player's released terms on at his new club, numbered from `nextIndex`. */
export function tradeContracts(released: readonly EmploymentContract[], toClubId: string, view: TradeView, signed: { season: number; round: number }, nextIndex: number): EmploymentContract[] {
  return released.map((source, offset) => ({
    id: `employment-contract-${nextIndex + offset}`, playerId: source.playerId, clubId: toClubId,
    startsSeason: Math.max(view.season, source.startsSeason), startsRound: source.startsSeason <= view.season ? view.round : 1, endsSeason: source.endsSeason, seasonWage: source.seasonWage,
    ...(source.releaseFee === undefined ? {} : { releaseFee: source.releaseFee }), ...(source.role === undefined ? {} : { role: source.role }),
    signedSeason: signed.season, signedRound: signed.round, kind: 'trade' as const,
  }));
}

const payrollAt = (employment: SeasonEmployment, view: TradeView, clubId: string): number => clubContractsForRound(employment, view.season, view.round, clubId).reduce((sum, contract) => sum + contract.seasonWage, 0) + nbaDeadMoney(employment, clubId, view.season);

/**
 * Whether a trade is legal at a view (format 94): two different NBA clubs, 1-3 distinct players a side, each under
 * contract with his club at the view with no later agreement elsewhere; rosters stay 13-15 now and at most 15 in later
 * seasons; a club over the salary cap after the trade takes back at most 125% of the salary it sends plus $100,000.
 */
export function checkTrade(context: WorldContext & { employment: SeasonEmployment }, view: TradeView, first: TradeSide, second: TradeSide): TradeCheck {
  const employment = context.employment, world = context.world!;
  const sides = [first, second] as const;
  const clubs = sides.map((side, index) => {
    const other = sides[1 - index]!;
    const out = side.playerIds.map(id => contractForRound(employment, id, view.season, view.round)?.seasonWage ?? 0).reduce((sum, wage) => sum + wage, 0);
    const incoming = other.playerIds.map(id => contractForRound(employment, id, view.season, view.round)?.seasonWage ?? 0).reduce((sum, wage) => sum + wage, 0);
    const before = payrollAt(employment, view, side.clubId), after = before - out + incoming, overCap = after > NBA_SALARY_CAP;
    const rosterBefore = clubContractsForRound(employment, view.season, view.round, side.clubId).length;
    return { clubId: side.clubId, outgoing: out, incoming, payrollBefore: before, payrollAfter: after, overCap, maxIncoming: overCap ? Math.floor(out * TRADE_RULES.salaryMatchPercent / 100) + TRADE_SALARY_EXTRA : null, rosterBefore, rosterAfter: rosterBefore - side.playerIds.length + other.playerIds.length };
  }) as [TradeClubCheck, TradeClubCheck];
  const result = (reason: string | null): TradeCheck => ({ reason, clubs });
  if (!usesTrades(context)) return result('Trades between NBA clubs are part of new NBA careers.');
  if (first.clubId === second.clubId || !isNbaClub(world, first.clubId) || !isNbaClub(world, second.clubId)) return result('Choose two different NBA clubs.');
  for (const side of sides) if (side.playerIds.length < 1 || side.playerIds.length > TRADE_RULES.maxPlayersPerSide) return result(`Each side sends one to ${TRADE_RULES.maxPlayersPerSide} players.`);
  const all = [...first.playerIds, ...second.playerIds];
  if (new Set(all).size !== all.length) return result('Choose each player once.');
  for (const side of sides) for (const playerId of side.playerIds) {
    const contract = contractForRound(employment, playerId, view.season, view.round);
    if (contract?.clubId !== side.clubId) return result(view.phase === 'offseason' ? 'Every player in a trade must be under contract with his club for next season.' : 'Every player in a trade must be registered with his club now.');
    if (view.round > 1 && contract.startsSeason === view.season && contract.startsRound === view.round) return result('A player who joined his club this week can be traded from next week.');
    const own = employment.contracts.filter(item => item.playerId === playerId), through = Math.max(view.season, ...own.map(item => item.endsSeason));
    for (let year = view.season + 1; year <= through; year += 1) if (effectiveContractsForRound(employment, year, 1).some(item => item.playerId === playerId && item.clubId !== side.clubId)) return result('A player with an agreement with another club for a later season cannot be traded.');
  }
  const { min, max } = NBA_CAP_RULES.roster;
  for (const club of clubs) if (club.rosterAfter > max || view.phase === 'season' && club.rosterAfter < min) return result(`After the trade every NBA club must keep ${min}-${max} players${view.phase === 'season' ? '' : ' (at most 15 for next season)'}.`);
  // Later seasons: the moving players' later terms move too, so no squad may pass the limit.
  for (let year = view.season + 1; year < view.season + MAX_CONTRACT_SEASONS; year += 1) for (const [index, side] of sides.entries()) {
    const other = sides[1 - index]!;
    const later = effectiveContractsForRound(employment, year, 1), size = later.filter(item => item.clubId === side.clubId && !side.playerIds.includes(item.playerId)).length + later.filter(item => other.playerIds.includes(item.playerId) && item.clubId === other.clubId).length;
    if (size > max) return result(`The trade would give a club more than ${max} players under contract for a later season.`);
  }
  for (const club of clubs) if (club.maxIncoming !== null && club.incoming > club.maxIncoming) return result(`A club over the salary cap after a trade may take back at most 125% of the salary it sends plus $100,000.`);
  return result(null);
}

// The computer clubs' valuation.

type Strategy = 'contender' | 'neutral' | 'rebuilder';
interface PlayerFacts { id: string; clubId: string; position: Position; ovr: number; age: number; wage: number; years: number; attributes: SkillAttributes }
interface ClubFacts { players: PlayerFacts[]; payroll: number; positions: Map<Position, number> }
interface ValueContext { context: TradeContext; view: TradeView; date: string; strategies: Map<string, Strategy>; coaches: ReturnType<typeof steeringCoaches>; clubs: Map<string, ClubFacts>; players: Map<string, PlayerFacts>; base: Map<string, number> }

const ovrOf = (context: CareerPlayerContext, playerId: string): number => { const player = getCareerPlayer(context, playerId); return overallRating(player.attributes, player.position); };

/** Each NBA club's outlook from its squad strength (the mean of its eight best overall ratings): the top ten buy now, the bottom ten rebuild. */
function clubStrategies(clubs: ReadonlyMap<string, ClubFacts>): Map<string, Strategy> {
  const strength = [...clubs].map(([clubId, club]) => {
    const ratings = club.players.map(player => player.ovr).sort((a, b) => b - a).slice(0, 8);
    return { clubId, value: ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length) };
  }).sort((a, b) => b.value - a.value || (a.clubId < b.clubId ? -1 : 1));
  return new Map(strength.map((item, index) => [item.clubId, index < TRADE_RULES.contenders ? 'contender' : index >= strength.length - TRADE_RULES.rebuilders ? 'rebuilder' : 'neutral']));
}

/** What every NBA club and player looks like at the view, read once for a whole search. */
function valueContext(context: TradeContext, view: TradeView, date: string): ValueContext {
  const point = view.phase === 'season' ? { seasonNumber: context.seasonNumber, round: Math.max(1, context.round - 1), phase: 'season' as const } : { seasonNumber: context.seasonNumber, round: seasonRounds(context), phase: 'season' as const };
  const clubs = new Map<string, ClubFacts>(), players = new Map<string, PlayerFacts>();
  const ends = new Map<string, number>();
  for (const contract of context.employment.contracts) if (contract.endsSeason >= view.season) { const key = `${contract.playerId}|${contract.clubId}`; ends.set(key, Math.max(ends.get(key) ?? 0, contract.endsSeason)); }
  for (const clubId of [...nbaClubIds(context.world!)].sort()) {
    const roster = clubContractsForRound(context.employment, view.season, view.round, clubId), positions = new Map<Position, number>();
    const facts = roster.map(contract => {
      const player = getCareerPlayer(context, contract.playerId);
      positions.set(player.position, (positions.get(player.position) ?? 0) + 1);
      const item: PlayerFacts = { id: player.id, clubId, position: player.position, ovr: overallRating(player.attributes, player.position), age: getCareerPlayerAge(context, player.id, date) ?? 27, wage: contract.seasonWage, years: Math.max(1, (ends.get(`${player.id}|${clubId}`) ?? view.season) - view.season + 1), attributes: player.attributes };
      players.set(player.id, item);
      return item;
    });
    clubs.set(clubId, { players: facts, payroll: facts.reduce((sum, item) => sum + item.wage, 0) + nbaDeadMoney(context.employment, clubId, view.season), positions });
  }
  return { context, view, date, strategies: clubStrategies(clubs), coaches: steeringCoaches(context, point), clubs, players, base: new Map() };
}

const AGE_TABLE: Record<Strategy, readonly [number, number, number, number, number]> = { contender: [0, 1, 0, -0.5, -2], neutral: [2, 1, 0, -2, -5], rebuilder: [5, 2, -1, -5, -9] };

/**
 * What a player is worth to a club in a trade (value points), without his positional need: his overall rating above a
 * replacement level (stars count more), his age (contenders care little, rebuilders want youth), his contract (salary
 * against what his rating earns, longer terms weigh more; rebuilders care more), his fit with the head coach's style
 * (`styleFit`) and the club's own seeded opinion of him at this date (its scouts and plans, at most 2 either way).
 */
function baseValue(values: ValueContext, clubId: string, playerId: string): number {
  const key = `${clubId}|${playerId}`, known = values.base.get(key);
  if (known !== undefined) return known;
  const player = values.players.get(playerId)!, strategy = values.strategies.get(clubId) ?? 'neutral';
  const quality = Math.max(0, player.ovr - TRADE_RULES.replacementRating) ** 1.5 / 10 * (strategy === 'contender' ? 1.15 : strategy === 'rebuilder' ? 0.9 : 1);
  const agePart = AGE_TABLE[strategy][player.age <= 23 ? 0 : player.age <= 27 ? 1 : player.age <= 30 ? 2 : player.age <= 33 ? 3 : 4];
  const expected = Math.min(1, Math.max(0, (player.ovr - 55) / 40)) * 0.3 + 0.008, share = player.wage / NBA_SALARY_CAP;
  const contractPart = (expected - share) * 30 * (1 + 0.3 * (player.years - 1)) * (strategy === 'rebuilder' ? 1.5 : strategy === 'contender' ? 0.5 : 1);
  const coach = values.coaches?.[clubId];
  const styled = coach?.style ? styleFit({ attributes: coach.attributes, style: coach.style }, attribute => player.attributes[attribute], player.age <= 23) / 2 : 0;
  const opinion = (tradeUnit(values.context.seed, 'opinion', values.context.seasonNumber, values.date, clubId, playerId) - 0.5) * 4;
  const value = quality + agePart + contractPart + styled + opinion;
  values.base.set(key, value);
  return value;
}

/** The club's need at a position after the players it sends away: short of two players there it values one more, above four less. */
function positionNeed(values: ValueContext, clubId: string, playerId: string, leaving: readonly string[]): number {
  const position = values.players.get(playerId)!.position;
  let count = values.clubs.get(clubId)?.positions.get(position) ?? 0;
  for (const id of leaving) if (values.players.get(id)?.position === position) count -= 1;
  if (values.players.get(playerId)!.clubId === clubId && !leaving.includes(playerId)) count -= 1;
  return count < 2 ? 1.5 : count > 4 ? -1 : 0;
}

/** A club's gain from a trade: what it receives minus what it sends, in its own valuation. */
function tradeGain(values: ValueContext, clubId: string, sends: readonly string[], receives: readonly string[]): number {
  let gain = 0;
  for (const id of receives) gain += baseValue(values, clubId, id) + positionNeed(values, clubId, id, sends);
  for (const id of sends) gain -= baseValue(values, clubId, id) + positionNeed(values, clubId, id, []);
  return Math.round(gain * 100) / 100;
}

/** The cheap part of the legality check for a search: squad sizes and salary matching at the view. */
function quickTradeFits(values: ValueContext, first: TradeSide, second: TradeSide): boolean {
  const { min, max } = NBA_CAP_RULES.roster;
  const sides = [first, second] as const;
  return sides.every((side, index) => {
    const other = sides[1 - index]!, club = values.clubs.get(side.clubId)!;
    const out = side.playerIds.reduce((sum, id) => sum + values.players.get(id)!.wage, 0), incoming = other.playerIds.reduce((sum, id) => sum + values.players.get(id)!.wage, 0);
    const size = club.players.length - side.playerIds.length + other.playerIds.length;
    if (size > max || values.view.phase === 'season' && size < min) return false;
    return club.payroll - out + incoming <= NBA_SALARY_CAP || incoming <= Math.floor(out * TRADE_RULES.salaryMatchPercent / 100) + TRADE_SALARY_EXTRA;
  });
}

/**
 * Format 103 (`nba-free-agency.ts`): a computer club takes on no salary in a trade above its owner's payroll ceiling
 * (or above its payroll before the trade, when that is already higher): with stars now re-signed, trades had taken
 * small-market clubs far into the luxury tax and into unpaid costs. Read from the world and the contracts only, so save
 * checks plan the same trades.
 */
function ownerAllows(values: ValueContext, first: TradeSide, second: TradeSide): boolean {
  if (!usesNbaFreeAgency(values.context)) return true;
  const sides = [first, second] as const;
  return sides.every((side, index) => {
    const other = sides[1 - index]!, club = values.clubs.get(side.clubId)!;
    const after = club.payroll - side.playerIds.reduce((sum, id) => sum + values.players.get(id)!.wage, 0) + other.playerIds.reduce((sum, id) => sum + values.players.get(id)!.wage, 0);
    return after <= Math.max(club.payroll, nbaOwnerCeiling(values.context.world!, side.clubId));
  });
}

export interface TradeAnswer { accept: boolean; reason: string | null; gain: number | null }

/**
 * The other club's answer to the manager's offer (format 94): the trade must be legal now, and the club accepts when
 * what it receives is worth more to it than what it gives by a seeded margin. Depends only on the career at the
 * answering boundary and the offer, so save checks decide it again the same way.
 */
export function answerTradeProposal(context: TradeContext, proposal: Pick<TradeProposal, 'id' | 'fromClubId' | 'toClubId' | 'sends' | 'receives'>, date: string): TradeAnswer {
  const view = tradeView(context);
  const check = checkTrade(context, view, { clubId: proposal.fromClubId, playerIds: proposal.sends }, { clubId: proposal.toClubId, playerIds: proposal.receives });
  if (check.reason) return { accept: false, reason: check.reason, gain: null };
  const values = valueContext(context, view, date);
  const gain = tradeGain(values, proposal.toClubId, proposal.receives, proposal.sends);
  const margin = TRADE_RULES.managerMargin + TRADE_RULES.marginSpread * tradeUnit(context.seed, 'answer', proposal.id);
  if (gain >= margin) return { accept: true, reason: null, gain };
  return { accept: false, reason: gain >= 0 ? 'The club does not see enough gain in this trade for it.' : 'The club values the players it would give up more than the players offered.', gain };
}

export interface ComputerTradePlan { first: TradeSide; second: TradeSide }

/**
 * The computer clubs' trades at one fixed date (format 94): up to `count` trades, each found by a seeded search (an
 * initiating club, one or two of its players, a partner and one or two of the partner's players) where both clubs gain
 * by their own valuation and the trade is legal. The manager's club never takes part. Each player moves at most once
 * per date. Decided from the seed and the career at the boundary only.
 */
export function planComputerTrades(context: TradeContext, date: string, count: number): ComputerTradePlan[] {
  if (count <= 0 || !usesTrades(context)) return [];
  const view = tradeView(context);
  // The club the manager ran at this date (a save check reads a later state, whose manager may have moved or lost his job since).
  const excluded = managedClubAtRound(context, context.seasonNumber, Math.max(1, context.round - 1));
  const plans: ComputerTradePlan[] = [];
  let employment = context.employment;
  const moved = new Set<string>(), busy = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const current: TradeContext = { ...context, employment };
    const values = valueContext(current, view, date);
    const clubs = [...nbaClubIds(context.world!)].filter(clubId => clubId !== excluded && !busy.has(clubId)).sort((a, b) => tradeUnit(context.seed, 'club', context.seasonNumber, date, index, a) - tradeUnit(context.seed, 'club', context.seasonNumber, date, index, b) || (a < b ? -1 : 1));
    const plan = findTrade(current, values, view, clubs, date, index, moved);
    if (!plan) break;
    plans.push(plan);
    for (const id of [...plan.first.playerIds, ...plan.second.playerIds]) moved.add(id);
    busy.add(plan.first.clubId); busy.add(plan.second.clubId);
    employment = applyPlannedTrade(employment, view, plan);
  }
  return plans;
}

function findTrade(context: TradeContext, values: ValueContext, view: TradeView, clubs: readonly string[], date: string, index: number, moved: ReadonlySet<string>): ComputerTradePlan | null {
  const roster = (clubId: string) => (values.clubs.get(clubId)?.players ?? []).map(player => player.id).filter(id => !moved.has(id));
  const margin = (clubId: string) => TRADE_RULES.computerMargin + TRADE_RULES.computerMarginSpread * tradeUnit(context.seed, 'margin', context.seasonNumber, date, index, clubId);
  for (const initiator of clubs) {
    const own = roster(initiator);
    // The initiator offers the players it values least for what they would bring elsewhere: seeded among its squad.
    const offered = [...own].sort((a, b) => tradeUnit(context.seed, 'offer', context.seasonNumber, date, index, initiator, a) - tradeUnit(context.seed, 'offer', context.seasonNumber, date, index, initiator, b) || (a < b ? -1 : 1)).slice(0, 8);
    const partners = clubs.filter(clubId => clubId !== initiator);
    for (const out of offered) for (const partner of partners) {
      const theirs = roster(partner);
      const groups: string[][] = [[out]];
      const second = offered.find(id => id !== out && tradeUnit(context.seed, 'pair', context.seasonNumber, date, index, initiator, out, id) < 0.3);
      if (second) groups.push([out, second]);
      for (const sends of groups) for (const receive of theirs) for (const receives of [[receive], ...theirs.filter(id => id !== receive && tradeUnit(context.seed, 'pair', context.seasonNumber, date, index, partner, receive, id) < 0.15).map(id => [receive, id])]) {
        if (receives.length > 1 && sends.length > 1) continue;
        if (tradeGain(values, initiator, sends, receives) < margin(initiator) || tradeGain(values, partner, receives, sends) < margin(partner)) continue;
        const first = { clubId: initiator, playerIds: sends }, other = { clubId: partner, playerIds: receives };
        if (quickTradeFits(values, first, other) && ownerAllows(values, first, other) && !checkTrade(context, view, first, other).reason) return { first, second: other };
      }
    }
  }
  return null;
}

/** A trade's moves at a view, with released terms and the new contracts' ids from `nextIndex` (journal order: first side's players, then the second's). */
export function tradeMoves(employment: SeasonEmployment, view: TradeView, first: TradeSide, second: TradeSide, signed: { season: number; round: number }, nextIndex: number): { moves: TradeMove[]; contracts: EmploymentContract[] } {
  const moves: TradeMove[] = [], contracts: EmploymentContract[] = [];
  for (const [from, to] of [[first, second], [second, first]] as const) for (const playerId of from.playerIds) {
    const released = tradeReleasedContracts(employment, view, playerId, from.clubId);
    const added = tradeContracts(released, to.clubId, view, signed, nextIndex + contracts.length);
    moves.push({ playerId, fromClubId: from.clubId, toClubId: to.clubId, releasedContractIds: released.map(contract => contract.id), contractIds: added.map(contract => contract.id) });
    contracts.push(...added);
  }
  return { moves, contracts };
}

/** The signing boundary of a trade's contracts: in season the registration week, in the offseason the season's last week. */
export const tradeSigning = (context: WorldContext & Pick<SeasonState, 'seasonNumber' | 'round' | 'status'>): { season: number; round: number } => ({ season: context.seasonNumber, round: context.status === 'complete' ? seasonRounds(context) : context.round });

/** A planned trade applied to an employment record (used while searching several trades at one date). */
function applyPlannedTrade(employment: SeasonEmployment, view: TradeView, plan: ComputerTradePlan): SeasonEmployment {
  const { moves, contracts } = tradeMoves(employment, view, plan.first, plan.second, { season: view.season, round: view.round }, employment.contracts.length + 1);
  const trade: EmploymentTrade = { id: `employment-trade-${(employment.trades?.length ?? 0) + 1}`, seasonNumber: view.season, completedOn: '', startsSeason: view.season, startsRound: view.round, source: 'computer', clubIds: [plan.first.clubId, plan.second.clubId], moves };
  return { ...employment, contracts: [...employment.contracts, ...contracts], trades: [...(employment.trades ?? []), trade] };
}

/** Players' positions on a club now, for the trade screen. */
export const positionOf = (context: CareerPlayerContext, playerId: string): Position => getCareerPlayer(context, playerId).position;
export const tradeRating = ovrOf;
