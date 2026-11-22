import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { getPressQuestion } from '../src/world/press-policy';
import { answerPress } from '../src/world/relationships';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { getInboxItems } from '../src/ui/inbox-items';
import { inboxList, inboxView, InboxWorkspace, pressEffectText, withRead } from '../src/ui/InboxWorkspace';
import { advanceMatchday } from './helpers/board-funding';

const noop = () => {};
const render = (season: SeasonState) => renderToStaticMarkup(<InboxWorkspace season={season} onAnswerPress={noop} onOpen={noop} />);
let start: SeasonState, open: SeasonState;

beforeAll(() => {
  // Seed 10 (1 before the match flow, real coaches and European entry of formats 81-83, 8 before the full new-career
  // rules of 22 November 2026): three defeats open a press conference.
  start = createSeason({ seed: 10, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Inbox Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, media: false });
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

describe('one inbox list (owner feedback, 18 November 2026)', () => {
  it('shows every message newest first, with All and Unread filters and no category tabs', () => {
    const html = render(open);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All</);
    expect(html).toContain('>Unread');
    for (const tab of ['Needs action', '>Press<', '>Board<', '>Players<', '>Club<']) expect(html).not.toContain(tab);
    const items = getInboxItems(open), list = inboxList(items, 'all', new Set());
    expect(list).toHaveLength(items.length);
    for (let index = 1; index < list.length; index += 1) expect(list[index - 1]!.date >= list[index]!.date).toBe(true);
    const read = new Set([list[0]!.id]);
    expect(inboxList(items, 'unread', read).map(item => item.id)).toEqual(list.slice(1).map(item => item.id));
  });
});

describe('two-pane inbox (owner feedback, 22 November 2026)', () => {
  it('shows the chosen message in full on the right, with its actions', () => {
    const items = getInboxItems(open), board = items.find(item => item.title.startsWith('Board review'))!;
    const html = renderToStaticMarkup(<InboxWorkspace season={open} onAnswerPress={noop} onOpen={noop} initialSelectedId={board.id} />);
    const reader = html.slice(html.indexOf('id="inbox-reader"'));
    expect(reader).toContain(`data-inbox-selected="${board.id}"`);
    expect(reader).toContain(`<h3>${board.title}</h3>`);
    expect(reader).toContain(board.detail.slice(0, 40));
    expect(reader).toContain('Open board');
    expect(reader).toContain('Back to messages');
    // The list holds titles and dates only; the full text is in the reader.
    expect(html.slice(0, html.indexOf('id="inbox-reader"'))).not.toContain(board.detail.slice(0, 40));
    // Without a choice, a waiting press conference opens first.
    expect(render(open).slice(render(open).indexOf('id="inbox-reader"'))).toContain('id="press-conference"');
  });

  it('marks the chosen message read and keeps it open in the Unread view', () => {
    const items = getInboxItems(open), chosen = inboxList(items, 'all', new Set())[2]!;
    const read = withRead(new Set(), [chosen.id]);
    expect(read.has(chosen.id)).toBe(true);
    const view = inboxView(items, 'unread', read, chosen.id);
    expect(view.selected?.id).toBe(chosen.id);
    expect(view.shown.some(item => item.id === chosen.id)).toBe(true);
    // Once another message is chosen, the read one leaves the Unread view.
    const other = view.shown.find(item => item.id !== chosen.id)!;
    expect(inboxView(items, 'unread', withRead(read, [other.id]), other.id).shown.some(item => item.id === chosen.id)).toBe(false);
  });
});
