import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { BOARD_VERDICT_EFFECTS, seasonVerdict, verdictBudgets } from '../src/world/board-consequences';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { ClubBudgetBar } from '../src/ui/ClubBudgetBar';
import { playFirstSeason } from './helpers/board-funding';

const noop = () => {};
const board = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} />);
const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);
const club = 'rhine-falcons';
let complete: SeasonState, opening: SeasonState;

beforeAll(() => {
  complete = playFirstSeason(true);
  opening = rolloverSeason(complete);
}, 240_000);

describe('board page: season verdict and budgets', () => {
  it('offers older careers the switch, effective from the next season', () => {
    const html = board(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, boardConsequences: false }));
    expect(html).toContain('Let the season verdict set budgets');
    expect(html).toMatch(/id="enable-board-consequences"[^>]*>Enable season verdicts/);
    expect(html).toContain('This starts with 2027/28.');
    expect(html).not.toContain('data-board-verdict=');
  });

  it('previews next season from today\'s confidence before the final review', () => {
    const html = board(createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS }));
    expect(html).toContain('data-board-verdict="pending"');
    expect(html).toContain('data-board-verdict-current="standard"');
    expect(html).toContain('If the season ended today · 2027/28');
    expect(html).toContain('Steady · confidence 50');
    expect(html).toContain('data-board-next-staff="15000000"');
    expect(html).toContain('The verdict is given by the final review after matchday 10.');
    expect(html).toContain('Season verdicts: when switched on');
  });

  it('shows the final verdict and the budgets it sets for next season', () => {
    const verdict = seasonVerdict(complete.board, club, 1)!;
    const budgets = verdictBudgets(club, verdict.verdict);
    const html = board(complete);
    expect(html).toContain(`data-board-verdict="${verdict.verdict}"`);
    expect(html).toContain('Verdict for 2027/28');
    expect(html).toContain(`${BOARD_VERDICT_EFFECTS[verdict.verdict].label} · confidence ${verdict.confidence}`);
    expect(html).toContain(`data-board-next-staff="${budgets.staff}"`);
    expect(html).toContain(`data-board-next-capital="${budgets.capital}"`);
    expect(html).toContain('The verdict is final.');
  });

  it('explains in the new season which verdict set the budgets, also in the budget details', () => {
    const verdict = seasonVerdict(complete.board, club, 1)!;
    const html = board(opening);
    expect(html).toContain(`data-board-verdict-current="${verdict.verdict}"`);
    expect(html).toContain(`Set by the 2026/27 verdict: ${BOARD_VERDICT_EFFECTS[verdict.verdict].label} (confidence ${verdict.confidence})`);
    expect(html).toContain(`${money(verdictBudgets(club, verdict.verdict).staff)} staff budget`);
    const bar = renderToStaticMarkup(<ClubBudgetBar season={opening} onOpenClub={noop} onOpenStaff={noop} onOpenTransfers={noop} />);
    expect(bar).toContain(`data-budget-staff-total="${verdictBudgets(club, verdict.verdict).staff}"`);
    expect(bar).toContain(`${BOARD_VERDICT_EFFECTS[verdict.verdict].label} verdict, 2026/27`);
  });
});
