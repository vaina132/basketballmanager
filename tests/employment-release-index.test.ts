import { describe, expect, it } from 'vitest';
import type { EmploymentContract, SeasonEmployment } from '../src/domain/employment';
import type { EmploymentTrade } from '../src/domain/trades';
import { effectiveContractsForRound, markSequentialContracts, playerContractsForRound, tradeReleases } from '../src/world/employment-policy';

/**
 * The faster registration readers the save checks use (23 November 2026) give exactly what the general readers give:
 * one player's terms at a week, and the trade releases of a contract prefix (marked sequential or not).
 */
const contract = (index: number, playerId: string, clubId: string, startsSeason: number, endsSeason: number, startsRound = 1, kind: EmploymentContract['kind'] = 'free-agent'): EmploymentContract => ({ id: `employment-contract-${index}`, playerId, clubId, startsSeason, endsSeason, startsRound, seasonWage: 100_000, signedSeason: Math.max(1, startsSeason - 1), signedRound: 10, kind });

const contracts: EmploymentContract[] = [
  contract(1, 'p1', 'a', 1, 3, 1, 'initial'),
  contract(2, 'p2', 'a', 1, 2, 1, 'initial'),
  contract(3, 'p3', 'b', 1, 4, 1, 'initial'),
  contract(4, 'p4', 'b', 1, 1, 1, 'initial'),
  contract(5, 'p1', 'b', 2, 3, 6, 'midseason-transfer'),
  contract(6, 'p2', 'c', 2, 2, 1, 'transfer'),
  contract(7, 'p4', 'c', 2, 3),
  contract(8, 'p3', 'a', 2, 4, 9, 'trade'),
  contract(9, 'p4', 'a', 3, 3, 1, 'trade'),
  contract(10, 'p5', 'c', 3, 4),
];
const trades: EmploymentTrade[] = [
  { id: 'employment-trade-1', seasonNumber: 2, completedOn: '2027-01-01', startsSeason: 2, startsRound: 9, source: 'computer', clubIds: ['b', 'a'], moves: [{ playerId: 'p3', fromClubId: 'b', toClubId: 'a', releasedContractIds: ['employment-contract-3'], contractIds: ['employment-contract-8'] }] } as unknown as EmploymentTrade,
  { id: 'employment-trade-2', seasonNumber: 2, completedOn: '2027-07-01', startsSeason: 3, startsRound: 1, source: 'computer', clubIds: ['c', 'a'], moves: [{ playerId: 'p4', fromClubId: 'c', toClubId: 'a', releasedContractIds: ['employment-contract-7'], contractIds: ['employment-contract-9'] }] } as unknown as EmploymentTrade,
];
const employment = (count: number): SeasonEmployment => {
  const held = contracts.slice(0, count), ids = new Set(held.map(item => item.id));
  return {
    model: 'employment-1', enabledSince: { seasonNumber: 1, round: 1 }, delegated: true, market: null, contracts: held,
    transfers: [
      { id: 'employment-transfer-1', offerId: 'o1', playerId: 'p1', fromClubId: 'a', toClubId: 'b', seasonNumber: 2, completedOn: '2026-12-01', startsSeason: 2, startsRound: 6, fee: 0, releasedContractIds: ['employment-contract-1'], contractId: 'employment-contract-5' },
      { id: 'employment-transfer-2', offerId: 'o2', playerId: 'p2', fromClubId: 'a', toClubId: 'c', seasonNumber: 1, completedOn: '2026-07-01', startsSeason: 2, startsRound: 1, fee: 0, mode: 'loan', releasedContractIds: ['employment-contract-2'], contractId: 'employment-contract-6' },
    ].filter(item => ids.has(item.contractId)) as SeasonEmployment['transfers'],
    buyouts: count >= 10 ? [{ id: 'employment-buyout-1', playerId: 'p5', clubId: 'c', seasonNumber: 3, completedOn: '2028-07-01', startsSeason: 4, amount: 1, releasedContractIds: ['employment-contract-10'], contractCountBefore: 10, negotiationCountBefore: 0 }] : [],
    departures: [{ clubId: 'b', seasonNumber: 3, startsSeason: 4, releasedContractIds: ['employment-contract-3'] }],
    trades,
  };
};

describe('registration readers for save checks', () => {
  it('give one player\'s terms at every week exactly as the whole registration does', () => {
    for (let count = 1; count <= contracts.length; count += 1) {
      const record = employment(count);
      for (let season = 1; season <= 5; season += 1) for (let round = 1; round <= 12; round += 1) {
        const all = effectiveContractsForRound(record, season, round);
        for (const playerId of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) expect(playerContractsForRound(record, playerId, season, round)).toEqual(all.filter(item => item.playerId === playerId));
      }
    }
  });

  it('count a trade release only once its carrying contract is held, marked sequential or not', () => {
    for (let count = 0; count <= contracts.length; count += 1) {
      const plain = tradeReleases(employment(count));
      const marked = tradeReleases({ ...employment(count), contracts: markSequentialContracts(contracts.slice(0, count)) });
      expect(marked).toEqual(plain);
      expect(plain.map(release => release.contractId)).toEqual([...(count >= 8 ? ['employment-contract-3'] : []), ...(count >= 9 ? ['employment-contract-7'] : [])]);
    }
    // Identities out of sequence are still found by looking them up.
    const shuffled = [contracts[7]!, ...contracts.slice(0, 7)];
    expect(tradeReleases({ ...employment(8), contracts: shuffled }).map(release => release.contractId)).toEqual(['employment-contract-3']);
  });

  it('see a record with the same contract list but other trades afresh', () => {
    const record = employment(10);
    expect(tradeReleases(record)).toHaveLength(2);
    expect(tradeReleases({ ...record, trades: trades.slice(0, 1) })).toHaveLength(1);
    expect(tradeReleases({ ...record, trades: [] })).toHaveLength(0);
  });
});
