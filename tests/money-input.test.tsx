import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { dollarInputReason, meetsMoneyRule, moneyInputBounds, moneyInputText, moneyRuleText, parseMoneyInput, setDisplayCurrency, USD_PER_EUR } from '../src/ui/money-format';
import { ReleaseClauseFields } from '../src/ui/ReleaseClause';
import { PlayerListingControl } from '../src/ui/PlayerListingControl';
import { InSeasonOfferDialog } from '../src/ui/InSeasonRecruitment';
import { MAX_CONTRACT_WAGE, MIN_CONTRACT_WAGE, WAGE_STEP } from '../src/world/employment-policy';
import { MAX_RELEASE_FEE, MIN_RELEASE_FEE, RELEASE_FEE_STEP } from '../src/world/release-clauses';
import { MIN_TRANSFER_FEE, TRANSFER_FEE_STEP } from '../src/world/transfers-policy';
import { getPlayerListing, setPlayerListing } from '../src/world/listings';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { economyPack } from './helpers/economy-pack';

/** Owner, 24 November 2026: money inputs accept and show the viewer's currency; the game keeps euro cents. */
const noop = () => {};
afterEach(() => setDisplayCurrency('EUR'));

describe('typing money in the chosen currency', () => {
  it('reads euros exactly as the inputs always did', () => {
    expect(moneyInputText(5_050_000, 'EUR')).toBe('50500');
    expect(moneyInputText(12_345, 'EUR')).toBe('123.45');
    expect(parseMoneyInput('50500', 'EUR', WAGE_STEP)).toBe(5_050_000);
    // Euros are never moved to a step: an off-step amount still meets the game's own euro rule message.
    expect(parseMoneyInput('50250', 'EUR', WAGE_STEP)).toBe(5_025_000);
    expect(parseMoneyInput('', 'EUR')).toBe(0);
    expect(parseMoneyInput('  ', 'USD')).toBe(0);
    expect(moneyInputBounds(MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP, 'EUR')).toEqual({ min: 5_000, max: 50_000, step: 500 });
  });

  it('shows stored euros in dollars at the game rate and reads them back to the same euro cents', () => {
    expect(moneyInputText(5_000_000, 'USD')).toBe('58000');
    expect(moneyInputText(5_050_000, 'USD')).toBe('58580');
    expect(moneyInputText(1, 'USD')).toBe('0.01');
    expect(moneyInputText(12_345, 'USD')).toBe(String(Math.round(12_345 * USD_PER_EUR) / 100));
    expect(moneyInputText(Number.NaN, 'USD')).toBe('');
    // Every euro cent amount survives the trip to dollars and back, step or no step.
    for (let cents = 0; cents <= 200_000; cents += 7) expect(parseMoneyInput(moneyInputText(cents, 'USD'), 'USD')).toBe(cents);
    for (let cents = MIN_CONTRACT_WAGE; cents <= MAX_CONTRACT_WAGE; cents += WAGE_STEP) expect(parseMoneyInput(moneyInputText(cents, 'USD'), 'USD', WAGE_STEP)).toBe(cents);
    for (const cents of [MIN_TRANSFER_FEE, 123_400_000, 5_000_000_000, 4_293_857_291]) expect(parseMoneyInput(moneyInputText(cents, 'USD'), 'USD')).toBe(cents);
  });

  it('rounds a typed dollar amount to the nearest euro cent, then to the nearest step the field accepts', () => {
    expect(parseMoneyInput('1', 'USD')).toBe(86); // $1 = €0.862...
    expect(parseMoneyInput('1.16', 'USD')).toBe(100);
    expect(parseMoneyInput('0.004', 'USD')).toBe(0);
    expect(parseMoneyInput('0.005', 'USD')).toBe(1); // half a dollar cent rounds up to one, then to €0.01
    expect(parseMoneyInput('60000', 'USD')).toBe(5_172_414); // €51,724.14
    expect(parseMoneyInput('60000', 'USD', WAGE_STEP)).toBe(5_150_000); // nearest €500: €51,500
    expect(parseMoneyInput('60320', 'USD', WAGE_STEP)).toBe(5_200_000);
    expect(parseMoneyInput('1500', 'USD', TRANSFER_FEE_STEP)).toBe(100_000);
    expect(parseMoneyInput('-580', 'USD', WAGE_STEP)).toBe(-50_000);
    expect(parseMoneyInput('1e400', 'USD', WAGE_STEP)).toBeNaN();
    // A typed amount keeps its value when shown again (no drift on repeated reading).
    const once = parseMoneyInput('61234.56', 'USD', WAGE_STEP);
    expect(parseMoneyInput(moneyInputText(once, 'USD'), 'USD', WAGE_STEP)).toBe(once);
    expect(moneyInputBounds(MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP, 'USD')).toEqual({ min: 5_800, max: 58_000, step: 580 });
    expect(moneyInputBounds(MIN_TRANSFER_FEE, undefined, TRANSFER_FEE_STEP, 'USD')).toEqual({ min: 1_160, step: 1_160 });
  });

  it('words input rules in the chosen currency, and leaves euros to the game', () => {
    expect(moneyRuleText('an annual wage', MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP, 'USD')).toBe('Choose an annual wage from $5,800 to $58,000 in $580 steps.');
    expect(moneyRuleText('an annual wage', MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP, 'EUR')).toBe('Choose an annual wage from €5,000 to €50,000 in €500 steps.');
    expect(meetsMoneyRule(4_150_000, MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP)).toBe(true);
    expect(meetsMoneyRule(4_025_000, MIN_CONTRACT_WAGE, MAX_CONTRACT_WAGE, WAGE_STEP)).toBe(false);
    const rules = [false, { cents: 6_000_000, minCents: MIN_CONTRACT_WAGE, maxCents: MAX_CONTRACT_WAGE, stepCents: WAGE_STEP, subject: 'an annual wage' }] as const;
    expect(dollarInputReason(rules, 'USD')).toBe('Choose an annual wage from $5,800 to $58,000 in $580 steps.');
    expect(dollarInputReason(rules, 'EUR')).toBeNull();
    expect(dollarInputReason([{ ...rules[1], cents: 5_000_000 }], 'USD')).toBeNull();
  });
});

describe('money inputs on screen', () => {
  it('shows the release amount in euros by default, unchanged', () => {
    const html = renderToStaticMarkup(<ReleaseClauseFields id="clause" value={10_000_000} onChange={noop} disabled={false} years={2} />);
    expect(html).toContain('Release amount (EUR)');
    expect(html).toMatch(/type="number" min="1000" max="500000" step="1000" id="clause-amount"[^>]*value="100000"/);
    expect(html).not.toContain('money-input-euros');
    const invalid = renderToStaticMarkup(<ReleaseClauseFields id="clause" value={50_000} onChange={noop} disabled={false} years={2} />);
    expect(invalid).toContain('Choose a release fee from EUR 1,000 to EUR 500,000 in EUR 1,000 steps, or no clause.');
  });

  it('shows and checks the release amount in dollars, with the euro amount kept', () => {
    setDisplayCurrency('USD');
    const html = renderToStaticMarkup(<ReleaseClauseFields id="clause" value={10_000_000} onChange={noop} disabled={false} years={2} />);
    expect(html).toContain('Release amount (USD)');
    expect(html).toMatch(/type="number" min="1160" max="580000" step="1160" id="clause-amount"[^>]*data-money-currency="USD" value="116000"/);
    expect(html).toContain('data-money-input-euros="10000000"');
    expect(html).toContain('Kept in euros: €100,000');
    const invalid = renderToStaticMarkup(<ReleaseClauseFields id="clause" value={MAX_RELEASE_FEE + RELEASE_FEE_STEP} onChange={noop} disabled={false} years={2} />);
    expect(invalid).toContain(`Choose a release fee from $1,160 to $580,000 in $1,160 steps, or no clause.`);
    expect(invalid).not.toContain('EUR 1,000');
    expect(MIN_RELEASE_FEE).toBe(100_000);
  });

  describe('the asking price on a player profile', () => {
    const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
    let listed: SeasonState;
    let askingFee = 0;
    let playerId = '';
    beforeAll(() => {
      const season = createSeason({ seed: 7, world: worldFromPack(pack, 'bbl'), managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
      playerId = season.clubs.find(club => club.id === 'bbl-1')!.players[6]!.id;
      listed = setPlayerListing(season, playerId, { transfer: true, loan: false, askingFee: 2_500_000 });
      askingFee = getPlayerListing(listed, playerId)!.askingFee;
    }, 120_000);
    const render = () => renderToStaticMarkup(<PlayerListingControl season={listed} playerId={playerId} busy={false} onListing={noop} />);

    it('reads in euros by default', () => {
      const html = render();
      expect(askingFee).toBe(2_500_000);
      expect(html).toContain('Asking price €');
      expect(html).toMatch(/type="number" min="1000" step="1000" inputMode="numeric"[^>]*data-money-currency="EUR" value="25000"/);
      expect(html).not.toContain('money-input-euros');
    });

    it('reads in dollars when chosen, with the euro amount the game keeps', () => {
      setDisplayCurrency('USD');
      const html = render();
      expect(html).toContain('Asking price $');
      expect(html).toMatch(/type="number" min="1160" step="1160" inputMode="numeric"[^>]*data-money-currency="USD" value="29000"/);
      expect(html).toContain('Kept in euros: €25,000');
      expect(html).toContain('Suggested $');
    });

    it('takes a midseason wage and transfer fee offer in the chosen currency', () => {
      const target = listed.clubs.find(club => club.id === 'bbl-2')!.players[3]!;
      const dialog = () => renderToStaticMarkup(<InSeasonOfferDialog season={listed} player={target} disabled={false} onClose={noop} onOffer={noop} onTransferOffer={noop} onWithdraw={noop} onOpenScouting={noop} onOpenMatch={noop} />);
      const euros = dialog();
      const wage = Number(euros.match(/id="in-season-wage"[^>]*value="(\d+)"/)![1]);
      const fee = Number(euros.match(/id="in-season-transfer-fee"[^>]*value="(\d+)"/)![1]);
      expect(euros).toContain('Annual salary offer (EUR)');
      expect(euros).toContain('Your fee offer (EUR)');
      expect(euros).toMatch(/type="number" min="5000" max="\d+" step="500" id="in-season-wage"/);
      setDisplayCurrency('USD');
      const dollars = dialog();
      expect(dollars).toContain('Annual salary offer (USD)');
      expect(dollars).toContain('Your fee offer (USD)');
      expect(dollars).toMatch(/type="number" min="5800" max="\d+" step="580" id="in-season-wage"/);
      expect(dollars).toContain(`value="${moneyInputText(wage * 100, 'USD')}"`);
      expect(dollars).toContain(`value="${moneyInputText(fee * 100, 'USD')}"`);
      expect(dollars).toContain(`data-money-input-euros="${wage * 100}"`);
      expect(dollars).not.toMatch(/EUR \d/);
    });
  });
});
