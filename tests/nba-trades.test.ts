import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, dateForRound, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { addMarketDays, getMarketStartReason, getMarketWindow } from '../src/world/market-policy';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { clubContractsForRound, contractForRound, registrationChangeRounds } from '../src/world/employment-policy';
import { NBA_SALARY_CAP, usdToCents } from '../src/world/nba-cap';
import { answerTradeProposal, checkTrade, computerTradeDates, computerTradeTargets, TRADE_SALARY_EXTRA, tradeDeadline, tradeView, tradeWindowReason, type TradeSide } from '../src/world/trades-policy';
import { proposeTrade, quoteTradeProposal, withdrawTradeProposal } from '../src/world/trades';
import { worldOf } from '../src/world/career-world';

/**
 * NBA step 9 (provisional format 94): trades between NBA clubs. Salary matching over the cap, rosters of 13-15, the
 * trade deadline, the other club's seeded answer, contracts carried on as `trade` records with registration and wages
 * from the trade's week, strict save checks after trades (manager's and computer clubs'), 4-8 computer trades a season,
 * an offseason trade at the season change, the format guard and European careers left as they were.
 */
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const world = worldFromPack(nbaPack(), 'nba');
const BOS = 'nba-bos';
const fresh = (seed = 21) => createSeason({ seed, world, managedClubId: BOS, ...NEW_CAREER_SYSTEMS });
const wage = (state: SeasonState, playerId: string) => contractForRound(state.employment, playerId, state.seasonNumber, state.round)!.seasonWage;
const squad = (state: SeasonState, clubId: string) => { const view = tradeView(state); return clubContractsForRound(state.employment, view.season, view.round, clubId).map(contract => contract.playerId); };

/** The first 1-for-1 trade (in a fixed search order) the other club accepts, or declines, for the manager now. */
function findOffer(state: SeasonState, accept: boolean): { toClubId: string; sends: string[]; receives: string[] } {
  for (const toClubId of NBA_CLUB_IDS.filter(id => id !== BOS)) for (const send of squad(state, BOS)) for (const receive of squad(state, toClubId)) {
    if (quoteTradeProposal(state, toClubId, [send], [receive]).reason) continue;
    const offseason = state.status === 'complete';
    const answer = answerTradeProposal(offseason ? state : { ...state, round: state.round + 1 }, { id: `trade-proposal-${(state.trades?.proposals.length ?? 0) + 1}`, fromClubId: BOS, toClubId, sends: [send], receives: [receive] }, offseason ? addMarketDays(state.date, 1) : dateForRound(state.round + 1, state.seasonNumber));
    if (answer.accept === accept) return { toClubId, sends: [send], receives: [receive] };
  }
  throw new Error('No offer found.');
}

describe('trade rules', () => {
  const state = fresh();

  it('opens a world with NBA trades only with the NBA\'s money rules and keeps the offer journal', () => {
    expect(worldOf(state).nbaTrades).toBe(true);
    expect(state.trades).toEqual({ model: 'trades-1', proposals: [] });
  });

  it('closes trades after the deadline, the first Thursday of February, until the offseason after the draft', () => {
    expect(tradeDeadline(1)).toBe('2027-02-04');
    expect(tradeDeadline(2)).toBe('2028-02-03');
    expect(computerTradeDates(1)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15', '2027-02-04']);
    expect(tradeWindowReason(state)).toBeNull();
    expect(tradeWindowReason({ ...state, round: 22, date: dateForRound(22, 1) })).toBeNull();
    expect(tradeWindowReason({ ...state, round: 23, date: dateForRound(23, 1) })).toMatch(/trade deadline \(2027-02-04\) has passed/);
    for (const seed of [1, 2, 3, 21, 99]) {
      const total = [...computerTradeTargets(seed, 1).values()].reduce((sum, count) => sum + count, 0);
      expect(total).toBeGreaterThanOrEqual(4);
      expect(total).toBeLessThanOrEqual(8);
    }
  });

  it('makes a club over the cap match salary: at most 125% of what it sends plus $100,000', () => {
    expect(TRADE_SALARY_EXTRA).toBe(usdToCents(100_000));
    const view = tradeView(state);
    // A cheap player for an expensive one: the club taking the expensive one is over the cap afterwards.
    const bos = squad(state, BOS), nyk = squad(state, 'nba-nyk');
    const cheap = [...bos].sort((a, b) => wage(state, a) - wage(state, b))[0]!, dear = [...nyk].sort((a, b) => wage(state, b) - wage(state, a))[0]!;
    const refused = checkTrade(state, view, { clubId: BOS, playerIds: [cheap] }, { clubId: 'nba-nyk', playerIds: [dear] });
    const bosCheck = refused.clubs[0];
    expect(bosCheck.payrollAfter).toBeGreaterThan(NBA_SALARY_CAP);
    expect(bosCheck.maxIncoming).toBe(Math.floor(wage(state, cheap) * 1.25) + TRADE_SALARY_EXTRA);
    expect(refused.reason).toMatch(/125% of the salary it sends plus \$100,000/);
    // Within the limit (similar salaries) the trade is legal.
    const pairs = bos.flatMap(a => nyk.map(b => [a, b] as const)).filter(([a, b]) => wage(state, b) <= wage(state, a) * 1.25 + TRADE_SALARY_EXTRA && wage(state, a) <= wage(state, b) * 1.25 + TRADE_SALARY_EXTRA);
    expect(pairs.length).toBeGreaterThan(0);
    expect(checkTrade(state, view, { clubId: BOS, playerIds: [pairs[0]![0]] }, { clubId: 'nba-nyk', playerIds: [pairs[0]![1]] }).reason).toBeNull();
  });

  it('keeps NBA rosters at 13-15 players, 1-3 players a side, NBA clubs only', () => {
    const view = tradeView(state), bos = squad(state, BOS), nyk = squad(state, 'nba-nyk');
    expect(bos.length).toBe(15);
    const side = (clubId: string, ids: string[]): TradeSide => ({ clubId, playerIds: ids });
    expect(checkTrade(state, view, side(BOS, [bos[5]!]), side('nba-nyk', [nyk[5]!, nyk[6]!])).reason).toMatch(/13-15 players/);
    expect(checkTrade(state, view, side(BOS, bos.slice(0, 4)), side('nba-nyk', nyk.slice(0, 4))).reason).toMatch(/one to 3 players/);
    expect(checkTrade(state, view, side(BOS, [bos[0]!]), side(BOS, [bos[1]!])).reason).toMatch(/two different NAL clubs/);
    expect(checkTrade(state, view, side(BOS, [nyk[0]!]), side('nba-nyk', [bos[0]!])).reason).toMatch(/registered with his club/);
  });

  it('decides the other club\'s answer from the seed and the career only', () => {
    const offer = findOffer(state, true), declined = findOffer(state, false);
    const proposal = { id: 'trade-proposal-1', fromClubId: BOS, ...offer }, next = { ...state, round: 2 };
    const first = answerTradeProposal(next, proposal, dateForRound(2, 1));
    expect(answerTradeProposal(next, proposal, dateForRound(2, 1))).toEqual(first);
    expect(first.accept).toBe(true);
    const no = answerTradeProposal(next, { id: 'trade-proposal-1', fromClubId: BOS, ...declined }, dateForRound(2, 1));
    expect(no.accept).toBe(false);
    expect(no.reason).toMatch(/values the players|enough gain/);
  });
});

describe('a manager\'s trade during the season', () => {
  let before: SeasonState, after: SeasonState, offer: ReturnType<typeof findOffer>, declinedState: SeasonState;
  beforeAll(() => {
    let state = fresh();
    while (state.round < 8) state = play(state);
    offer = findOffer(state, true);
    before = proposeTrade(state, offer.toClubId, offer.sends, offer.receives);
    after = play(before);
    while (after.round === before.round) after = play(after);
    const lopsided = findOffer(after, false);
    declinedState = play(proposeTrade(after, lopsided.toClubId, lopsided.sends, lopsided.receives));
    while (declinedState.round === after.round) declinedState = play(declinedState);
  }, 1_800_000);

  it('waits for the answer, allows one open offer and lets the manager withdraw it', () => {
    expect(before.trades!.proposals.at(-1)).toMatchObject({ status: 'pending', phase: 'season', round: 8, answerOn: dateForRound(9, 1) });
    expect(quoteTradeProposal(before, offer.toClubId, offer.sends, offer.receives).reason).toMatch(/Wait for the answer/);
    expect(withdrawTradeProposal(before, 'trade-proposal-1').trades!.proposals[0]!.status).toBe('withdrawn');
  });

  it('completes the accepted trade at the next week, carrying the contracts on as trade records', () => {
    const proposal = after.trades!.proposals[0]!;
    expect(proposal).toMatchObject({ status: 'completed', settledOn: dateForRound(9, 1), reason: null });
    const trade = after.employment.trades!.find(item => item.id === proposal.tradeId)!;
    expect(trade).toMatchObject({ source: 'manager', proposalId: proposal.id, startsSeason: 1, startsRound: 9, clubIds: [BOS, offer.toClubId] });
    for (const move of trade.moves) {
      const released = move.releasedContractIds.map(id => after.employment.contracts.find(contract => contract.id === id)!);
      const carried = move.contractIds.map(id => after.employment.contracts.find(contract => contract.id === id)!);
      // The old records stay; each new `trade` record keeps the wage, the end season and the clauses.
      expect(released.every(contract => before.employment.contracts.some(item => item.id === contract.id))).toBe(true);
      carried.forEach((contract, index) => expect(contract).toMatchObject({ kind: 'trade', clubId: move.toClubId, seasonWage: released[index]!.seasonWage, endsSeason: released[index]!.endsSeason, signedRound: 9 }));
      expect(contractForRound(after.employment, move.playerId, 1, 8)!.clubId).toBe(move.fromClubId);
      expect(contractForRound(after.employment, move.playerId, 1, 9)!.clubId).toBe(move.toClubId);
      expect(after.clubs.find(club => club.id === move.toClubId)!.players.some(player => player.id === move.playerId)).toBe(true);
      // Wages: the former club pays through week 8, the new club from week 9.
      expect(after.payroll.agreements.some(agreement => agreement.id === `wage-s1-${move.playerId}-r9` && agreement.clubId === move.toClubId)).toBe(true);
    }
    expect(registrationChangeRounds(after.employment, 1, after.round)).toContain(9);
    expect(after.rosters.some(roster => roster.id === `roster-s1-${BOS}-r9`)).toBe(true);
    expect(clubContractsForRound(after.employment, 1, 9, BOS).length).toBe(15);
  });

  it('records a declined offer with the club\'s reason', () => {
    const proposal = declinedState.trades!.proposals.at(-1)!;
    expect(proposal.status).toBe('declined');
    expect(proposal.reason).toMatch(/values the players|enough gain/);
    expect(proposal.tradeId).toBeNull();
  });

  it('passes the strict check mid-season after the trade and refuses a changed traded wage', () => {
    for (const state of [before, after, declinedState]) expect(serializeSeason(parseSeason(serializeSeasonCompact(state)))).toBe(serializeSeason(state));
    const tampered = JSON.parse(serializeSeason(after));
    const contract = tampered.state.employment.contracts.find((item: { kind: string }) => item.kind === 'trade');
    contract.seasonWage += 50_000;
    expect(() => parseSeason(JSON.stringify(tampered))).toThrow(/Invalid season save/);
    const forged = JSON.parse(serializeSeason(declinedState));
    forged.state.trades.proposals.at(-1).reason = 'Something else.';
    expect(() => parseSeason(JSON.stringify(forged))).toThrow(/other club's answer/);
  });
});

describe('computer trades over a season and an offseason trade', () => {
  let season: SeasonState, offseason: SeasonState, next: SeasonState;
  beforeAll(() => {
    let state = setEmploymentDelegation(fresh(21), true);
    while (state.status === 'active') state = play(state);
    season = state;
    const window = getMarketWindow(state)!;
    while (state.date < window.closesOn && tradeWindowReason(state)) state = advanceMarket(state);
    const offer = findOffer({ ...state }, true);
    state = proposeTrade(state, offer.toClubId, offer.sends, offer.receives);
    state = advanceMarket(state);
    offseason = state;
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    next = rolloverSeason(state);
  }, 3_600_000);

  it('has 4-8 legal computer trades a season at the fixed dates, never with the manager\'s club', () => {
    const trades = season.employment.trades!.filter(trade => trade.source === 'computer');
    console.log(`computer trades in season 1: ${trades.length} (${trades.map(trade => `r${trade.startsRound} ${trade.clubIds.join('/')} ${trade.moves.length}`).join('; ')})`);
    expect(trades.length).toBeGreaterThanOrEqual(4);
    expect(trades.length).toBeLessThanOrEqual(8);
    expect(trades.every(trade => !trade.clubIds.includes(BOS))).toBe(true);
    expect(trades.every(trade => trade.startsRound <= 23)).toBe(true);
    for (const round of new Set(trades.map(trade => trade.startsRound))) for (const clubId of NBA_CLUB_IDS) {
      const size = clubContractsForRound(season.employment, 1, round, clubId).length;
      expect(size).toBeGreaterThanOrEqual(13);
      expect(size).toBeLessThanOrEqual(15);
    }
    expect(() => parseSeason(serializeSeasonCompact(season))).not.toThrow();
  });

  it('agrees an offseason trade the next day and completes it when the new season starts', () => {
    const proposal = offseason.trades!.proposals.at(-1)!;
    expect(proposal).toMatchObject({ phase: 'offseason', status: 'agreed' });
    expect(() => parseSeason(serializeSeasonCompact(offseason))).not.toThrow();
    const settled = next.trades!.proposals.at(-1)!;
    expect(['completed', 'called-off']).toContain(settled.status);
    if (settled.status === 'completed') {
      const trade = next.employment.trades!.find(item => item.id === settled.tradeId)!;
      expect(trade).toMatchObject({ startsSeason: 2, startsRound: 1, seasonNumber: 1 });
      for (const move of trade.moves) expect(next.clubs.find(club => club.id === move.toClubId)!.players.some(player => player.id === move.playerId)).toBe(true);
    }
    expect(serializeSeason(parseSeason(serializeSeasonCompact(next)))).toBe(serializeSeason(next));
  });
});

describe('the format guard and European careers', () => {
  it('refuses NBA trades in saves before format 94', () => {
    const state = fresh(5);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 92; envelope.state.schemaVersion = 92;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/format 9[345] or later/);  // The format-93 moves and format-95 draft markers are refused first.
    expect(() => createSeason({ seed: 3, world, managedClubId: BOS, ...NEW_CAREER_SYSTEMS, nbaTrades: 'yes' as unknown as boolean })).toThrow(/NAL trades/);
  });

  it('keeps worlds without the NBA, and NBA careers without the option, free of trades', () => {
    const spain = worldFromPack(economyPack([{ id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] }]), 'acb');
    const european = createSeason({ seed: 3, world: spain, managedClubId: spain.clubs[0]!.id, ...NEW_CAREER_SYSTEMS });
    expect(european.trades).toBeUndefined();
    expect(worldOf(european).nbaTrades).toBeUndefined();
    const without = createSeason({ seed: 3, world, managedClubId: BOS, ...NEW_CAREER_SYSTEMS, nbaTrades: false });
    expect(without.trades).toBeUndefined();
    expect(() => parseSeason(serializeSeason(without))).not.toThrow();
  });
});
