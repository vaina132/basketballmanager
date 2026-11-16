import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { getPressQuestion } from '../src/world/press-policy';
import { answerPress } from '../src/world/relationships';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { getInboxItems } from '../src/ui/inbox-items';
import { InboxWorkspace, pressEffectText } from '../src/ui/InboxWorkspace';
import { advanceMatchday } from './helpers/board-funding';

const noop = () => {};
const render = (season: SeasonState) => renderToStaticMarkup(<InboxWorkspace season={season} onAnswerPress={noop} onOpen={noop} />);
let start: SeasonState, open: SeasonState;

beforeAll(() => {
  start = createSeason({ seed: 8, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Inbox Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, media: false });
  open = start;
  for (let step = 0; step < 10 && !getPressQuestion(open); step += 1) open = advanceMatchday(open);
}, 120_000);

describe('inbox', () => {
  it('lists only recorded events, starting with the board objectives of a new career', () => {
    const items = getInboxItems(start);
    expect(items.map(item => item.title)).toEqual(['Board objectives · 2026/27']);
    const html = render(start);
    expect(html).toContain('1 message');
    expect(html).not.toContain('id="press-conference"');
    expect(html).toContain('Open board');
    expect(html).toMatch(/aria-pressed="true"[^>]*>All</);
  });

  it('puts an open press conference first, with three answers and their effects', () => {
    // Sprint 4: with realistic rotations a bench player's playing-time concern can share the action group with it.
    const items = getInboxItems(open), press = items.findIndex(item => item.category === 'press'), waiting = items.filter(item => item.needsAction).length;
    expect(items[press]).toMatchObject({ category: 'press', needsAction: true, title: 'Press conference · three defeats' });
    expect(items.slice(0, press).every(item => item.needsAction)).toBe(true);
    expect(items.some(item => item.title.startsWith('Board review'))).toBe(true);
    const html = render(open);
    expect(html).toContain('id="press-conference"');
    expect(html.match(/data-press-answer="/g)).toHaveLength(3);
    expect(html).toContain('Three defeats in a row. How do you respond?');
    expect(html).toContain('Regulars −3, rest of the squad +2 morale');
    expect(html).toContain('Whole squad +3 morale');
    expect(html).toContain('No morale change');
    expect(html).toContain('your assistant keeps it routine');
    expect(html).toContain(`${waiting} ${waiting === 1 ? 'needs' : 'need'} action`);
  });

  it('records the answer in the inbox and closes the conference card', () => {
    const answered = answerPress(open, 'back');
    const html = render(answered);
    expect(html).not.toContain('id="press-conference"');
    expect(getInboxItems(answered).find(item => item.category === 'press')).toMatchObject({ title: 'Press conference answered', needsAction: false, detail: 'Back the squad: “This group has my full support.”' });
    expect(pressEffectText('leaders')).toBe('Regulars +3, rest of the squad −1 morale');
  });
});
