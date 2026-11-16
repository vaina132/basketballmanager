import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import type { SeasonEndOutlook } from '../src/world/career-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, previewSeasonEnd } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { getInboxItems } from '../src/ui/inbox-items';
import { SeasonEndChoice } from '../src/ui/SeasonEndChoice';
import { advanceMatchday } from './helpers/board-funding';
import { asCareer1 } from './helpers/career-rules';

const noop = () => {};
const board = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
const choice = (season: SeasonState, outlook: SeasonEndOutlook) => renderToStaticMarkup(<SeasonEndChoice season={season} outlook={outlook} onChoose={noop} onClose={noop} />);
// The Level 7 rules that careers created before format 63 keep (`career-1`); tests/career-board-rules.test.ts covers new careers.
const career = (seed: number, careerMoves = true) => asCareer1(setEmploymentDelegation(setFacilityDelegation(createSeason({ seed, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, careerMoves, presidents: false }), true), true));
function finalMatchday(seed: number): SeasonState {
  let state = career(seed);
  while (state.round < 10) state = advanceMatchday(state);
  return { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) };
}
let sackedDay: SeasonState, offeredDay: SeasonState;

beforeAll(() => {
  // Seeds chosen after the match calibration of sprint 4 (they were 67 and 20) and, for the offer, the relationships-2 rules
  // of format 66 (it was 102), shared with tests/career-dismissal.test.ts.
  sackedDay = finalMatchday(154); // Rhine Falcons dismissed; Aegean Waves offer their job.
  offeredDay = finalMatchday(2); // Rhine Falcons safe; Aegean Waves offer their job.
}, 240_000);

describe('season-end choice', () => {
  it('tells a dismissed manager why and offers only the clubs that want them', () => {
    const html = choice(sackedDay, previewSeasonEnd(sackedDay)!);
    expect(html).toContain('data-dismissed="true"');
    expect(html).toContain('Dismissed by Rhine Falcons');
    expect(html).toContain('data-reputation="25"');
    expect(html).toMatch(/data-join-club="aegean-waves"[^>]*>Join Aegean Waves/);
    expect(html).toContain('it offers you the job anyway after your dismissal');
    expect(html).not.toContain('id="season-end-stay"');
    expect(html).toContain('id="season-end-later"');
  });

  it('lets a manager who kept the job accept an offer or stay', () => {
    const html = choice(offeredDay, previewSeasonEnd(offeredDay)!);
    expect(html).toContain('Job offers');
    expect(html).toContain('data-reputation="50"');
    expect(html).toMatch(/data-join-club="aegean-waves"[^>]*>Join Aegean Waves/);
    expect(html).toMatch(/id="season-end-stay"[^>]*>Stay at Rhine Falcons/);
  });
});

describe('your job on the Board page', () => {
  it('offers older careers the switch and shows a new career its outlook', () => {
    expect(board(career(3, false))).toMatch(/id="enable-career-moves"[^>]*>Enable dismissal and job offers/);
    const fresh = board(career(3));
    expect(fresh).toContain('data-career-status="safe"');
    expect(fresh).toContain('data-career-reputation="45"');
    expect(fresh).toContain('If the season ended today');
  });

  it('records the dismissal and the new club in the career history', () => {
    const sacked = advanceSeason(sackedDay);
    const html = board(sacked);
    expect(html).toContain('data-career-status="decided"');
    expect(html).toContain('You joined Aegean Waves at the end of this season.');
    expect(html).toContain('data-career-reputation="25"');
    expect(html).toMatch(/data-career-season="1"><td>[^<]+<\/td><td>Rhine Falcons<\/td><td>25 · Under pressure<\/td><td>Dismissed · joined Aegean Waves/);
  });

  it('lists a declined offer in the Inbox', () => {
    const stayed = advanceSeason(offeredDay);
    expect(getInboxItems(stayed).find(item => item.id === 'offers-declined-1')).toMatchObject({ title: 'Job offer declined', detail: expect.stringContaining('Aegean Waves had offered you its job') });
  });
});
