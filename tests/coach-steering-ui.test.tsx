import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CareerStart } from '../src/ui/CareerStart';

const noop = () => undefined;
const attributes = { offence: 10, defence: 11, tactics: 10, development: 15, motivation: 13, discipline: 9, youth: 11, adaptability: 10 };
const render = (help: { practice: number; morale: number } | null) => renderToStaticMarkup(<CareerStart view="profile" busy={false} error={null} hasSession currentCareer={{ managerName: 'Test Coach', clubName: 'Test club', date: '2026-11-07', earnings: null, coaching: { attributes, seasons: [], reputation: 50, bonus: 0, help } }} savedCareer={null} savesLoading={false} onContinue={noop} onResume={noop} onNewCareer={noop} onLoad={noop} onImport={noop} onExhibition={noop} onCancel={noop} onStart={noop} onSaveProfile={noop} pack={null} onPackLoaded={noop} />);

describe('Manager profile: how your attributes help (format 86)', () => {
  it('shows what Development and Motivation add, only in careers where head coaches steer', () => {
    const html = render({ practice: 3, morale: 1 });
    expect(html).toContain('How your attributes help');
    expect(html).toContain('Development 15');
    expect(html).toContain('+3%');
    expect(html).toContain('Motivation 13');
    expect(html).toContain('Squad morale: +1');
    expect(render(null)).not.toContain('How your attributes help');
  });
});
