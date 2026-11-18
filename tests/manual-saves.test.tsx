import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closeWarning, hasUnsavedProgress, SaveStatus } from '../src/ui/SaveStatus';

// Owner (18 November 2026): "The saves must be easy and manually triggered. Auto saves are no good."
describe('manual saves', () => {
  const saved = { label: 'Matchday 4', at: Date.UTC(2026, 10, 18, 14, 32) };

  it('says when the career has changed since the last save, and that leaving would lose it', () => {
    const progress = { saving: false, pending: null, saved, unsaved: true };
    const html = renderToStaticMarkup(<SaveStatus progress={progress} />);
    expect(html).toContain('Unsaved changes since Matchday 4');
    expect(html).toContain('data-save-status="unsaved"');
    expect(hasUnsavedProgress(progress)).toBe(true);
    expect(closeWarning(progress)).toBe('Your career is saved up to Matchday 4. If you close the game now, it continues from there.');
  });

  it('shows the save time once saved, and a career never saved as not saved yet', () => {
    const clean = { saving: false, pending: 'Matchday 4', saved, unsaved: false };
    expect(renderToStaticMarkup(<SaveStatus progress={clean} />)).toMatch(/Saved \d\d:\d\d · Matchday 4/);
    expect(hasUnsavedProgress(clean)).toBe(false);
    const fresh = { saving: false, pending: null, saved: null, unsaved: true };
    expect(renderToStaticMarkup(<SaveStatus progress={fresh} />)).toContain('Not saved yet');
    expect(closeWarning(fresh)).toMatch(/has not been saved yet/);
  });

  it('keeps leaving guarded while a save is still being checked', () => {
    const progress = { saving: true, pending: 'Matchday 5', saved, unsaved: false };
    expect(hasUnsavedProgress(progress)).toBe(true);
    expect(renderToStaticMarkup(<SaveStatus progress={progress} />)).toContain('Saving Matchday 5');
    expect(closeWarning(progress)).toContain('Matchday 5 is still being saved');
  });
});
