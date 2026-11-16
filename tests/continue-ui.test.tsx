import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMatch } from '../src/engine/match';
import { createSeason } from '../src/world/season';
import { continueStatus } from '../src/ui/continue-run';
import { ContinueControl, ContinueProgress, isContinueShortcut, type ContinueRunView } from '../src/ui/ContinueControl';
import { ManagerDesk } from '../src/ui/ManagerDesk';
import { RestWeek } from '../src/ui/RestWeek';

const noop = () => {};
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const running: ContinueRunView = { day: '2026-09-08', label: '8 European games', steps: 2, total: 5, stopping: false };
const key = (target: unknown, extra: Partial<Parameters<typeof isContinueShortcut>[0]> = {}) => isContinueShortcut({ key: ' ', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, target: target as EventTarget, ...extra });
/** A focused element: `closest` finds it when it matches one of the selectors (as the browser does for the element itself). */
const element = (tag: string) => ({ closest: (selector: string) => selector.split(',').map(part => part.trim()).includes(tag) ? {} : null });

describe('the one Continue control (owner request, 16 November 2026)', () => {
  it('shows the career day, what today is and one Continue with its keyboard shortcut', () => {
    const html = renderToStaticMarkup(<ContinueControl day="2026-09-12" status="Pre-match" busy={false} run={null} onContinue={noop} onStop={noop} />);
    expect(html).toContain('data-continue-state="idle"');
    expect(html).toMatch(/<time dateTime="2026-09-12">Sat 12 Sept 2026<\/time><span>Pre-match<\/span>/);
    expect(html).toMatch(/<button id="continue-career" class="button primary continue-button"[^>]*aria-keyshortcuts="Space"[^>]*>Continue/);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('continue-stop');
    expect(renderToStaticMarkup(<ContinueControl day="2026-09-12" status="Rest week" busy run={null} onContinue={noop} onStop={noop} />)).toMatch(/id="continue-career"[^>]*disabled/);
  });

  it('turns into Stop during a run, and shows the day ticking with what is processed and a progress bar', () => {
    const control = renderToStaticMarkup(<ContinueControl day="2026-09-05" status="Rest week" busy={false} run={running} onContinue={noop} onStop={noop} />);
    expect(control).toContain('data-continue-state="running"');
    expect(control).toContain('Tue 8 Sept 2026');
    expect(control).not.toContain('id="continue-career"');
    expect(text(control)).toContain('Continuing… Stop');
    const stopping = renderToStaticMarkup(<ContinueControl day="2026-09-05" status="Rest week" busy={false} run={{ ...running, stopping: true }} onContinue={noop} onStop={noop} />);
    expect(stopping).toMatch(/id="continue-stop"[^>]*disabled/);
    expect(text(stopping)).toContain('Stopping after this day Stopping…');
    const progress = renderToStaticMarkup(<ContinueProgress run={running} />);
    expect(text(progress)).toBe('Tue 8 Sept 8 European games Day 3 of 5');
    expect(progress).toMatch(/role="progressbar" aria-labelledby="continue-progress-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40" aria-valuetext="Day 3 of 5"><span style="width:40%"><\/span>/);
    // An estimate that falls short (a postseason game added) never shows a day beyond the total.
    expect(renderToStaticMarkup(<ContinueProgress run={{ ...running, label: 'Weekly club business', steps: 4, total: 3 }} />)).toMatch(/aria-valuenow="80".*Day 5 of 5/);
  });

  it('presses Continue with Space only when no field or control has focus', () => {
    expect(key(element('main'))).toBe(true);
    expect(key(null)).toBe(true);
    for (const tag of ['input', 'textarea', 'select', 'button', 'summary', 'dialog', '[role="slider"]']) expect(key(element(tag))).toBe(false);
    expect(key(element('main'), { key: 'Enter' })).toBe(false);
    expect(key(element('main'), { ctrlKey: true })).toBe(false);
    expect(key(element('main'), { repeat: true })).toBe(false);
    expect(key(element('main'), { defaultPrevented: true })).toBe(false);
  });

  it('names today next to Continue and leaves no Continue or "Go to match" buttons on the pages', () => {
    const state = createSeason({ seed: 5, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    expect(state.activeMatch).not.toBeNull();
    expect(continueStatus(state, 'Pre-match')).toBe('Pre-match');
    const desk = renderToStaticMarkup(<ManagerDesk match={state.activeMatch!} season={state} apply={noop} onOpenMatch={noop} onOpenSquad={noop} onOpenMedical={noop} onSelectPlayer={noop} onOpenCoaching={noop} onOpenClub={noop} onOpenPayroll={noop} onOpenTransfers={noop} onOpenScouting={noop} />);
    expect(desk).not.toContain('Go to match');
    expect(desk).not.toContain('desk-match-action');
    // An exhibition's finished match keeps its result link.
    const finished = { ...createMatch(3), status: 'finished' as const };
    expect(renderToStaticMarkup(<ManagerDesk match={finished} apply={noop} onOpenMatch={noop} onOpenSquad={noop} onOpenMedical={noop} onSelectPlayer={noop} onOpenCoaching={noop} onOpenClub={noop} onOpenPayroll={noop} onOpenTransfers={noop} onOpenScouting={noop} />)).toContain('View result');
    const rest = { ...state, activeMatch: null, activeFixtureId: null };
    const panel = renderToStaticMarkup(<RestWeek season={rest} busy={false} onTraining={noop} />);
    expect(panel).not.toMatch(/>Continue</);
    expect(panel).toContain('Training');
  });
});
