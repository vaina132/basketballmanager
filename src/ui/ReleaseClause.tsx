import type { ContractOfferOptions } from '../domain/employment'
import type { SeasonState } from '../domain/season'
import { getApplicableReleaseClause, maxReleaseFee, MIN_RELEASE_FEE, RELEASE_FEE_STEP, releaseFeeReason } from '../world/release-clauses'
import type { WorldContext } from '../domain/world'
import { quoteTransferOffer, requiredTransferFee } from '../world/transfers-policy'
import { quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../world/recruitment-policy'
import { transferMoney as money } from './TransferPaymentTerms'
import { Icon } from './Icon'
import './release-clause.css'

/** Keep contract talks reachable when the clause is affordable but the asking fee is not. */
export function transferEntryQuote(season: SeasonState, playerId: string, wage: number, inSeason = false) {
  const ordinary = inSeason ? quoteInSeasonTransferOffer(season, playerId, wage, 1, requiredInSeasonTransferFee(season, playerId)) : quoteTransferOffer(season, playerId, wage, 1, requiredTransferFee(season, playerId))
  const clause = getApplicableReleaseClause(season, playerId)
  if (ordinary.canOffer || !clause.canTrigger || clause.fee === null) return ordinary
  const options = { transferMode: 'release-clause' as const }
  const alternative = inSeason ? quoteInSeasonTransferOffer(season, playerId, wage, 1, clause.fee, season.managedClubId, 'upfront', undefined, options) : quoteTransferOffer(season, playerId, wage, 1, clause.fee, season.managedClubId, 'upfront', options)
  return alternative.canOffer ? alternative : ordinary
}

export function ReleaseClauseFields({ id, value, onChange, disabled, years, context }: { id: string; value: number | undefined; onChange: (value: number | undefined) => void; disabled: boolean; years: number; context?: WorldContext }) {
  const invalid = releaseFeeReason(value, context)
  return <section className="release-clause-fields" aria-labelledby={`${id}-title`}>
    <div className="release-clause-heading"><h3 id={`${id}-title`}><Icon name="shield" size={16} />New contract release clause</h3><label><input id={`${id}-enabled`} type="checkbox" checked={value !== undefined} onChange={event => onChange(event.target.checked ? 10_000_000 : undefined)} disabled={disabled} />Include clause</label></div>
    {value !== undefined ? <><div className="contract-offer-field"><label htmlFor={`${id}-amount`}>Release amount (EUR)</label><input id={`${id}-amount`} type="number" min={MIN_RELEASE_FEE / 100} max={maxReleaseFee(context) / 100} step={RELEASE_FEE_STEP / 100} value={value / 100} onChange={event => onChange(Math.round(Number(event.target.value) * 100))} disabled={disabled} aria-invalid={!!invalid} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`} /><input id={`${id}-slider`} type="range" min={MIN_RELEASE_FEE / 100} max={maxReleaseFee(context) / 100} step={RELEASE_FEE_STEP / 100} value={Math.max(MIN_RELEASE_FEE / 100, Math.min(maxReleaseFee(context) / 100, value / 100))} aria-label="New contract release amount slider" aria-valuetext={money(value)} onChange={event => onChange(Number(event.target.value) * 100)} disabled={disabled} /></div>{invalid && <p id={`${id}-error`} role="status">{invalid}</p>}<p id={`${id}-help`}>Another club can offer this amount in full on signing to approach the player without your fee approval. The player still chooses whether to leave.</p>{years === 3 && <small>Three-season deals have a lower salary demand with a release clause.</small>}</> : <small>No clause. Other clubs must negotiate a transfer fee with you.</small>}
  </section>
}

export function TransferApproach({ season, playerId, id, mode, onChange, disabled }: { season: SeasonState; playerId: string; id: string; mode: ContractOfferOptions['transferMode']; onChange: (value: NonNullable<ContractOfferOptions['transferMode']>) => void; disabled: boolean }) {
  const clause = getApplicableReleaseClause(season, playerId)
  if (clause.fee === null) return null
  return <fieldset className="transfer-approach" disabled={disabled} aria-describedby={!clause.canTrigger ? `${id}-reason` : `${id}-help`}><legend>Approach the player</legend><div className="transfer-payment-choices"><label><input type="radio" name={id} value="negotiated" checked={mode !== 'release-clause'} onChange={() => onChange('negotiated')} />Negotiate fee</label><label><input type="radio" name={id} value="release-clause" checked={mode === 'release-clause'} onChange={() => onChange('release-clause')} disabled={!clause.canTrigger} />Release clause &middot; {money(clause.fee)}</label></div>{clause.canTrigger ? <small id={`${id}-help`}>{mode === 'release-clause' ? 'Fixed fee, paid in full only if the player signs. Club fee approval is not needed.' : 'Choose whether to negotiate with the club or use the existing release clause.'}</small> : <small id={`${id}-reason`}>{clause.reason}</small>}</fieldset>
}

export function ReleaseClauseValue({ fee }: { fee?: number }) {
  return <span className="release-clause-value" data-release-fee={fee ?? 'none'}><Icon name="shield" size={13} />{fee === undefined ? 'No release clause' : `Release clause ${money(fee)}`}</span>
}
