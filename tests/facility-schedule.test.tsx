import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { seasonRounds } from '../src/world/career-world';
import { addCalendarDays } from '../src/world/competition-calendar';
import { startFacilityUpgrade } from '../src/world/facilities';
import { getActiveFacilityProject } from '../src/world/facilities-policy';
import { facilityProjectSchedule } from '../src/world/facility-schedule';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { FacilitiesPanel } from '../src/ui/FacilitiesPanel';
import { advanceMatchday } from './helpers/board-funding';

/** Owner feedback (11): a project in progress shows its weeks left and the Saturday it completes, from its saved dates. */
const club = 'rhine-falcons';
const noop = () => {};
const render = (season: SeasonState) => renderToStaticMarkup(<FacilitiesPanel season={season} onEnableFacilities={noop} onFacilityUpgrade={noop} onCancelFacilityUpgrade={noop} onFacilityDelegation={noop} onRequestBoardFunding={noop} onEnableMaintenance={noop} onMaintenancePlan={noop} />);
let started: SeasonState, nextWeek: SeasonState;

beforeAll(() => {
  started = startFacilityUpgrade(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', manager: { name: 'Schedule Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS }), 'training');
  nextWeek = advanceMatchday(started);
}, 300_000);

describe('facility project time left', () => {
  it('counts whole weeks to the Saturday the project completes, and counts down as the calendar moves', () => {
    const project = getActiveFacilityProject(started, club)!;
    const schedule = facilityProjectSchedule(started, project);
    expect(new Date(`${schedule.completesOn}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(schedule).toEqual({ completesOn: project.dueOn, inSeason: true, weeksLeft: 3, weeksTotal: 3 });
    expect(getActiveFacilityProject(nextWeek, club)!.id).toBe(project.id);
    expect(facilityProjectSchedule(nextWeek, project)).toEqual({ completesOn: project.dueOn, inSeason: true, weeksLeft: 2, weeksTotal: 3 });
  });

  it('moves a weekday plan to that week\'s Saturday and gives only the earliest day after the season', () => {
    expect(facilityProjectSchedule(started, { startedOn: started.date, dueOn: addCalendarDays(started.date, 18) })).toEqual({ completesOn: addCalendarDays(started.date, 21), inSeason: true, weeksLeft: 3, weeksTotal: 3 });
    const afterSeason = addCalendarDays(dateForRound(seasonRounds(started), started.seasonNumber), 4);
    expect(facilityProjectSchedule(started, { startedOn: started.date, dueOn: afterSeason })).toMatchObject({ completesOn: afterSeason, inSeason: false });
    expect(facilityProjectSchedule({ ...started, status: 'complete' }, getActiveFacilityProject(started, club)!).inSeason).toBe(false);
  });

  it('shows the weeks left and the finish day in the project row and summary, for upgrades and repairs', () => {
    const project = getActiveFacilityProject(started, club)!;
    const html = render(nextWeek);
    expect(html).toContain('data-facility-row-weeks-left="2"');
    expect(html).toMatch(/data-facility-weeks-left="2">2 weeks left<\/b> · ready <time[^>]*data-facility-finish="[\d-]+">Sat \d+ \w+ \d{4}<\/time>/);
    expect(html).toContain(`data-facility-finish="${project.dueOn}"`);
    expect(html).toContain('1 / 3 weeks done');
    const repair: SeasonState = { ...nextWeek, facilities: { ...nextWeek.facilities, projects: nextWeek.facilities.projects.map(item => item.id === project.id ? { ...item, kind: 'repair' as const, fromLevel: 1, toLevel: 1, conditionBefore: 60 } : item) } };
    const repairing = render(repair);
    expect(repairing).toContain('Repairing<small data-facility-row-weeks-left="2">2 weeks left</small>');
    expect(repairing).toContain('Training facilities repair: 1 week of 3 weeks done, 2 weeks left');
  });
});
