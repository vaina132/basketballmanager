import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setMaintenancePlan, startFacilityUpgrade } from '../src/world/facilities';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { conditionLabel, FacilitiesPanel } from '../src/ui/FacilitiesPanel';
import { advanceMatchday } from './helpers/board-funding';

const noop = () => {};
const render = (season: SeasonState) => renderToStaticMarkup(<FacilitiesPanel season={season} onEnableFacilities={noop} onFacilityUpgrade={noop} onCancelFacilityUpgrade={noop} onFacilityDelegation={noop} onRequestBoardFunding={noop} onEnableMaintenance={noop} onMaintenancePlan={noop} />);
/** These are the upkeep rules of older careers (`facilities-1`); new careers wear and repair instead (tests/facility-repairs.test.ts). */
const legacy = (state: SeasonState): SeasonState => ({ ...state, facilities: { ...state.facilities, model: 'facilities-1' } });
const career = (facilityMaintenance: boolean) => legacy(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'off', manager: { name: 'Upkeep Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, simpleFacilities: false, facilityMaintenance }));
let chosen: SeasonState, worn: SeasonState;

beforeAll(() => {
  let state = startFacilityUpgrade(career(true), 'training');
  while (state.round < 4) state = advanceMatchday(state);
  chosen = setMaintenancePlan(state, 'reduced');
  worn = chosen;
  while (worn.round < 8) worn = advanceMatchday(worn);
}, 120_000);

describe('facility upkeep screens', () => {
  it('labels condition bands', () => {
    expect([100, 80, 79, 50, 49].map(conditionLabel)).toEqual(['Good', 'Good', 'Worn', 'Worn', 'Poor']);
  });

  it('offers older careers the upkeep choice', () => {
    const html = render(career(false));
    expect(html).toMatch(/id="enable-facility-maintenance"[^>]*>Enable upkeep choices/);
    expect(html).not.toContain('id="facility-upkeep"');
  });

  it('shows the chosen plan, when it starts, and each upgraded facility\'s condition', () => {
    const pending = render(chosen);
    expect(pending).toContain('data-maintenance-plan="reduced"');
    expect(pending).toContain('aria-valuetext="Reduced"');
    expect(pending).toContain('Reduced upkeep starts with the next matchday.');
    expect(pending).toContain('data-facility-condition="100"');
    const html = render(worn);
    expect(html).not.toContain('starts with the next matchday');
    expect(html).toContain('data-facility-condition="85"');
    expect(html).toContain('Condition 85/100 · Good');
    expect(html).toContain('€200 / matchday upkeep');
    expect(html).toContain('Reduced upkeep costs 50% and upgraded facilities lose 5 condition per matchday');
  });
});
