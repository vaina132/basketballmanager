import { useState, type InputHTMLAttributes, type Ref } from 'react'
import { formatEuros, moneyInputBounds, moneyInputText, parseMoneyInput, type DisplayCurrency } from './money-format'
import { useDisplayCurrency } from './use-currency'

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'> & {
  /** The amount in euro cents (how the game stores money). */
  cents: number
  onCents: (cents: number) => void
  minCents: number
  maxCents?: number
  stepCents: number
  ref?: Ref<HTMLInputElement>
  /** Show the stored euro amount under a dollar input (default true). */
  showEuros?: boolean
}

/**
 * A number input for money in the viewer's currency (owner, 24 November 2026). It shows and accepts euros or US dollars
 * while the amount stays in euro cents; in euros it behaves as the plain inputs always did. Typed text is kept while it
 * still reads as the current amount, so typing is never rewritten mid-way; a dollar input settles on the accepted amount
 * when it loses focus, and a note shows the euro amount the game keeps.
 */
export function MoneyInput({ cents, onCents, minCents, maxCents, stepCents, ref, onBlur, showEuros = true, ...rest }: MoneyInputProps) {
  const currency = useDisplayCurrency()
  const [draft, setDraft] = useState<{ text: string; currency: DisplayCurrency } | null>(null)
  const text = draft && draft.currency === currency && Object.is(parseMoneyInput(draft.text, currency, stepCents), cents) ? draft.text : moneyInputText(cents, currency)
  const input = <input ref={ref} type="number" {...moneyInputBounds(minCents, maxCents, stepCents, currency)} {...rest} data-money-currency={currency} value={text} onChange={event => { setDraft({ text: event.target.value, currency }); onCents(parseMoneyInput(event.target.value, currency, stepCents)) }} onBlur={event => { if (currency === 'USD') setDraft(null); onBlur?.(event) }} />
  return showEuros && currency === 'USD' ? <>{input}<MoneyInEuros cents={cents} /></> : input
}

/** The euro amount behind a dollar input, shown small (nothing in euros or for an empty amount). */
export function MoneyInEuros({ cents }: { cents: number }) {
  const currency = useDisplayCurrency()
  if (currency !== 'USD' || !Number.isFinite(cents) || cents <= 0) return null
  return <small className="money-input-euros" data-money-input-euros={cents}>Kept in euros: {formatEuros(cents, true)}</small>
}
