import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PositionLabel } from '../src/ui/PositionLabel';
import { DataPackDetails } from '../src/ui/DataPackDetails';

describe('profile uncertainty in the game', () => {
  it('shows and names uncertain positions without marking official roles as estimates', () => {
    const uncertain = renderToStaticMarkup(<PositionLabel position="SF" profile={{ source: 'estimated-from-age' }} />);
    expect(uncertain).toContain('SF, estimated position');
    expect(uncertain).toContain('est.');
    const official = renderToStaticMarkup(<PositionLabel position="C" profile={{ source: 'official-profile', positionSource: 'official' }} />);
    expect(official).not.toContain('est.');
  });
  it('shows the observed season and unresolved memberships without claiming opening-day rosters', () => {
    const html = renderToStaticMarkup(<DataPackDetails pack={{ season: '2026-27', source: { profileAudit: { observedAt: '2026-11-14T12:00:00Z', officialProfiles: 630, membershipConflicts: 166 } } }} />);
    expect(html).toContain('2026-27');
    expect(html).toContain('2026-11-14');
    expect(html).toContain('opening-day membership is not verified');
    expect(html).toContain('166');
  });
});
