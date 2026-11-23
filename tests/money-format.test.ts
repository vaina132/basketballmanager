import { afterEach, describe, expect, it } from 'vitest';
import { currencySymbol, formatEuros, formatExactEuros, formatExactMoney, formatMoney, getDisplayCurrency, setDisplayCurrency, subscribeDisplayCurrency, USD_PER_EUR } from '../src/ui/money-format';

/** NBA step 6: every amount follows the viewer's currency setting (euros by default, US dollars at 1.16 per euro). */
describe('the currency setting', () => {
  afterEach(() => setDisplayCurrency('EUR'));

  it('shows euros by default, exactly as before', () => {
    expect(getDisplayCurrency()).toBe('EUR');
    expect(formatMoney(420_000_000)).toBe('€4.2M');
    expect(formatMoney(2_431_000_000)).toBe('€24.31M');
    expect(formatMoney(1_234_500)).toBe(formatEuros(1_234_500));
    expect(formatMoney(-150_000_000)).toBe('-€1.5M');
    expect(formatMoney(12_345, true)).toBe(formatEuros(12_345, true));
    expect(formatExactMoney(1_234_567)).toBe(formatExactEuros(1_234_567));
    expect(currencySymbol()).toBe('€');
  });

  it('switches the whole game to US dollars at the game rate, and back', () => {
    const seen: string[] = [];
    const stop = subscribeDisplayCurrency(() => seen.push(getDisplayCurrency()));
    setDisplayCurrency('USD');
    expect(seen).toEqual(['USD']);
    // €142.21M (the NBA cap in euros) reads as the NBA's $164.96M.
    expect(formatMoney(14_220_775_862)).toBe('$164.96M');
    expect(formatMoney(100_000)).toBe(`$${Math.round(1_000 * USD_PER_EUR).toLocaleString('en-US')}`);
    expect(formatMoney(-500_000_000)).toBe('-$5.8M');
    expect(formatExactMoney(100)).toBe('$1.16');
    expect(currencySymbol()).toBe('$');
    // Game texts stay in euros whatever the viewer chooses.
    expect(formatEuros(420_000_000)).toBe('€4.2M');
    setDisplayCurrency('EUR');
    expect(seen).toEqual(['USD', 'EUR']);
    expect(formatMoney(420_000_000)).toBe('€4.2M');
    stop();
    setDisplayCurrency('USD');
    expect(seen).toHaveLength(2);
  });

  it('ignores an unknown currency', () => {
    setDisplayCurrency('GBP' as never);
    expect(getDisplayCurrency()).toBe('EUR');
  });
});
