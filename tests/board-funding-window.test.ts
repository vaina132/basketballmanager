import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';

let secondSeasonEnd: SeasonState;

beforeAll(() => {
  // Seed 36 (20 before the relationships-2 rules of format 66, 6 before the match calibration of sprint 4), all
  // automatic: when the second offseason window opens, an upgrade is booked and Danube Lynx then receive board capital
  // for theirs, so a capital receipt follows construction booked inside the window.
  let state = setEmploymentDelegation(setFacilityDelegation(createSeason({ seed: 36, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true), true);
  while (state.status === 'active') state = advanceMatchday(state);
  for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
  state = rolloverSeason(state);
  while (state.status === 'active') state = advanceMatchday(state);
  secondSeasonEnd = state;
}, 240_000);

describe('board capital inside an offseason window', () => {
  it('keeps the save valid when capital for one upgrade follows construction started in the same window', () => {
    const ledger = secondSeasonEnd.finance.ledger;
    const capital = ledger.findIndex(entry => entry.kind === 'board-capital' && entry.seasonNumber === 2 && entry.round === 10);
    expect(capital).toBeGreaterThan(0);
    expect(ledger.slice(0, capital).some(entry => entry.kind === 'facility' && entry.seasonNumber === 2 && entry.round === 10)).toBe(true);
    expect(parseSeason(serializeSeason(secondSeasonEnd))).toEqual(secondSeasonEnd);
  });
});
