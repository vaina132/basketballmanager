import { describe, expect, it } from 'vitest';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';

const manager = { name: 'Options Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };

describe('named career options', () => {
  it('lists every optional system once and cannot be changed at runtime', () => {
    expect(Object.keys(NEW_CAREER_SYSTEMS)).toHaveLength(52);
    expect(Object.values(NEW_CAREER_SYSTEMS).every(Boolean)).toBe(true);
    expect(Object.isFrozen(NEW_CAREER_SYSTEMS)).toBe(true);
  });

  it('creates exactly the positional career for defaults, a full new career and a partial setup', () => {
    expect(createSeason({})).toEqual(createSeason());
    // The New career screen's former positional call: every flag after the manager enabled.
    const fullPositional = createSeason(227, 'rhine-falcons', 'standard', true, true, true, true, manager, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
    // Sponsorship negotiations, board funding, board verdicts press and media (format 67) and naming rights (format 64) and president personalities (format 70) and six-level facilities with the bank loan (format 74) postdate the positional form, so they are reachable only by name.
    expect(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, injuryLengths: false, staffing: false, commercial: false, boardFunding: false, boardConsequences: false, rivalries: false, facilityMaintenance: false, careerMoves: false, media: false, namingRights: false, presidents: false, simpleFacilities: false, calmPlayingTime: false, transferLists: false, scoutNetwork: false, matchPlays: false })).toEqual(fullPositional);
    const named = createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS });
    expect([named.commercial.enabledSince, named.facilities.fundingSince, named.board.consequencesSince].every(anchor => anchor !== null)).toBe(true);
    expect(named.media).toEqual({ model: 'media-1', since: { seasonNumber: 1, round: 1, date: named.date } });
    expect(named.board.model).toBe('board-2');
    // Format 74: every club starts staffed (also reachable only by name).
    // Format 76: staff contracts with weekly salaries (also reachable only by name).
    expect(named.coaching.model).toBe('coaching-4');
    expect(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, staffContracts: false }).coaching.model).toBe('coaching-3');
    // Format 77: calmer playing time (also reachable only by name).
    expect(named.relationships.model).toBe('relationships-4');
    // Format 78: the transfer and loan list and the scouting network (also reachable only by name).
    expect([named.recruitment.model, named.scouting.model]).toEqual(['recruitment-2', 'scouting-2']);
    // Format 79: the richer play model (also reachable only by name).
    expect(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, matchFlow: false }).matchModel).toBe('plays-2');
    // Format 81: the dead balls of a real game (also reachable only by name).
    expect([named.matchModel, named.activeMatch?.playModel]).toEqual(['plays-3', 'plays-3']);
    // Format 75: player wages and staff fees share one pool (also reachable only by name).
    const pooled = createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, wagePool: false });
    expect(pooled.coaching.model).toBe('coaching-2');
    // Format 84: computer clubs always fill every staff role (careers with the wage pool only; also reachable only by name).
    expect(named.coaching.fullStaff).toBe(true);
    expect(Object.hasOwn(pooled.coaching, 'fullStaff')).toBe(false);
    expect(Object.hasOwn(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, fullStaff: false }).coaching, 'fullStaff')).toBe(false);
    expect(createSeason({ seed: 9, managedClubId: 'aegean-waves', injuryMode: 'off', training: false, coaching: false, employment: true, negotiations: true, board: true }))
      .toEqual(createSeason(9, 'aegean-waves', 'off', false, false, true, true, null, true, false, true, false, false, false, false, false, false, false, false, false, false, false, true));
  });

  it('keeps payroll tied to finances unless stated, as the positional defaults do', () => {
    expect(createSeason({ finance: false })).toEqual(createSeason(42, undefined, undefined, true, true, false));
    expect(createSeason({ finance: false }).payroll.enabledSince).toBeNull();
  });

  it('rejects unknown option names and mixed calling styles instead of silently ignoring them', () => {
    expect(() => createSeason({ bord: true } as never)).toThrow('Unsupported career options: bord.');
    expect(() => (createSeason as (...args: unknown[]) => unknown)({ seed: 1 }, 'rhine-falcons')).toThrow(/extra positional arguments/);
  });

  it('applies the same validation messages as the positional form', () => {
    expect(() => createSeason({ finance: false, payroll: false, assistant: true })).toThrow(/finances/i);
    expect(() => createSeason({ academy: true })).toThrow('The academy requires finances, payroll, employment and negotiations.');
    expect(() => createSeason({ seed: -1 })).toThrow(/season seed/);
    expect(() => createSeason({ assistant: 'yes' as never })).toThrow(/assistant/i);
  });
});
