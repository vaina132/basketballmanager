import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MatchState } from '../src/domain/types';
import { createMatch, setAutoSubstitutions } from '../src/engine/match';
import { automaticChoiceLabels, NO_ASSISTANT_HINT } from '../src/ui/automatic-choice';
import { RequiredDecision } from '../src/ui/MatchCoaching';
import { MatchdaySquad } from '../src/ui/MatchdaySquad';
import { createSeason } from '../src/world/season';
import { TeamInstructions } from '../src/ui/TeamInstructions';

/** Owner feedback (10): without an assistant coach, the automatic match choices are labelled as the manager's own. */
const noop = () => {};
const manual = createMatch(91);
const automatic = setAutoSubstitutions(manual, 'home', true);
const rotation = (match: MatchState, assistantName?: string) => renderToStaticMarkup(<TeamInstructions match={match} apply={noop} includeRotation assistantName={assistantName} />);
const replacement = (assistantName?: string) => {
  const match = manual;
  const injured: MatchState = { ...match, requiredSubstitutions: [{ side: 'home', playerId: match.lineups.home[0]!, reason: 'injured' }] };
  return renderToStaticMarkup(<RequiredDecision match={injured} apply={noop} assistantName={assistantName} />);
};

describe('automatic match choices by assistant presence', () => {
  it('calls rotation control Automatic without an assistant coach and points to hiring one for advice', () => {
    const html = rotation(automatic);
    expect(html).toContain('data-rotation-policy="Automatic"');
    expect(html).toContain('aria-valuetext="Automatic"');
    expect(html).toContain('<span>Manual</span><span>Automatic</span>');
    expect(html).toContain(NO_ASSISTANT_HINT);
    expect(html).not.toContain('Assistant');
    expect(rotation(manual)).toContain('data-rotation-policy="Manual"');
  });

  it('keeps the Assistant label and names the hired assistant coach', () => {
    const html = rotation(automatic, 'Ana Ruiz');
    expect(html).toContain('data-rotation-policy="Assistant"');
    expect(html).toContain('<span>Manual</span><span>Assistant</span>');
    expect(html).toContain('Ana Ruiz makes the changes when set to Assistant.');
    expect(html).not.toContain(NO_ASSISTANT_HINT);
  });

  it('offers the replacement shortcut as Auto-pick unless an assistant coach is hired', () => {
    const own = replacement();
    expect(own).toContain('Auto-pick</button>');
    expect(own).toContain('Auto-pick turns rotation control to Automatic.');
    expect(own).not.toContain('Ask assistant');
    const assisted = replacement('Ana Ruiz');
    expect(assisted).toContain('Ask assistant</button>');
    expect(assisted).toContain('Ana Ruiz takes over rotation control.');
  });

  it('names the automatic matchday squad after its decider', () => {
    const season = createSeason({ seed: 91, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    expect(renderToStaticMarkup(<MatchdaySquad season={season} busy={false} onAutomatic={noop} />)).toContain('Automatic selection</button>');
    expect(renderToStaticMarkup(<MatchdaySquad season={season} busy={false} onAutomatic={noop} assistantName="Ana Ruiz" />)).toContain('Assistant selection</button>');
    expect(automaticChoiceLabels()).toMatchObject({ policy: 'Automatic', selection: 'Automatic selection', selected: 'Matchday squad chosen automatically.' });
    expect(automaticChoiceLabels('Ana Ruiz')).toMatchObject({ policy: 'Assistant', selection: 'Assistant selection', selected: 'Ana Ruiz selected the matchday squad.' });
  });
});
