import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { getPressQuestion } from '../src/world/press-policy';
import { answerPress } from '../src/world/relationships';
import { mediaReputation } from '../src/world/media';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { getInboxItems } from '../src/ui/inbox-items';
import { InboxWorkspace, pressEffectText } from '../src/ui/InboxWorkspace';
import { MediaStanding } from '../src/ui/MediaStanding';
import { advanceMatchday } from './helpers/board-funding';

const noop = () => {};
let open: SeasonState;

beforeAll(() => {
  open = createSeason({ seed: 8, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Media Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS });
  for (let step = 0; step < 10 && !getPressQuestion(open); step += 1) open = advanceMatchday(open);
}, 120_000);

describe('press conference and media standing screens', () => {
  it('shows the topic, four answer styles with their effects and the media standing', () => {
    const question = getPressQuestion(open)!;
    const html = renderToStaticMarkup(<InboxWorkspace season={open} onAnswerPress={noop} onOpen={noop} />);
    expect(html).toContain(`data-press-topic="${question.topic}"`);
    expect(html.match(/data-press-answer="/g)).toHaveLength(4);
    expect(html).toContain(`data-press-standing="${question.standing}"`);
    expect(getInboxItems(open).find(item => item.category === 'press')!.title).toMatch(/^Press conference · /);
    expect(pressEffectText('combative', 'playing-time', 'Emil Solberg')).toBe('Emil Solberg −4 morale · Rest of the squad +1 morale · Crowds +1% · Media −1');
    expect(pressEffectText('deflect', 'rival-comments')).toBe('No effect');
    expect(pressEffectText('combative', 'losing-run')).toBe('Regulars −3 · rest of the squad +1 morale · Board +1 · Crowds +1% · Media −1');
    const answered = answerPress(open, 'calm');
    expect(renderToStaticMarkup(<InboxWorkspace season={answered} onAnswerPress={noop} onOpen={noop} />)).not.toContain('id="press-conference"');
    expect(getInboxItems(answered).find(item => item.category === 'press')).toMatchObject({ title: 'Press conference answered', needsAction: false });
  });

  it('shows the standing, its current effects and recent reasons on the Club board view', () => {
    const html = renderToStaticMarkup(<MediaStanding season={open} />);
    expect(html).toContain(`data-media-standing="${mediaReputation(open).value}"`);
    for (const effect of ['board', 'players', 'sponsors', 'supporters']) expect(html).toContain(`data-media-effect="${effect}"`);
    expect(html).toContain('Not the same as your reputation for job offers');
    expect(renderToStaticMarkup(<MediaStanding season={{ ...open, media: undefined }} />)).toBe('');
  });
});
