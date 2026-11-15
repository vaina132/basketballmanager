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
  it('uses the latest membership audit while retaining its uncertainty and old-save warning', () => {
    const html = renderToStaticMarkup(<DataPackDetails pack={{ season: '2026-27', source: { profileAudit: { observedAt: '2026-11-13', membershipConflicts: 166 }, membershipAudit: { observedAt: '2026-11-14', confirmed: 630, changed: 27, unresolved: 263 } } }} />);
    expect(html).toContain('657 club assignments');
    expect(html).toContain('27 corrected');
    expect(html).toContain('263 assignments still need review');
    expect(html).not.toContain('166');
    expect(html).toContain('Saved careers keep their original data');
  });
});
