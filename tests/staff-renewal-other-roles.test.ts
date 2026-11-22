import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { ASSISTANT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMarket, type StaffMarketScope } from '../src/data/staff-directory';
import { getClubAssistant } from '../src/world/assistant-policy';
import { replaceAssistant } from '../src/world/assistant';
import { getClubFitnessCoach } from '../src/world/fitness-policy';
import { replaceFitnessCoach } from '../src/world/fitness';
import { getClubPhysio } from '../src/world/physio-policy';
import { replacePhysio } from '../src/world/physio';
import { getClubScouts, quoteScoutHire } from '../src/world/scout-policy';
import { replaceScout } from '../src/world/scouts';
import { getClubYouthCoach } from '../src/world/youth-policy';
import { replaceYouthCoach } from '../src/world/youth';
import { lowerDivisionClubIds } from '../src/world/career-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { withChosenTerm } from '../src/world/staff-contracts';
import { staffMarketWorld } from '../src/world/staff-levels';
import { economyPack } from './helpers/economy-pack';

/**
 * Follow-up of the live season-change bug (22 November 2026, `tests/staff-renewal-promotion.test.ts`): clubs promoted
 * from a country's next division have no country in the world, so the new season's local staff pools are shorter. A
 * scout, fitness coach, physio, assistant or youth coach hired from the end of a pool dropped out of the market at the
 * rollover and was silently not renewed while still under contract, against the owner's decision that staff under
 * contract stay (format 76). A renewal now only needs him free; new hires still need the market.
 */
// Greece's top division (14 clubs, the last relegated) is the smallest real league with a next division (the Elite League).
const levels = [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 9];
const pack = economyPack([{ id: 'gbl', name: 'Greek Basket League', country: 'Greece', tier: 1, levels }], null, 12);
const world = worldFromPack({ ...pack, players: pack.players.map(player => ({ ...player, nationality: 'Greece' })) }, 'gbl');
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

/** The people of a directory the market loses when one Greek club of the full world is counted without a country. */
function dropping(directory: readonly { id: string }[], scope: StaffMarketScope): string[] {
  const shorter = new Set(staffMarket(directory, { ...scope, countries: scope.countries!.map((country, index) => index === 0 ? null : country) }).map(person => person.id));
  return staffMarket(directory, scope).filter(person => !shorter.has(person.id)).map(person => person.id);
}

interface Role {
  name: string;
  directory: readonly { id: string }[];
  /** The manager's club's person in this role, by contract and person. */
  held: (state: SeasonState) => { contractId: string; personId: string } | null;
  replace: (state: SeasonState, contractId: string, personId: string) => SeasonState;
}
const ROLES: Role[] = [
  { name: 'scout', directory: SCOUT_DIRECTORY, held: state => { const contract = getClubScouts(state)[0]; return contract ? { contractId: contract.id, personId: contract.scoutId } : null; }, replace: replaceScout },
  { name: 'fitness coach', directory: FITNESS_DIRECTORY, held: state => { const contract = getClubFitnessCoach(state); return contract ? { contractId: contract.id, personId: contract.coachId } : null; }, replace: replaceFitnessCoach },
  { name: 'physio', directory: PHYSIO_DIRECTORY, held: state => { const contract = getClubPhysio(state); return contract ? { contractId: contract.id, personId: contract.physioId } : null; }, replace: replacePhysio },
  { name: 'assistant', directory: ASSISTANT_DIRECTORY, held: state => { const contract = getClubAssistant(state); return contract ? { contractId: contract.id, personId: contract.assistantId } : null; }, replace: replaceAssistant },
  { name: 'youth coach', directory: YOUTH_COACH_DIRECTORY, held: state => { const contract = getClubYouthCoach(state); return contract ? { contractId: contract.id, personId: contract.coachId } : null; }, replace: replaceYouthCoach },
];

describe('non-coach staff renewals when promoted clubs join', () => {
  it('keeps the manager\'s scout, fitness coach, physio, assistant and youth coach from the end of the local pools, passing the strict check', () => {
    expect(lowerDivisionClubIds(world).size).toBeGreaterThan(0);
    // Careers before format 85 (no `clubCountries`) give promoted clubs no country, so their local pools shrink.
    let state = setEmploymentDelegation(createSeason({ seed: 7, world, managedClubId: 'gbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, clubCountries: false }), true);
    expect(state.coaching.model).toBe('coaching-4');
    const scope = staffMarketWorld(state);
    // The manager replaces each opening staff member with someone the market will lose, on a two-season contract.
    const hired = new Map<string, string>();
    for (const role of ROLES) {
      const held = role.held(state);
      expect(held, role.name).not.toBeNull();
      // The first candidate whose replacement the club's money allows (the quote also needs the place free).
      const person = dropping(role.directory, scope).find(candidate => { try { role.replace(state, held!.contractId, candidate); return true; } catch { return false; } });
      expect(person, role.name).toBeDefined();
      state = withChosenTerm(role.replace(state, held!.contractId, person!), person!, 2);
      hired.set(role.name, person!);
    }
    expect(roundTrip(state)).toEqual(state);
    while (state.status === 'active') state = play(state);
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    const before = state;
    state = rolloverSeason(state);
    // Clubs from the next division joined, and the new season's markets no longer list the manager's staff.
    expect(state.clubs.some(club => lowerDivisionClubIds(world).has(club.id) && !before.clubs.some(old => old.id === club.id))).toBe(true);
    const next = staffMarketWorld(state);
    for (const role of ROLES) {
      const person = hired.get(role.name)!;
      expect(staffMarket(role.directory, next).some(candidate => candidate.id === person), role.name).toBe(false);
      // He stays at the manager's club for the season his contract still covers.
      expect(role.held(state)?.personId, role.name).toBe(person);
    }
    // Nobody holds two jobs in any role.
    const active = <C extends { seasonNumber: number; releasedRound: number | null }>(contracts: C[], person: (contract: C) => string) => contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(person);
    for (const people of [active(state.scouts.contracts, contract => contract.scoutId), active(state.fitness.contracts, contract => contract.coachId), active(state.physio.contracts, contract => contract.physioId), active(state.assistant.contracts, contract => contract.assistantId), active(state.youth.contracts, contract => contract.coachId)]) {
      expect(new Set(people).size).toBe(people.length);
    }
    expect(roundTrip(state)).toEqual(state);
    const week = play(state);
    expect(roundTrip(week)).toEqual(week);
  }, 900_000);

  it('keeps the market check for new hires, and for renewals in careers without staff contracts (their rollovers unchanged)', () => {
    const state = createSeason({ seed: 7, world, managedClubId: 'gbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    expect(getClubScouts(state).length).toBeLessThan(3);
    const market = new Set(staffMarket(SCOUT_DIRECTORY, staffMarketWorld(state)).map(scout => scout.id));
    const outside = SCOUT_DIRECTORY.find(scout => !market.has(scout.id) && !state.scouts.contracts.some(contract => contract.scoutId === scout.id))!;
    const taken = 'This scout already has an active club contract.';
    expect(quoteScoutHire(state, outside.id).reason).toBe(taken);
    expect(quoteScoutHire(state, outside.id, state.managedClubId, true).reason).not.toBe(taken);
    // Format 74-75 careers ('coaching-2', 'coaching-3') renew only staff the market lists, as before.
    for (const model of ['coaching-2', 'coaching-3'] as const) expect(quoteScoutHire({ ...state, coaching: { ...state.coaching, model } }, outside.id, state.managedClubId, true).reason).toBe(taken);
  });
});
