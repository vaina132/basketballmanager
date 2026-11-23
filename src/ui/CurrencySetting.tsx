import { DISPLAY_CURRENCIES, setDisplayCurrency, type DisplayCurrency } from './money-format'
import { useDisplayCurrency } from './use-currency'

const LABELS: Record<DisplayCurrency, string> = { EUR: 'Euros', USD: 'US dollars' }
const SYMBOLS: Record<DisplayCurrency, string> = { EUR: '€', USD: '$' }

/**
 * NBA step 6: the game setting for the currency every amount is shown in (euros by default, US dollars at the fixed
 * game rate of 1.16 dollars per euro). It changes the display only and is remembered in this browser.
 */
export function CurrencySetting() {
  const currency = useDisplayCurrency()
  return <div className="currency-setting" role="group" aria-label="Show money in"><span>Money</span><div className="segmented">{DISPLAY_CURRENCIES.map(item => <button key={item} type="button" aria-pressed={currency === item} title={LABELS[item]} data-currency={item} onClick={() => setDisplayCurrency(item)}>{SYMBOLS[item]} {item}</button>)}</div></div>
}
