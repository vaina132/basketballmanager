import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { getPlayerListing, playerListingReason, suggestedAskingFee, usesPlayerListings } from '../world/listings'
import { maxTransferFee, MIN_TRANSFER_FEE, TRANSFER_FEE_STEP } from '../world/transfers-policy'
import { Icon } from './Icon'
import { currencySymbol, formatMoney } from './money-format'
import { MoneyInEuros, MoneyInput } from './MoneyInput'
import { useDisplayCurrency } from './use-currency'
import './player-listing.css'

export type ListingChoice = { transfer: boolean; loan: boolean; askingFee?: number }

/**
 * Owner feedback (22 November 2026): put one of your players on the transfer list or the loan list. Listed players get
 * offers from other clubs more often; every offer arrives in the Inbox.
 */
export function PlayerListingControl({ season, playerId, busy, onListing }: { season: SeasonState; playerId: string; busy: boolean; onListing: (playerId: string, choice: ListingChoice) => void }) {
  const listing = getPlayerListing(season, playerId)
  const suggested = suggestedAskingFee(season, playerId)
  // Typed in the viewer's currency (owner, 24 November 2026); kept as euro cents.
  const [price, setPrice] = useState(() => Math.round((listing?.askingFee ?? suggested) / 100) * 100)
  const currency = useDisplayCurrency()
  if (!usesPlayerListings(season) || playerListingReason(season, playerId)) return null
  const transfer = listing?.transfer ?? false, loan = listing?.loan ?? false
  const typed = Math.round(price / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP
  const askingFee = Number.isFinite(typed) ? Math.min(maxTransferFee(season), Math.max(MIN_TRANSFER_FEE, typed)) : suggested
  const choose = (next: { transfer: boolean; loan: boolean }) => onListing(playerId, { ...next, askingFee })
  // Simplify pass (owner, 22 November 2026): closed until used; a listed player shows it open.
  return <details className="game-disclosure player-listing-more" open={transfer || loan ? true : undefined}><summary><Icon name="swap" size={14} />{transfer && loan ? 'On transfer and loan list' : transfer ? 'On transfer list' : loan ? 'On loan list' : 'Sell or loan'}</summary><section className="player-listing" aria-label="Transfer and loan list" data-player-listing={playerId} data-listed-transfer={transfer} data-listed-loan={loan}>
    <div className="player-listing-toggles">
      <button className={`button small${transfer ? ' primary' : ''}`} aria-pressed={transfer} data-listing-transfer={playerId} onClick={() => choose({ transfer: !transfer, loan })} disabled={busy}><Icon name="swap" size={14} />{transfer ? 'On transfer list' : 'Transfer list'}</button>
      <button className={`button small${loan ? ' primary' : ''}`} aria-pressed={loan} data-listing-loan={playerId} onClick={() => choose({ transfer, loan: !loan })} disabled={busy}><Icon name="clock" size={14} />{loan ? 'On loan list' : 'Loan list'}</button>
    </div>
    <label className="player-listing-price">Asking price {currencySymbol(currency)}<MoneyInput inputMode="numeric" minCents={MIN_TRANSFER_FEE} stepCents={TRANSFER_FEE_STEP} cents={price} onCents={setPrice} showEuros={false} onBlur={() => { if (transfer && askingFee !== listing?.askingFee) choose({ transfer, loan }) }} disabled={busy} aria-describedby={`listing-note-${playerId}`} /></label><MoneyInEuros cents={askingFee} />
    <small id={`listing-note-${playerId}`}>Suggested {formatMoney(suggested)}. Listed players get more offers; offers arrive in the Inbox.</small>
  </section></details>
}
