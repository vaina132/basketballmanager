import { describe, expect, it } from 'vitest';
import type { AcademyGraduate, AcademyProspect, SeasonAcademy } from '../src/domain/academy';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { getActiveCareerPlayers, getCareerPlayer, getCareerPlayerAge, getCareerPlayers, getCareerWage } from '../src/world/player-catalog';
import { evaluateNegotiation, getNegotiationDemands } from '../src/world/negotiations-policy';

const prospect: AcademyProspect = {
  player: { ...DEVELOPMENT_PLAYERS[0]!, id: 'catalog-prospect', name: 'Academy Prospect', attributes: { twoPoint: 7, threePoint: 8, freeThrow: 9, passing: 8, defense: 7, rebounding: 6, stamina: 10 } },
  dateOfBirth: '2010-01-20', seasonWage: 1_000_000, clubId: 'rhine-falcons', intakeSeason: 2, intakeRound: 3,
};
const points = { twoPoint: 200, threePoint: 0, freeThrow: 0, passing: 0, defense: 0, rebounding: 0, stamina: 0 };
const graduate: AcademyGraduate = {
  id: 'graduate-1', prospectId: prospect.player.id, player: { ...prospect.player, attributes: { ...prospect.player.attributes, twoPoint: 9 } },
  dateOfBirth: prospect.dateOfBirth, seasonWage: prospect.seasonWage, clubId: prospect.clubId, availableSince: { seasonNumber: 3, round: 5 }, graduatedOn: '2028-10-07', kind: 'promotion', sourcePoints: points, offerId: 'inseason-offer-1', contractId: 'employment-contract-61',
};
const academy: SeasonAcademy = { model: 'academy-1', enabledSince: { seasonNumber: 2, round: 3, ledgerIndex: 0, contractCount: 60, negotiationCount: 0 }, prospects: [prospect], intakes: [], points: { [prospect.player.id]: points }, focus: { [prospect.player.id]: 'twoPoint' }, weeks: [], graduates: [graduate] };

describe('career-local senior player registry', () => {
  it('preserves the original catalog and wage API when no academy has been activated', () => {
    expect(getCareerPlayers({})).toBe(DEVELOPMENT_PLAYERS);
    for (const player of DEVELOPMENT_PLAYERS) {
      expect(getCareerPlayer({}, player.id)).toBe(player);
      expect(getCareerWage({}, player.id)).toBe(getSeasonWage(player.id));
    }
    expect(getCareerPlayers({ academy: { ...academy, enabledSince: null } })).toBe(DEVELOPMENT_PLAYERS);
  });

  it('keeps prospects out of ordinary recruitment until their recorded graduation boundary', () => {
    const before = { academy, seasonNumber: 3, round: 4 }, after = { ...before, round: 5 };
    expect(getCareerPlayers(before)).not.toContainEqual(graduate.player);
    expect(getCareerPlayer(before, prospect.player.id)).toBe(prospect.player);
    expect(getCareerPlayers(after).at(-1)).toBe(graduate.player);
    expect(getCareerPlayer(after, prospect.player.id).attributes.twoPoint).toBe(9);
    expect(getCareerPlayers(after, 3, 4)).toBe(DEVELOPMENT_PLAYERS);
    expect(getCareerPlayers(after, 2, 10)).toBe(DEVELOPMENT_PLAYERS);
    expect(getActiveCareerPlayers(before, 4, 1).some(player => player.id === graduate.player.id)).toBe(false);
    expect(getActiveCareerPlayers(after, 3, 4).some(player => player.id === graduate.player.id)).toBe(false);
    expect(getActiveCareerPlayers(after, 4, 1).some(player => player.id === graduate.player.id)).toBe(true);
  });

  it('rejects future or foreign intake identities and supplies calendar ages for existing prospects', () => {
    expect(() => getCareerPlayer({ academy, seasonNumber: 2, round: 2 }, prospect.player.id)).toThrow(/exists/);
    expect(() => getCareerWage({ seasonNumber: 3, round: 5 }, prospect.player.id)).toThrow(/exists/);
    expect(getCareerPlayerAge({ academy, seasonNumber: 2, round: 2 }, prospect.player.id, '2027-09-01')).toBeNull();
    expect(getCareerPlayerAge({ academy, seasonNumber: 2, round: 3 }, prospect.player.id, '2027-09-01')).toBe(17);
    expect(getCareerPlayerAge({}, 'missing', '2027-09-01')).toBeNull();
    expect(() => getCareerPlayers({ academy }, 0, 1)).toThrow(/boundary/);
  });

  it('does not leak players between two careers or mutate historical intake skill values', () => {
    const snapshot = structuredClone(academy);
    const context = { academy, seasonNumber: 4, round: 1 };
    expect(getCareerPlayer(context, prospect.player.id)).toBe(graduate.player);
    expect(() => getCareerPlayer({ academy: { ...academy, prospects: [], graduates: [] } }, prospect.player.id)).toThrow(/exists/);
    expect(getCareerPlayer(context, prospect.player.id, 2, 3).attributes.twoPoint).toBe(7);
    expect(academy).toEqual(snapshot);
    expect(DEVELOPMENT_PLAYERS).toHaveLength(60);
  });

  it('uses retained graduate salary demands for renewals without changing legacy demands', () => {
    const context = { academy, seasonNumber: 4, round: 1 };
    expect(getCareerWage(context, prospect.player.id)).toBe(1_000_000);
    expect(getNegotiationDemands(prospect.player.id, undefined, context).terms.map(term => term.seasonWage)).toEqual([1_000_000, 1_050_000, 1_100_000]);
    expect(evaluateNegotiation(prospect.player.id, 1_100_000, 3, undefined, context).outcome).toBe('accepted');
    expect(() => getNegotiationDemands(prospect.player.id)).toThrow(/exists/);
    const id = DEVELOPMENT_PLAYERS[0]!.id;
    expect(getNegotiationDemands(id, undefined, context)).toEqual(getNegotiationDemands(id));
  });
});
