const wholeEuros = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const euroCents = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dollarCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

/**
 * Euro cents for display. Researched club budgets (format 62) reach tens of millions, so one million euros and more
 * read as millions with up to two decimals ("€4.2M", "€24.31M"); smaller sums keep whole euros, or cents when `precise`.
 * Always euros: game rules and saved texts use it (`formatMoney` follows the viewer's currency setting).
 */
export function formatEuros(amount: number, precise = false): string {
  return format(amount, precise, 'EUR')
}

/** Exact euro cents for detailed accounting rows, whatever the size (always euros). */
export const formatExactEuros = (amount: number): string => euroCents.format(amount / 100)

/**
 * NBA step 6 (owner, 23 November 2026): the currency the whole game shows money in. Euros by default; US dollars on
 * request. Money stays stored in euro cents; dollars are shown at the fixed game rate `USD_PER_EUR` (reversible). The
 * choice belongs to the viewer (this browser), never to a career or its save.
 */
export type DisplayCurrency = 'EUR' | 'USD'
export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = ['EUR', 'USD']
export const USD_PER_EUR = 1.16
const STORAGE_KEY = 'courtside.currency'

function stored(): DisplayCurrency {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) === 'USD' ? 'USD' : 'EUR' } catch { return 'EUR' }
}
let current: DisplayCurrency = stored()
const listeners = new Set<() => void>()

/** The currency money is shown in now. */
export const getDisplayCurrency = (): DisplayCurrency => current

/** Shows every amount in the game in this currency from now on, and remembers the choice in this browser. */
export function setDisplayCurrency(currency: DisplayCurrency): void {
  if (!DISPLAY_CURRENCIES.includes(currency) || currency === current) return
  current = currency
  try { globalThis.localStorage?.setItem(STORAGE_KEY, currency) } catch { /* the browser may block storage; the choice then lasts this visit */ }
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the display currency changes; returns the way to stop. */
export const subscribeDisplayCurrency = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

function format(amount: number, precise: boolean, currency: DisplayCurrency): string {
  const value = currency === 'USD' ? amount / 100 * USD_PER_EUR : amount / 100
  const symbol = currency === 'USD' ? '$' : '€'
  if (Math.abs(value) >= 1_000_000) {
    const millions = Math.round(Math.abs(value) / 10_000) / 100
    return `${value < 0 ? '-' : ''}${symbol}${millions.toLocaleString(currency === 'USD' ? 'en-US' : 'en-IE', { maximumFractionDigits: 2 })}M`
  }
  // Dollars are a conversion: whole dollars unless cents are asked for.
  return currency === 'USD' ? (precise ? dollarCents : wholeDollars).format(value) : (precise ? euroCents : wholeEuros).format(value)
}

/** Euro cents shown in the viewer's currency (euros by default, or US dollars at the game rate): every amount on screen. */
export function formatMoney(amount: number, precise = false, currency: DisplayCurrency = current): string {
  return format(amount, precise, currency)
}

/** Exact amounts for detailed accounting rows in the viewer's currency. */
export const formatExactMoney = (amount: number, currency: DisplayCurrency = current): string => currency === 'USD' ? dollarCents.format(amount / 100 * USD_PER_EUR) : euroCents.format(amount / 100)

/** The currency's symbol (for labels next to amounts typed in euros). */
export const currencySymbol = (currency: DisplayCurrency = current): string => currency === 'USD' ? '$' : '€'

/**
 * Money typed into an input, in the viewer's currency (owner, 24 November 2026). Inputs show and accept the chosen
 * currency; the game still stores euro cents. Euros behave exactly as before. Dollars convert at `USD_PER_EUR`: a stored
 * amount is shown to the nearest dollar cent, and a typed dollar amount becomes the nearest euro cent, then the nearest
 * amount the field accepts (its euro step, e.g. €500 for wages), so a typed dollar value never fails a euro step rule.
 * Showing a stored amount and reading it back always returns the same euro cents.
 */
export function moneyInputText(cents: number, currency: DisplayCurrency = current): string {
  if (!Number.isFinite(cents)) return ''
  return currency === 'USD' ? String(Math.round(cents * USD_PER_EUR) / 100) : String(cents / 100)
}

/** Euro cents from text typed in `currency`; blank reads as 0 (as the inputs always did). */
export function parseMoneyInput(text: string, currency: DisplayCurrency = current, stepCents = 1): number {
  if (!text.trim()) return 0
  const typed = Number(text)
  if (currency === 'EUR') return Math.round(typed * 100)
  if (!Number.isFinite(typed)) return Number.NaN
  const cents = Math.round(Math.round(typed * 100) / USD_PER_EUR)
  return stepCents > 1 ? Math.round(cents / stepCents) * stepCents : cents
}

/** The `min`, `max` and `step` attributes of a money input, in the viewer's currency. */
export function moneyInputBounds(minCents: number, maxCents: number | undefined, stepCents: number, currency: DisplayCurrency = current): { min: number; max?: number; step: number } {
  const unit = (cents: number) => currency === 'USD' ? Math.round(cents * USD_PER_EUR) / 100 : cents / 100
  return { min: unit(minCents), ...(maxCents === undefined ? {} : { max: unit(maxCents) }), step: unit(stepCents) }
}

/** Whether euro cents meet a money input's range and step. */
export const meetsMoneyRule = (cents: number, minCents: number, maxCents: number, stepCents: number): boolean => Number.isSafeInteger(cents) && cents >= minCents && cents <= maxCents && cents % stepCents === 0

/** A money input's rule in the viewer's currency, e.g. "Choose an annual wage from $5,800 to $58,000 in $580 steps." */
export function moneyRuleText(subject: string, minCents: number, maxCents: number, stepCents: number, currency: DisplayCurrency = current, suffix = ''): string {
  const show = (cents: number) => formatMoney(cents, true, currency)
  return `Choose ${subject} from ${show(minCents)} to ${show(maxCents)} in ${show(stepCents)} steps${suffix}.`
}

export interface MoneyInputRule { cents: number; minCents: number; maxCents: number; stepCents: number; subject: string; suffix?: string }

/**
 * The first broken money-input rule, worded in dollars, while the viewer shows dollars. In euros it returns null, so the
 * game's own euro wording is shown exactly as before.
 */
export function dollarInputReason(rules: readonly (MoneyInputRule | false | null | undefined)[], currency: DisplayCurrency = current): string | null {
  if (currency !== 'USD') return null
  const broken = rules.find((rule): rule is MoneyInputRule => !!rule && !meetsMoneyRule(rule.cents, rule.minCents, rule.maxCents, rule.stepCents))
  return broken ? moneyRuleText(broken.subject, broken.minCents, broken.maxCents, broken.stepCents, currency, broken.suffix) : null
}
