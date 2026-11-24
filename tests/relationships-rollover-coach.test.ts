import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { SEASON_SCHEMA_VERSION } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateRelationships } from '../src/storage/relationships-validation';
import { moraleImpact } from '../src/world/coach-steering';
import { runContinueStep } from '../src/world/continue-step';
import { setEmploymentDelegation } from '../src/world/employment';
import { managerAttributes } from '../src/world/head-coaches';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { getPlayerRelationship } from '../src/world/relationships';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { testWorld } from './world-fixtures';

/**
 * Fix (formats 86-96, found in an NBA + Spain career after the season-3 rollover): the rollover freezes the new
 * season's first matchday before it records the manager's change of coaching attributes for the completed season, so
 * the frozen morale counts his Motivation without that change. The save check replayed that freeze with the change
 * already counted; when the change moved the Motivation impact (11 to 12 rounds 0 to +1), the save was refused.
 * The check now replays the rollover's freeze with the record as the game had it then; later matchdays are unchanged.
 */
describe('morale frozen at the season change and the manager\'s Motivation (format 86)', () => {
  let rolled: SeasonState;
  beforeAll(() => {
    let state = setEmploymentDelegation(createSeason({ seed: 31, world: testWorld(6), managedClubId: 'w0-atlantic-pilots', ...NEW_CAREER_SYSTEMS, manager: { name: 'Rollover Manager', dateOfBirth: '1980-05-01', nationality: 'Spain' } }), true);
    for (let guard = 0; guard < 2000 && state.status === 'active'; guard += 1) {
      if (state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
      const result = runContinueStep(state, { decided: true });
      state = 'outlook' in result ? (runContinueStep(state, { decided: true }) as { state: SeasonState }).state : result.state;
    }
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    expect(state.status).toBe('complete');
    expect(state.coaches?.model).toBe('coaches-2');
    // Motivation 11 (no morale effect, like the career's own start) before the season change.
    expect(moraleImpact(managerAttributes(state.coaches!)) === 0).toBe(true);
    const start = { ...state.coaches!.manager.start, motivation: 11 };
    rolled = rolloverSeason({ ...state, coaches: { ...state.coaches!, manager: { ...state.coaches!.manager, start } } });
  }, 1_800_000);

  it('accepts the freeze made before the manager\'s Motivation rose to 12, and still refuses a changed value', () => {
    // The completed season raised his Motivation to 12 (+1 morale from the new season's second matchday).
    const raised: SeasonState = { ...rolled, coaches: { ...rolled.coaches!, manager: { ...rolled.coaches!.manager, seasons: [{ seasonNumber: 1, changes: { motivation: 1 }, reasons: ['The players followed you all season.'] }] } } };
    expect(moraleImpact(managerAttributes(raised.coaches!, 2))).toBe(1);
    const frozen = raised.relationships.events.find(event => event.type === 'prepare' && event.seasonNumber === 2 && event.round === 1);
    if (frozen?.type !== 'prepare') throw new Error('The season change must freeze its first matchday.');
    const playerId = raised.clubs.find(club => club.id === raised.managedClubId)!.players.find(player => frozen.values[player.id]! < 100)!.id;
    expect(getPlayerRelationship(raised, playerId).morale).toBe(frozen.values[playerId]! + 1);
    expect(() => validateRelationships(raised, SEASON_SCHEMA_VERSION)).not.toThrow();
    const index = raised.relationships.events.indexOf(frozen);
    const forged: SeasonState = { ...raised, relationships: { ...raised.relationships, events: raised.relationships.events.map((event, at) => at === index ? { ...frozen, values: { ...frozen.values, [playerId]: frozen.values[playerId]! + 1 } } : event) } };
    expect(() => validateRelationships(forged, SEASON_SCHEMA_VERSION)).toThrow(/Freeze exact registered-player morale/);
  }, 600_000);
});
