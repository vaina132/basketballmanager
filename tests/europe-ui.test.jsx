import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { clubEuropeanCompetitions, defaultOtherLeague, EuropeanLeaguesWorkspace, InternationalWorkspace, otherLeagues } from '../src/ui/EuropeWorkspace';
import { SeasonWorkspace } from '../src/ui/SeasonWorkspace';
import { SeasonCalendar } from '../src/ui/SeasonCalendar';
import { estimatedTable } from '../src/world/european-places';
import { placesWorld } from './helpers/europe-worlds';

const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const noop = () => {};
const leagueProps = { onOpenMatch: noop, onNewCareer: noop, onLoad: noop };

/**
 * Competitions' tabs (owner, 22 November 2026, evening): International opens on the European competitions the
 * manager's club plays, the others behind smaller buttons; European Leagues lists every other domestic league (played, or with a simulated table) as
 * buttons by country instead of the old drop-down; League is the manager's own league only.
 */
describe('Competitions > International, European Leagues and League, and the season calendar', () => {
  let world, state, quiet;
  beforeAll(() => {
    world = placesWorld();
    state = setEmploymentDelegation(createSeason({ seed: 12, world, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    for (let week = 0; week < 8; week += 1) state = play(state);
    // A first-division club that plays no European competition.
    quiet = createSeason({ seed: 12, world, managedClubId: world.clubs[5].id, ...NEW_CAREER_SYSTEMS });
  }, 300_000);

  it('International opens on the club\'s own competition, with the others behind smaller buttons', () => {
    expect(clubEuropeanCompetitions(state, state.managedClubId)).toEqual(['euroleague']);
    const markup = renderToStaticMarkup(createElement(InternationalWorkspace, { season: state }));
    expect(markup).toContain('data-competitions-view="international"');
    expect(markup).toMatch(/role="group" aria-label="Your European competitions"><button type="button" data-competition-option="euroleague" aria-pressed="true"/);
    expect(markup).toContain('Regular-season table');
    expect(markup).toContain('Your club');
    expect(markup).toContain('Your club only');
    expect(markup).toContain('Games &amp; results');
    expect(markup).toMatch(/\d+–\d+/);
    // The competitions the club does not play are a click away, not open; domestic leagues and drop-downs are not here.
    expect(markup).toContain('id="competition-others-label">Other European competitions<');
    expect(markup).toMatch(/data-other-competition="eurocup" aria-pressed="false"/);
    expect(markup).not.toContain('data-other-competition="euroleague"');
    expect(markup).not.toContain('Group D');
    expect(markup).not.toContain('Otherland League');
    expect(markup).not.toContain('id="europe-competition"');
    // Choosing another competition (as the buttons do) shows it in full, without the own-club filter.
    const cup = renderToStaticMarkup(createElement(InternationalWorkspace, { season: state, competitionId: 'eurocup' }));
    expect(cup).toMatch(/data-other-competition="eurocup" aria-pressed="true"/);
    expect(cup).toMatch(/data-competition-option="euroleague" aria-pressed="false"/);
    expect(cup).toContain('Group A');
    expect(cup).toContain('Group D');
    expect(cup).not.toContain('Your club only');
  });

  it('International gives a club without European games the note and the competitions to look at', () => {
    expect(clubEuropeanCompetitions(quiet, quiet.managedClubId)).toEqual([]);
    const markup = renderToStaticMarkup(createElement(InternationalWorkspace, { season: quiet }));
    expect(markup).toContain('Your club plays no European competition this season.');
    expect(markup).toMatch(/data-other-competition="euroleague" aria-pressed="false"/);
    expect(markup).toMatch(/data-other-competition="eurocup" aria-pressed="false"/);
    expect(markup).not.toContain('data-competition-option=');
    expect(markup).not.toContain('Games &amp; results');
    const chosen = renderToStaticMarkup(createElement(InternationalWorkspace, { season: quiet, competitionId: 'euroleague' }));
    expect(chosen).toContain('Your club plays no European competition this season.');
    expect(chosen).toContain('Regular-season table');
    expect(chosen).toContain('Games &amp; results');
  });

  it('European Leagues lists every other league as buttons by country, own country first, and opens on a top division', () => {
    const groups = otherLeagues(state);
    expect(groups.map(group => [group.country, group.leagues.map(league => league.id)])).toEqual([['Testland', ['second']], ['Otherland', ['otherland']]]);
    expect(defaultOtherLeague(groups)).toBe('otherland');
    // A second-division manager sees the first division there instead of his own league.
    const second = createSeason({ seed: 12, world, managedClubId: world.clubs[7].id, ...NEW_CAREER_SYSTEMS });
    expect(otherLeagues(second)[0].leagues.map(league => league.id)).toEqual(['first']);
    const markup = renderToStaticMarkup(createElement(EuropeanLeaguesWorkspace, { season: state, ...leagueProps }));
    expect(markup).toContain('data-competitions-view="leagues"');
    expect(markup).toMatch(/role="group" aria-labelledby="league-country-testland"/);
    expect(markup).toMatch(/<button type="button" class="league-option" aria-pressed="false" data-league-option="second"/);
    expect(markup).toMatch(/<button type="button" class="league-option selected" aria-pressed="true" data-league-option="otherland"/);
    expect(markup).not.toContain('data-league-option="first"');
    expect(markup).not.toContain('<select aria-label="Competition"');
  });

  it('European Leagues shows an unchosen league\'s simulated final table, labelled as not played', () => {
    const markup = renderToStaticMarkup(createElement(EuropeanLeaguesWorkspace, { season: state, leagueId: 'otherland', ...leagueProps }));
    expect(markup).toContain('Otherland League · Simulated final table');
    expect(markup).toContain('Otherland League is not played game by game in this career: its final table is simulated');
    expect(markup).toContain('Not played · table simulated');
    expect(markup).not.toMatch(/[Ee]stimated table/);
    const first = world.clubs.find(club => club.id === estimatedTable(state, world.backgroundLeagues[0], 1)[0].clubId);
    expect(markup.indexOf(first.name)).toBeGreaterThan(-1);
  });

  it('European Leagues shows another played league in full; League shows only the manager\'s own league', () => {
    const other = renderToStaticMarkup(createElement(EuropeanLeaguesWorkspace, { season: state, leagueId: 'second', ...leagueProps }));
    expect(other).toContain('data-season-league="second"');
    expect(other).toContain('Second division · 2026/27');
    expect(other).toContain('Fixtures &amp; results');
    expect(other).not.toContain('Your club');
    const own = renderToStaticMarkup(createElement(SeasonWorkspace, { season: state, ...leagueProps }));
    expect(own).toContain('First division · 2026/27');
    expect(own).not.toContain('Second division');
    expect(own).not.toContain('aria-label="Competition"');
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
