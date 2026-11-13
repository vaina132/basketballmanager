import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { getInboxItems } from '../src/ui/inbox-items';
import { advanceMatchday } from './helpers/board-funding';

const noop = () => {};
const board = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
const career = (rivalries: boolean) => createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Derby Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, rivalries });
let afterDerby: SeasonState;

beforeAll(() => {
  // Seed 227: Rhine Falcons win the river derby away at Danube Lynx on matchday 2.
  afterDerby = career(true);
  while (afterDerby.round <= 2) afterDerby = advanceMatchday(afterDerby);
}, 120_000);

describe('rivalry screens', () => {
  it('offers older careers the switch, with the derby effects stated', () => {
    const html = board(career(false));
    expect(html).toContain('Rivalry · River derby');
    expect(html).toMatch(/id="enable-rivalries"[^>]*>Enable rivalries/);
    expect(html).toContain('Home derbies draw 15% more crowd demand.');
    expect(html).toContain('This starts with the next matchday.');
  });

  it('lists this season\'s derbies with results and the board\'s derby assessment', () => {
    const html = board(afterDerby);
    expect(html).toContain('data-board-rival="danube-lynx"');
    expect(html).toContain('Fierce rivalry');
    expect(html.match(/data-derby-fixture="/g)).toHaveLength(2);
    expect(html).toMatch(/data-derby-result="won"[\s\S]*Matchday 2 · Away[\s\S]*Won \d+–\d+/);
    expect(html).toContain('data-derby-result="upcoming"');
    expect(html).toContain('Derbies +3');
    expect(html).toContain('Derby results');
  });

  it('records derby results in the inbox', () => {
    const item = getInboxItems(afterDerby).find(entry => entry.id.startsWith('derby-'))!;
    expect(item).toMatchObject({ category: 'board', title: 'River derby won', needsAction: false, target: 'board' });
    expect(item.detail).toMatch(/^\d+–\d+ away\. The board and the squad weigh this result more than usual\.$/);
  });
});
