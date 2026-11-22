import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { EuropeWorkspace } from '../src/ui/EuropeWorkspace';
import { SeasonCalendar } from '../src/ui/SeasonCalendar';
import { estimatedTable } from '../src/world/european-places';
import { placesWorld } from './helpers/europe-worlds';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('European competition screens and the season calendar (step 3.5g)', () => {
  let world, state;
  beforeAll(() => {
    world = placesWorld();
    state = setEmploymentDelegation(createSeason({ seed: 12, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    for (let week = 0; week < 8; week += 1) state = play(state);
  }, 300_000);

  it('shows the manager\'s European competition: its table, games and results, and the other competitions to choose', () => {
    const markup = renderToStaticMarkup(createElement(EuropeWorkspace, { season: state }));
    expect(markup).toContain('Test euroleague');
    expect(markup).toContain('Regular-season table');
    expect(markup).toContain('Your club');
    expect(markup).toContain('Games &amp; results');
    expect(markup).toMatch(/\d+–\d+/);
    expect(markup).toContain('Test eurocup');
    expect(markup).toContain('Otherland League · not played');
    const cup = renderToStaticMarkup(createElement(EuropeWorkspace, { season: state, initialCompetition: 'eurocup' }));
    expect(cup).toContain('Group A');
    expect(cup).toContain('Group D');
  });

  it('shows an unchosen league\'s simulated final table, labelled as not played', () => {
    const markup = renderToStaticMarkup(createElement(EuropeWorkspace, { season: state, initialCompetition: 'otherland' }));
    expect(markup).toContain('Otherland League · Simulated final table');
    expect(markup).toContain('Otherland League is not played game by game in this career: its final table is simulated');
    expect(markup).toContain('Not played game by game');
    expect(markup).not.toMatch(/[Ee]stimated table/);
    const first = world.clubs.find(club => club.id === estimatedTable(state, world.backgroundLeagues[0], 1)[0].clubId);
    expect(markup.indexOf(first.name)).toBeGreaterThan(-1);
  });

  it('lays out the whole season: weeks, competitions on each day, the manager\'s games and reserved knockout days', () => {
    const markup = renderToStaticMarkup(createElement(SeasonCalendar, { season: state }));
    expect(markup).toContain('id="calendar-title">Weeks<');
    expect(markup).toContain('Week 1');
    expect(markup).toContain('Week 38');
    expect(markup).toContain('Playoffs 1');
    expect(markup).toContain('First division (');
    expect(markup).toContain('Test euroleague (');
    expect(markup).toContain('Reserved: Test euroleague · Knockout rounds');
    expect(markup).toContain('Domestic playoffs');
    const own = state.fixtures.find(fixture => fixture.result && fixture.competition && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId));
    const opponent = world.clubs.find(club => club.id === (own.homeClubId === state.managedClubId ? own.awayClubId : own.homeClubId));
    expect(markup).toContain(opponent.name);
    expect(markup).toContain('aria-current="date"');
  });
});
