import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import app from '../src/App.tsx?raw';
import europe from '../src/ui/EuropeWorkspace.tsx?raw';

// Vitest turns imported stylesheets into empty modules, so the rules are read from disk.
const css = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const careerStartCss = css('ui/career-start.css'), seasonCss = css('ui/season-workspace.css'), shellCss = css('game-workspace.css'), deskCss = css('ui/manager-desk.css');

/** The rules inside every `@media(max-width:<width>px)` block of a stylesheet, joined. */
function mediaRules(css, width) {
  const blocks = [];
  const pattern = new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)\\s*\\{`, 'g');
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    let depth = 1, index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) { if (css[index] === '{') depth += 1; else if (css[index] === '}') depth -= 1; index += 1; }
    blocks.push(css.slice(start, index - 1));
  }
  return blocks.join('\n');
}

// Phone layout fixes (390 px wide; owner's layout notes, 22 November 2026).
describe('phone layout', () => {
  it('keeps the club step\'s "Playable countries" list and Game speed box inside their column', () => {
    expect(careerStartCss).toMatch(/fieldset\.career-country-options\{min-width:0;margin:12px 10px 0;[^}]*border:1px solid var\(--border\)/);
    expect(careerStartCss).toMatch(/fieldset\.career-country-options legend\{[^}]*font-size:13px/);
    expect(careerStartCss).toMatch(/fieldset\.career-country-options label\{display:flex;[^}]*font-size:13px/);
    expect(careerStartCss).toMatch(/\.career-club-layout \.game-speed\{margin:8px 10px 4px;[^}]*min-width:0/);
  });

  it('wraps a Competitions table heading so its fixture count is never cut off', () => {
    const phone = mediaRules(seasonCss, 550);
    expect(phone).toContain('.season-panel-heading{flex-wrap:wrap;row-gap:4px}');
    expect(phone).toContain('.season-panel-heading>span{white-space:nowrap}');
    // The pickers in Competitions use the game's dark style.
    expect(seasonCss).toMatch(/\.season-year-filter select\{background:var\(--sidebar\);color:var\(--text\);border:1px solid var\(--border\)/);
  });

  it('turns the European Leagues buttons into one compact sideways-scrolling row on a phone and keeps the chosen league in view', () => {
    const phone = mediaRules(seasonCss, 550);
    expect(phone).toMatch(/\.league-picker-countries\{display:flex;[^}]*overflow-x:auto/);
    expect(phone).toContain('.league-picker-options{flex-direction:row}');
    expect(phone).toMatch(/\.league-option\{flex:none;width:172px/);
    // The desktop keeps the grouped grid.
    expect(seasonCss).toMatch(/^\.league-picker-countries\{display:grid;/m);
    expect(europe).toContain('<div ref={row} className="league-picker-countries">');
    expect(europe).toContain("container?.querySelector<HTMLElement>('.league-option.selected')");
  });

  it('keeps the Manager profile button in the narrow menu on tablets and phones', () => {
    const narrow = mediaRules(shellCss, 1050);
    expect(narrow).not.toMatch(/\.sidebar-bottom\s*\{\s*display:\s*none/);
    expect(narrow).toMatch(/\.game-shell \.sidebar-bottom \{ width: 100%;/);
    expect(narrow).toContain('.game-shell .sidebar-bottom .manager-identity');
    expect(narrow).toMatch(/\.game-shell \.sidebar-bottom \.manager-profile-button \{ justify-content: center;/);
    // Both the club and the unemployed shells label the button for the narrow menu's tooltip.
    expect(app.match(/id="manager-profile" className="manager manager-profile-button" title="Manager profile"/g)).toHaveLength(2);
  });

  it('wraps long names in the Desk\'s starting five so the Fouls column stays on screen', () => {
    expect(mediaRules(deskCss, 650)).toContain('.desk-player strong { white-space: normal; overflow-wrap: anywhere; }');
  });
});
