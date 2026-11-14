import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { registrationChangeRounds, getContractedClubsForRound } from '../src/world/employment-policy';
import { createRosterSnapshots, rosterForRound } from '../src/world/rosters';
import { parseSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { currentSeasonFile } from './helpers/season-format';

const names = ['season23-staff-rehabilitation-transfer-next', 'season24-assistant-rehabilitation-transfer-next', 'season25-academy-career-next',
  'season25-academy-year4', 'season28-facilities-career-next', 'season43-board-complete', 'season43-board-opening'];
const fixtures = [];
beforeAll(() => {
  for (const name of names) {
    const text = gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
    fixtures.push({ name, original: JSON.parse(text).state, restored: parseSeason(text) });
  }
}, 120_000);

// Reference behavior walks every matchday, independent of the optimized storage reconstruction.
function reconstruct(state, year, rounds) {
  const at = round => getContractedClubsForRound(state, year, round);
  const rosters = createRosterSnapshots(at(1), year);
  for (const round of rounds) for (const club of at(round)) {
    if (!isDeepStrictEqual(rosterForRound(rosters, club.id, round).players, club.players)) {
      rosters.push({ id: `roster-s${year}-${club.id}-r${round}`, clubId: club.id, fromRound: round, players: structuredClone(club.players) });
    }
  }
  return rosters;
}

describe('registration replay at actual change boundaries', () => {
  it.each(names)('preserves genuine %s rosters and agrees with walking every historical matchday', name => {
    const { original, restored } = fixtures.find(item => item.name === name);
    expect(restored.rosters).toEqual(original.rosters);
    expect(restored.history.map(year => year.rosters)).toEqual(original.history.map(year => year.rosters));
    for (let year = 1; year <= restored.seasonNumber; year++) {
      const through = year === restored.seasonNumber ? restored.round : 10;
      for (let round = 1; round <= through; round++) {
        const everyRound = Array.from({ length: round - 1 }, (_, index) => index + 2);
        const changes = registrationChangeRounds(restored.employment, year, round);
        expect(reconstruct(restored, year, changes)).toEqual(reconstruct(restored, year, everyRound));
      }
    }
    expect(parseSeason(serializeSeasonCompact(restored))).toEqual(restored);
  });

  it('sorts distinct effective starts, including departure-only boundaries, without changing journal order', () => {
    const employment = { contracts: [
      { startsSeason: 2, startsRound: 8 }, { startsSeason: 2, startsRound: 3 },
      { startsSeason: 2 }, { startsSeason: 1, startsRound: 4 }, { startsSeason: 3, startsRound: 2 },
    ], transfers: [{ startsSeason: 2, startsRound: 6 }, { startsSeason: 2, startsRound: 3 }] };
    const before = structuredClone(employment);
    expect(registrationChangeRounds(employment, 2, 1)).toEqual([]);
    expect(registrationChangeRounds(employment, 2, 5)).toEqual([3]);
    expect(registrationChangeRounds(employment, 2, 10)).toEqual([3, 6, 8]);
    expect(employment).toEqual(before);
    employment.contracts.push({ startsSeason: 2, startsRound: 5 });
    expect(registrationChangeRounds(employment, 2, 10)).toEqual([3, 5, 6, 8]);
  });

  it.each(['contract date', 'transfer date', 'missing arrival', 'changed shirt', 'extra unchanged snapshot'])('still rejects %s after validating the same object', damage => {
    const source = fixtures.find(item => item.name === (damage === 'extra unchanged snapshot' ? 'season43-board-complete' : 'season24-assistant-rehabilitation-transfer-next')).restored;
    const state = structuredClone(source);
    validateSeasonState(state);
    if (damage === 'contract date') {
      const contract = state.employment.contracts.find(item => item.startsSeason === state.seasonNumber && item.startsRound > 1);
      expect(contract).toBeDefined(); contract.startsRound += 1;
    } else if (damage === 'transfer date') {
      const transfer = state.employment.transfers.find(item => item.startsSeason === state.seasonNumber && item.startsRound > 1);
      expect(transfer).toBeDefined(); transfer.startsRound += 1;
    } else if (damage === 'extra unchanged snapshot') {
      const changes = registrationChangeRounds(state.employment, state.seasonNumber, state.round);
      const round = Array.from({ length: state.round - 1 }, (_, index) => index + 2).find(round => !changes.includes(round));
      expect(round).toBeDefined();
      const previous = rosterForRound(state.rosters, state.clubs[0].id, round);
      state.rosters.push({ ...structuredClone(previous), id: `roster-s${state.seasonNumber}-${previous.clubId}-r${round}`, fromRound: round });
    } else {
      const index = state.rosters.findIndex(item => item.fromRound > 1);
      expect(index).toBeGreaterThanOrEqual(0);
      if (damage === 'missing arrival') state.rosters.splice(index, 1);
      else state.rosters[index].players[0].number += 1;
    }
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(currentSeasonFile(state))).toThrow();
  });
});
