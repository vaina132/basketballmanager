import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { seniorGrowthSinceLastWeek, youthGrowth } from '../src/world/player-growth';
import { getClubAcademy } from '../src/world/academy-policy';
import { getYouthFixtures } from '../src/world/youth-competition';
import { TRAINING_ATTRIBUTES } from '../src/world/training';
import { GrowthMarker } from '../src/ui/GrowthMarker';

const CLUB = 'rhine-falcons';
const week = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('growth markers on the Squad and academy pages (owner feedback, 22 November 2026)', () => {
  it('shows each ability and the overall change since last week, rebuilt from the last training report', () => {
    const opening = createSeason({ seed: 91, managedClubId: CLUB, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
    // No training report yet this season: no marker.
    const first = opening.clubs.find(club => club.id === CLUB)!.players[0]!;
    expect(seniorGrowthSinceLastWeek(opening, first.id)).toBeNull();
    let state = opening;
    while (!state.training.lastWeek || state.training.lastWeek.seasonNumber !== state.seasonNumber) state = week(state);
    const club = state.clubs.find(item => item.id === CLUB)!;
    const player = club.players.find(item => item.attributes.twoPoint <= 15 && item.attributes.passing <= 15)!;
    const id = player.id, report = state.training.lastWeek!.players[id]!;
    // Make the week's practice cross one full point of Two-point shooting (150 now, 60 gained: 90 a week ago).
    const crafted: SeasonState = {
      ...state,
      training: {
        ...state.training,
        points: { ...state.training.points, [id]: { ...state.training.points[id]!, twoPoint: 150, passing: 40 } },
        lastWeek: { ...state.training.lastWeek!, players: { ...state.training.lastWeek!.players, [id]: { ...report, gains: { ...report.gains, twoPoint: 60, passing: 20 } } } },
      },
    };
    const growth = seniorGrowthSinceLastWeek(crafted, id)!;
    expect(growth.since).toBe('last week');
    expect(growth.attributes.twoPoint).toBe(1);
    expect(growth.attributes.passing).toBeUndefined();
    expect(growth.overall).toBeGreaterThanOrEqual(0);
    // The marker says the change in words; no change shows nothing.
    expect(renderToStaticMarkup(<GrowthMarker change={growth.attributes.twoPoint} label="Two-point shooting" since={growth.since} />)).toContain('▲ +1');
    expect(renderToStaticMarkup(<GrowthMarker change={-1} label="Overall" since="last week" />)).toContain('aria-label="Overall down 1 since last week"');
    expect(renderToStaticMarkup(<GrowthMarker change={0} label="Overall" since="last week" />)).toBe('');

    // Academy prospects: since the club's last played youth match (the points of the last weekly report before it).
    let youth = state;
    const played = (current: SeasonState) => getYouthFixtures(current).some(fixture => fixture.result?.played && fixture.round <= current.round && [fixture.homeClubId, fixture.awayClubId].includes(CLUB));
    for (let guard = 0; guard < 12 && !played(youth); guard++) youth = week(youth);
    expect(played(youth)).toBe(true);
    const lastMatch = getYouthFixtures(youth).filter(fixture => fixture.result?.played && fixture.round <= youth.round && [fixture.homeClubId, fixture.awayClubId].includes(CLUB)).sort((a, b) => a.round - b.round).at(-1)!;
    expect(getClubAcademy(youth).length).toBeGreaterThan(0);
    for (const row of getClubAcademy(youth)) {
      const result = youthGrowth(youth, row.player.id)!;
      expect(result.since).toBe('last youth match');
      const before = youth.academy.weeks.filter(item => Object.hasOwn(item.players, row.player.id) && (item.seasonNumber < lastMatch.seasonNumber || item.seasonNumber === lastMatch.seasonNumber && item.afterRound < lastMatch.round)).at(-1)?.players[row.player.id]!.pointsAfter;
      for (const key of TRAINING_ATTRIBUTES) {
        const expected = Math.floor(row.points[key] / 100) - Math.floor((before?.[key] ?? 0) / 100);
        expect(result.attributes[key] ?? 0).toBe(expected);
      }
    }
  }, 180_000);
});
