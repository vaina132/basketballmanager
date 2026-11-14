import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { createSeason } from '../src/world/season';
import { availableCoaches, hireCoach, releaseCoach } from '../src/world/coaching';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { StaffWorkspace } from '../src/ui/StaffWorkspace';
import { ClubWorkspace } from '../src/ui/ClubWorkspace';
import { TrainingWorkspace } from '../src/ui/TrainingWorkspace';
import { testWorld } from './world-fixtures';

const world = testWorld(18);
const opening = createSeason({ seed: 227, world, managedClubId: world.clubs[0].id, coaching: true, training: true, finance: true });
const candidate = availableCoaches(opening.coaching, opening).filter(coach => !DEVELOPMENT_COACHES.some(old => old.id === coach.id)).sort((a, b) => a.fee - b.fee)[0];
const hired = hireCoach(opening, candidate.id);
const noop = () => {};

describe('generated coaches in larger career leagues', () => {
  it.each([
    ['Staff', state => <StaffWorkspace season={state} role="coaches" onRoleChange={noop} />],
    ['Club ledger', state => <ClubWorkspace season={state} />],
    ['Training', state => <TrainingWorkspace season={state} />],
  ])('renders the hired coach by identity in %s, including after save/load', (_name, view) => {
    expect(candidate).toBeDefined();
    expect(hired.finance.ledger.some(entry => entry.coach?.coachId === candidate.id)).toBe(true);
    for (const state of [hired, parseSeason(serializeSeasonCompact(hired))]) {
      expect(renderToStaticMarkup(view(state))).toContain(candidate.name);
    }
  });
  it('retains the coach identity in released staff and the paid ledger', () => {
    const contract = hired.coaching.contracts.find(row => row.coachId === candidate.id);
    const released = releaseCoach(hired, contract.id);
    expect(renderToStaticMarkup(<StaffWorkspace season={released} role="coaches" onRoleChange={noop} />)).toContain(candidate.name);
    expect(renderToStaticMarkup(<ClubWorkspace season={released} />)).toContain(candidate.name);
  });
});
