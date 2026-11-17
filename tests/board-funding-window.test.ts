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
  // Seed 5 (28 before the manager's planned starting five of 16 November 2026, 4 before format 66's squad-rank roles
  // and contract requests, 32 with facilities alone, 26 with naming rights alone, 6 before sprint 4's match calibration),
  // all automatic: when the second offseason window opens, one club starts a project and another then receives board
  // capital for its own, so a capital receipt follows construction booked inside the window.
// Seed-found scenario from before every club started with staff (format 74): it keeps the earlier staffing.
  let state = setEmploymentDelegation(setFacilityDelegation(createSeason({ seed: 5, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, staffing: false, simpleFacilities: false }), true), true);
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
