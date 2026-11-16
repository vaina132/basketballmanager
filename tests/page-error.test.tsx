import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isLoadFailure, PageError, PageErrorBoundary } from '../src/ui/PageErrorBoundary';

const noop = () => {};

// Owner feedback (16 November 2026): Inbox opened an empty black screen right after a new career started. Pages open on
// demand; when a new version is published while the game is open, the old page file is gone and the whole game blanked.
describe('a page that cannot be opened', () => {
  it('recognises a page file that could not be downloaded in each browser', () => {
    expect(isLoadFailure(new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/InboxWorkspace-a1.js'))).toBe(true);
    expect(isLoadFailure(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isLoadFailure(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isLoadFailure(new Error('Unable to preload CSS for /assets/InboxWorkspace-a1.css'))).toBe(true);
    expect(isLoadFailure(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
  });

  it('says plainly that the page did not download and saves the career before reloading', () => {
    const html = renderToStaticMarkup(<PageError title="Inbox" error={new TypeError('Failed to fetch dynamically imported module')} savesFirst onReload={noop} onRetry={noop} />);
    expect(html).toContain('Inbox could not be opened');
    expect(html).toContain('could not download this page');
    expect(html).toContain('Save and reload');
    expect(html).toContain('role="alert"');
    // Retrying cannot fetch a file that no longer exists; only a reload helps.
    expect(html).not.toContain('Try again');
  });

  it('names an unexpected error, keeps the details and offers to try again', () => {
    const html = renderToStaticMarkup(<PageError title="Club" error={new TypeError("Cannot read properties of undefined (reading 'name')")} savesFirst={false} onReload={noop} onRetry={noop} />);
    expect(html).toContain('Club could not be opened');
    expect(html).toContain('Nothing in your career was changed');
    expect(html).toContain('Reload page');
    expect(html).toContain('Continue saved career');
    expect(html).toContain('Try again');
    expect(html).toContain('reading &#x27;name&#x27;');
  });

  it('shows its children until an error replaces them with the message', () => {
    const page = <PageErrorBoundary title="Inbox" savesFirst onReload={noop}><p>Inbox content</p></PageErrorBoundary>;
    expect(renderToStaticMarkup(page)).toBe('<p>Inbox content</p>');
    const error = new Error('Failed to fetch dynamically imported module');
    expect(PageErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });
});
