import { clubRosterLimit } from '../world/club-roster-policy'
import { PlayerCareerStatus } from './PlayerLifecycle'
import { getCareerPlayer, getCareerWage } from '../world/player-catalog'
import type { ContractOfferOptions } from '../domain/employment'
import { useEffect, useRef, useState } from 'react'
import type { InSeasonOffer } from '../domain/recruitment'
import type { SeasonState } from '../domain/season'
import type { TransferPaymentPlan } from '../domain/transfer-payments'
import type { Player } from '../domain/types'
import { contractForSeason, MAX_CONTRACT_SEASONS, MAX_CONTRACT_WAGE, MIN_CONTRACT_WAGE, WAGE_STEP } from '../world/employment-policy'
import { getInSeasonBudget, getInSeasonOffers, getReservedInSeasonFees, isLiveInSeasonOffer, quoteInSeasonOffer, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../world/recruitment-policy'
import { requiredNegotiationWage } from '../world/negotiations-policy'
import { MAX_TRANSFER_FEE, MIN_TRANSFER_FEE, TRANSFER_FEE_STEP } from '../world/transfers-policy'
import { TRANSFER_PAYMENT_PLANS } from '../world/transfer-payments'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { dateForRound, MAX_SEASON_NUMBER, seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { InSeasonIncomingTransfers, type InSeasonClubDecision } from './InSeasonIncomingTransfers'
import { TransferPaymentRecord } from './TransferPaymentsPanel'
import { TransferPaymentTerms, transferMoney as money } from './TransferPaymentTerms'
import { getApplicableReleaseClause, releaseFeeReason } from '../world/release-clauses'
import { ReleaseClauseFields, ReleaseClauseValue, TransferApproach } from './ReleaseClause'
import './in-season-recruitment.css'
import { seasonRounds } from '../world/career-world'

export const inSeasonOfferStatus = (offer: InSeasonOffer) => {
  if (offer.status === 'club-review') return 'Awaiting club decision'
  if (offer.transfer && offer.status === 'pending') return 'Awaiting player reply'
  if (offer.transfer?.clubStatus === 'countered' && offer.status === 'countered') return 'Club counteroffer'
  if (offer.transfer?.clubStatus === 'rejected' && offer.status === 'rejected') return 'Club declined'
  return ({ pending: 'Awaiting reply', accepted: offer.transfer ? 'Transferred' : 'Signed', countered: 'Player counteroffer', rejected: 'Rejected', withdrawn: 'Withdrawn', replaced: 'Replaced', lost: 'Chose another club', cancelled: 'Cancelled', expired: 'Expired' })[offer.status]
}
const inSeasonOfferReason = (offer: InSeasonOffer) => offer.transfer && ['countered', 'rejected'].includes(offer.transfer.clubStatus) ? offer.transfer.clubReason ?? offer.reason : offer.reason ?? offer.transfer?.clubReason
export type InSeasonTransferOfferAction = (playerId: string, seasonWage: number, seasons: number, fee: number, paymentPlan: TransferPaymentPlan, options?: ContractOfferOptions) => void

function OfferRows({ season, offers, disabled, onReview, onWithdraw, onOpenAcademy }: { season: SeasonState; offers: InSeasonOffer[]; disabled: boolean; onReview: (playerId: string) => void; onWithdraw: (offerId: string) => void; onOpenAcademy: () => void }) {
  return <div className="in-season-offers">{offers.map(offer => {
    const player = getCareerPlayer(season, offer.playerId)
    return <article key={offer.id} className="in-season-offer-row" data-in-season-offer={offer.id} data-offer-status={offer.status}>
      <div className="in-season-player"><Avatar player={player} color={season.clubs.find(club => club.id === offer.clubId)?.color ?? '#687385'} size={34} /><div><strong>{player.name}</strong><small>{offer.academyProspectId ? 'Academy promotion' : player.position} &middot; {money(offer.seasonWage)} / year{offer.transfer && <> &middot; {money(offer.transfer.fee)} fee</>}</small></div></div>
      <div className="in-season-reply"><strong>{inSeasonOfferStatus(offer)}</strong><small>{offer.status === 'club-review' ? 'Club decision before Continue; arrival' : offer.status === 'pending' ? 'Reply' : offer.status === 'accepted' ? 'Joined' : 'Closed'} <time dateTime={offer.closedOn ?? offer.responseOn}>{scoutingDate(offer.closedOn ?? offer.responseOn)}</time>{offer.seasonNumber !== season.seasonNumber ? ` · ${seasonLabel(offer.seasonNumber)}` : ''}</small></div>
      <div className="in-season-row-actions"><button className="button small" data-review-in-season={offer.id} aria-label={`Review current-season offer for ${player.name}`} onClick={() => offer.academyProspectId ? onOpenAcademy() : onReview(player.id)} disabled={disabled}>{offer.academyProspectId ? 'Academy' : 'Review'}<Icon name="chevron" size={13} /></button>{isLiveInSeasonOffer(offer) && <button className="text-button" data-withdraw-in-season={offer.id} aria-label={`Withdraw current-season offer for ${player.name}`} onClick={() => onWithdraw(offer.id)} disabled={disabled}>Withdraw</button>}</div>
    </article>
  })}</div>
}

export function InSeasonRecruitmentPanel({ season, disabled, onEnable, onReview, onWithdraw, onOpenMatch, onBrowse, onEnableTransfers, onClubDecision, onOpenAcademy }: { season: SeasonState; disabled: boolean; onEnable: () => void; onEnableTransfers: () => void; onClubDecision: InSeasonClubDecision; onReview: (playerId: string) => void; onWithdraw: (offerId: string) => void; onOpenMatch: () => void; onBrowse: () => void; onOpenAcademy: () => void }) {
  const enabled = season.recruitment.enabledSince !== null
  const transfersEnabled = season.recruitment.transfersEnabledSince !== null
  const transferReserve = getReservedInSeasonFees(season, season.managedClubId)
  const active = season.status === 'active'
  const budget = getInSeasonBudget(season)
  const pending = getInSeasonOffers(season, season.managedClubId, true)
  const history = [...season.recruitment.offers].reverse().filter(offer => offer.clubId === season.managedClubId && !isLiveInSeasonOffer(offer))
  const latest = history.filter(offer => offer.seasonNumber === season.seasonNumber && (offer.responseRound === season.round || offer.closedOn === season.date) && !['replaced', 'withdrawn'].includes(offer.status))
  const enableReason = !season.employment.enabledSince ? 'Enable player contracts first.' : !season.negotiations.enabledSince ? 'Enable contract negotiations first.' : !season.finance.enabledSince || !season.payroll.enabledSince ? 'Enable club finances and player payroll first.' : !active ? 'Start the next season to enable in-season recruitment.' : null
  const hasIncoming = season.recruitment.offers.some(offer => offer.transfer?.sellerClubId === season.managedClubId)
  if (!active && !history.length && !hasIncoming) return null
  return <section className="in-season-recruitment panel" aria-labelledby="in-season-recruitment-title">
    <header className="transfers-heading"><div><h2 id="in-season-recruitment-title">This season's recruitment</h2><span>{seasonLabel(season.seasonNumber)} &middot; {transfersEnabled ? 'Recruitment & sales' : 'Free agents'}</span></div>{active && enabled && <button id="browse-in-season-players" className="button small" onClick={onBrowse} disabled={disabled}>Available players<Icon name="search" size={14} /></button>}</header>
    {!enabled ? <div className="in-season-enable"><p>Offer free agents a contract until the end of this season. Replies arrive when the next matchday is prepared.</p>{enableReason && <p id="in-season-enable-reason">{enableReason}</p>}<button id="enable-in-season-recruitment" className="button primary" disabled={disabled || !!enableReason} onClick={onEnable} aria-describedby={enableReason ? 'in-season-enable-reason' : undefined}>Enable in-season recruitment</button></div> : <>
      {active && <><div className="in-season-summary"><div><Icon name="people" size={21} /><span><small>Current squad</small><strong data-in-season-roster={budget.rosterSize}>{budget.rosterSize} / {clubRosterLimit(season)}{budget.reservedRosterSize > 0 && <em> + {budget.reservedRosterSize} held</em>}</strong></span></div><div><Icon name="wallet" size={21} /><span><small>Salary budget left this season</small><strong data-in-season-salary-budget={budget.remainingBudget}>{money(budget.remainingBudget)}<em> / year</em></strong></span></div><div><Icon name="calendar" size={21} /><span><small>Next player reply</small><strong>{season.round < seasonRounds(season) ? scoutingDate(dateForRound(season.round + 1, season.seasonNumber)) : 'Window closed'}</strong></span></div></div>{season.round === seasonRounds(season) && <p className="transfers-note">No further registration date this season. Finish the matchday to open offseason recruitment.</p>}</>}
      {active && !transfersEnabled && <div className="in-season-transfers-enable"><span><strong>Club transfers</strong><small>Negotiate fees and contracts for players at other clubs.</small></span><button id="enable-in-season-transfers" className="button small" onClick={onEnableTransfers} disabled={disabled}>Enable midseason transfers<Icon name="swap" size={14} /></button></div>}
      {transfersEnabled && <InSeasonIncomingTransfers season={season} disabled={disabled} onDecision={onClubDecision} />}
      {pending.length > 0 && <><OfferRows onOpenAcademy={onOpenAcademy} season={season} offers={pending} disabled={disabled} onReview={onReview} onWithdraw={onWithdraw} /><div className="in-season-queue-footer"><span><Icon name="clock" size={15} />{money(budget.remainingWagesReserved + transferReserve)} reserved for salaries{transferReserve > 0 && ' and fees'}</span><button className="button small" onClick={onOpenMatch} disabled={disabled}>Match center<Icon name="chevron" size={14} /></button></div></>}
      {latest.length > 0 && <OfferRows onOpenAcademy={onOpenAcademy} season={season} offers={latest} disabled={disabled} onReview={onReview} onWithdraw={onWithdraw} />}
      <details className="game-disclosure"><summary><Icon name="wallet" size={15} />This season's salary budget &amp; offer history</summary><dl className="transfers-summary"><div><dt>Annual salary limit</dt><dd>{money(budget.budget)}</dd></div><div><dt>Signed salaries / year</dt><dd>{money(budget.seasonWages)}</dd></div><div><dt>Pending offers / year</dt><dd>{money(budget.reservedWages)}</dd></div><div><dt>Remaining salary costs held</dt><dd>{money(budget.remainingWagesReserved)}</dd></div>{transferReserve > 0 && <div><dt>Transfer fees held</dt><dd>{money(transferReserve)}</dd></div>}</dl><p className="transfers-note">Offers reserve an annual salary allowance, remaining salary costs and a squad place. Paid transfers also reserve the full fee. Accepted players join next matchday; the current match stays unchanged. Counteroffers release these reservations. The salary budget at the top covers next season, including any multi-season offers.</p>{history.length > 0 ? <OfferRows onOpenAcademy={onOpenAcademy} season={season} offers={history} disabled={disabled} onReview={onReview} onWithdraw={onWithdraw} /> : <p className="transfers-empty">No current-season offers recorded yet.</p>}</details>
    </>}
  </section>
}

export function InSeasonPlayers({ season, players, filtered, disabled, onReview, onOpenScouting, onShortlist, paid = false }: { paid?: boolean; season: SeasonState; players: readonly Player[]; filtered: boolean; disabled: boolean; onReview: (playerId: string) => void; onOpenScouting: (playerId: string) => void; onShortlist: (playerId: string, shortlisted: boolean) => void }) {
  const pending = getInSeasonOffers(season, season.managedClubId, true)
  const shortlist = season.scouting.clubs[season.managedClubId]!.shortlist
  return <div className="transfers-table-scroll" tabIndex={0} role="region" aria-label={paid ? 'Contracted players for this season' : 'Free agents for this season'}><table className="transfers-table in-season-players"><thead><tr><th scope="col">Player</th><th scope="col">{paid ? 'Club asking fee' : 'Annual demand'}</th><th scope="col">{paid ? 'Annual demand' : 'Remaining season cost'}</th><th scope="col">Knowledge</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
    const owner = season.clubs.find(club => club.players.some(item => item.id === player.id))
    const quote = paid ? quoteInSeasonTransferOffer(season, player.id, getCareerWage(season, player.id), 1, requiredInSeasonTransferFee(season, player.id)) : quoteInSeasonOffer(season, player.id, getCareerWage(season, player.id))
    const entryQuote = paid ? quoteInSeasonTransferOffer(season, player.id, MIN_CONTRACT_WAGE, 1, MIN_TRANSFER_FEE) : quoteInSeasonOffer(season, player.id, MIN_CONTRACT_WAGE)
    const offer = pending.find(item => item.playerId === player.id)
    return <tr key={player.id} data-in-season-player={player.id}><th scope="row"><button className="transfers-player transfers-player-report" onClick={() => onOpenScouting(player.id)} disabled={disabled} aria-label={`Scouting report for ${player.name}`}><Avatar player={owner?.players.find(item => item.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={34} /><span><strong>{player.name}</strong><small>{player.position} &middot; {player.heightCm} cm &middot; {owner?.name ?? 'Free agent'}</small></span></button></th><td>{money(paid ? requiredInSeasonTransferFee(season, player.id) : getCareerWage(season, player.id))}{paid && getApplicableReleaseClause(season, player.id).fee !== null && <ReleaseClauseValue fee={getApplicableReleaseClause(season, player.id).fee!} />}</td><td>{money(paid ? getCareerWage(season, player.id) : quote.remainingWages)}{!paid && <small>At annual demand</small>}</td><td className="transfers-knowledge"><span>{knowledgeLabel(getPlayerKnowledge(season, player.id))}</span><button className="text-button" aria-pressed={shortlist.includes(player.id)} aria-label={`${shortlist.includes(player.id) ? 'Remove' : 'Add'} ${player.name} ${shortlist.includes(player.id) ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !shortlist.includes(player.id))} disabled={disabled || !season.scouting.enabledSince}>{shortlist.includes(player.id) ? 'Shortlisted' : 'Add to shortlist'}</button></td><td className="transfers-action"><button className="button small" data-in-season-approach={player.id} onClick={() => onReview(player.id)} disabled={disabled || !entryQuote.canOffer && !offer} aria-label={`${offer ? 'Review current-season offer for' : paid ? 'Offer current-season transfer for' : 'Sign for this season:'} ${player.name}`}>{offer ? 'Review offer' : paid ? 'Offer transfer' : 'Sign for this season'}<Icon name="chevron" size={13} /></button>{!entryQuote.canOffer && !offer && <details className="transfer-unavailable"><summary>Unavailable</summary><small>{entryQuote.reason}</small></details>}</td></tr>
  })}{!players.length && <tr><td colSpan={5} className="transfers-empty">{filtered ? 'No players match these filters.' : paid ? 'No contracted players can be approached this season.' : 'No free agents are available. Every player in this league has a contract for this season.'}</td></tr>}</tbody></table></div>
}

export function InSeasonOfferDialog({ season, player, disabled, onClose, onOffer, onTransferOffer, onWithdraw, onOpenScouting, onOpenMatch }: { season: SeasonState; player: Player; disabled: boolean; onClose: () => void; onOffer: (playerId: string, seasonWage: number, options?: ContractOfferOptions) => void; onTransferOffer: InSeasonTransferOfferAction; onWithdraw: (offerId: string) => void; onOpenScouting: (playerId: string) => void; onOpenMatch: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const wageInput = useRef<HTMLInputElement>(null)
  const feeInput = useRef<HTMLInputElement>(null)
  const status = useRef<HTMLElement>(null)
  const offers = season.recruitment.offers.filter(offer => offer.playerId === player.id && offer.clubId === season.managedClubId)
  const latest = offers.at(-1)
  const current = latest?.seasonNumber === season.seasonNumber ? latest : null
  const pending = current && isLiveInSeasonOffer(current) ? current : null
  const response = current?.negotiationId ? season.negotiations.records.find(record => record.id === current.negotiationId) : null
  const contract = contractForSeason(season.employment, player.id, season.seasonNumber)
  const paid = current?.status === 'accepted' ? !!current.transfer : !!current?.transfer || !!contract && contract.clubId !== season.managedClubId
  const [wage, setWage] = useState(String((current?.seasonWage ?? getCareerWage(season, player.id)) / 100))
  const [years, setYears] = useState(paid ? current?.seasons ?? 1 : 1)
  const [fee, setFee] = useState(String((current?.transfer?.fee ?? requiredInSeasonTransferFee(season, player.id)) / 100))
  const [paymentPlan, setPaymentPlan] = useState<TransferPaymentPlan>(current?.transfer?.paymentPlan ?? 'upfront')
  const clause = getApplicableReleaseClause(season, player.id)
  const [releaseFee, setReleaseFee] = useState<number | undefined>(current?.releaseFee)
  const [transferMode, setTransferMode] = useState<NonNullable<ContractOfferOptions['transferMode']>>(current?.transfer?.mode ?? 'negotiated')
  const demandReleaseFee = releaseFeeReason(releaseFee) ? undefined : releaseFee
  const usingClause = paid && transferMode === 'release-clause'
  const effectivePlan = usingClause ? 'upfront' : paymentPlan
  const options: ContractOfferOptions = { ...(releaseFee !== undefined ? { releaseFee } : {}), ...(usingClause ? { transferMode } : {}) }
  const annual = wage.trim() ? Math.round(Number(wage) * 100) : 0
  const transferFee = usingClause ? clause.fee ?? current?.transfer?.fee ?? 0 : fee.trim() ? Math.round(Number(fee) * 100) : 0
  const transferQuote = paid ? quoteInSeasonTransferOffer(season, player.id, annual, years, transferFee, season.managedClubId, effectivePlan, undefined, options) : null
  const quote = transferQuote ?? quoteInSeasonOffer(season, player.id, annual, season.managedClubId, undefined, options)
  const signed = current?.status === 'accepted'
  const unchanged = !!pending && pending.seasonWage === annual && pending.releaseFee === releaseFee && (!paid || pending.seasons === years && pending.transfer?.fee === transferFee && pending.transfer.paymentPlan === effectivePlan && (pending.transfer.mode ?? 'negotiated') === transferMode)
  const reason = quote.reason ?? (unchanged ? 'Awaiting a reply. Change the terms to replace this offer.' : null)
  const lastStatus = useRef(current ? `${current.id}:${current.status}:${current.transfer?.clubStatus ?? ''}` : '')
  const owner = season.clubs.find(club => club.players.some(item => item.id === player.id))
  const signedClub = season.clubs.find(club => club.id === current?.clubId)
  const seller = season.clubs.find(club => club.id === (current?.transfer?.sellerClubId ?? transferQuote?.sellerClubId))
  const completedTransfer = current ? season.employment.transfers.find(item => item.offerId === current.id) : null
  const chosenOffer = current?.chosenOfferId ? season.recruitment.offers.find(item => item.id === current.chosenOfferId) : null
  const chosenClub = season.clubs.find(club => club.id === chosenOffer?.clubId)
  const clubApproved = current?.transfer?.clubStatus === 'accepted'
  const clubCounter = current?.status === 'countered' && current.transfer?.clubStatus === 'countered' ? current.transfer.counterFee : null
  const canRegister = season.status === 'active' && season.round < seasonRounds(season)
  const endsSeason = transferQuote?.endsSeason ?? season.seasonNumber
  const firstPayment = transferQuote?.installments[0]?.amount ?? 0
  const validYears = Number.isInteger(years) && years >= 1 && years <= MAX_CONTRACT_SEASONS
  const demand = requiredNegotiationWage(player.id, validYears ? years : 1, demandReleaseFee, season)

  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    close.current?.focus({ preventScroll: true })
    return () => { element.close(); if (previous?.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true }); else document.getElementById('transfers-heading')?.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const key = current ? `${current.id}:${current.status}:${current.transfer?.clubStatus ?? ''}` : ''
    if (!disabled && key !== lastStatus.current) { status.current?.focus({ preventScroll: true }); lastStatus.current = key }
  }, [current, disabled])

  function sendOffer() {
    if (disabled || reason) return
    if (paid) onTransferOffer(player.id, annual, years, transferFee, effectivePlan, options)
    else onOffer(player.id, annual, options)
  }

  return <dialog ref={dialog} id="in-season-contract-offer" className={`contract-offer in-season-dialog${paid ? ' in-season-paid-dialog' : ''}`} aria-labelledby="in-season-offer-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className="transfers-heading"><div className="in-season-player"><Avatar player={owner?.players.find(item => item.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={44} /><div><h2 id="in-season-offer-title">{signed ? paid ? 'Transfer completed' : 'Player signed' : paid ? 'Offer midseason transfer' : 'Sign for this season'}</h2><span>{player.name} &middot; {player.position}{paid && seller && <> &middot; {seller.name}</>}</span></div></div></header>
    <div className="contract-offer-body"><PlayerCareerStatus season={season} playerId={player.id} />
      {paid && <div className="in-season-transfer-route" aria-label="Transfer agreement stages"><span className={clubApproved ? 'complete' : 'current'}><Icon name={clubApproved ? 'check' : 'building'} size={16} /><strong>{usingClause ? 'Release clause' : 'Club fee'}</strong></span><Icon name="chevron" size={13} /><span className={signed ? 'complete' : clubApproved ? 'current' : ''}><Icon name={signed ? 'check' : 'people'} size={16} /><strong>Player reply</strong></span><Icon name="chevron" size={13} /><span className={signed ? 'complete' : ''}><Icon name={signed ? 'check' : 'calendar'} size={16} /><strong>Registration</strong></span></div>}
      {current && <section ref={status} tabIndex={-1} className="contract-player-response" aria-label="Current-season offer status" data-in-season-status={current.status} data-club-status={current.transfer?.clubStatus}>
        <div><h3>{inSeasonOfferStatus(current)}</h3><time dateTime={current.closedOn ?? current.responseOn}>{scoutingDate(current.closedOn ?? current.responseOn)}</time></div>
        <p>{current.status === 'club-review' ? `${seller?.name ?? 'The selling club'} must approve the fee before Continue. If approved, the player replies on Matchday ${current.responseRound}.` : current.status === 'pending' ? `${paid ? current.transfer?.mode === 'release-clause' ? 'Release clause triggered. ' : 'Club fee approved. ' : ''}Player reply on Matchday ${current.responseRound}; accepted players join when that matchday is prepared.` : current.status === 'accepted' ? `Joined ${signedClub?.name ?? 'your club'} through ${seasonLabel(current.seasonNumber + current.seasons - 1)}. Salary charges begin on Matchday ${current.responseRound}.` : current.status === 'lost' && chosenClub ? `The player chose ${chosenClub.name}.` : inSeasonOfferReason(current) ?? 'This offer has closed.'}</p>
        {!isLiveInSeasonOffer(current) && current.status !== 'accepted' && <small>Salary, fee and squad reservations released.</small>}
        {clubCounter !== null && <div className="contract-response-option"><span>Club asking fee<strong>{money(clubCounter)}</strong></span><button id="use-in-season-club-counter" className="button small" onClick={() => { setFee(String(clubCounter / 100)); feeInput.current?.focus() }} disabled={disabled}>Use club asking fee</button></div>}
        {current.status === 'countered' && response?.counterOffer && <div className="contract-response-option"><span>Requested annual salary<strong>{money(response.counterOffer.seasonWage)}</strong></span><button id="use-in-season-counter" className="button small" onClick={() => { setWage(String(response.counterOffer!.seasonWage / 100)); setReleaseFee(response.counterOffer!.releaseFee); if (paid) setYears(response.counterOffer!.seasons); wageInput.current?.focus() }} disabled={disabled}>Use counteroffer</button></div>}
      </section>}
      {signed && current ? <><dl className="contract-offer-facts"><div><dt>Annual salary</dt><dd>{money(current.seasonWage)}</dd></div><div><dt>Salary for this season's remaining matchdays</dt><dd>{money(current.remainingWages)}</dd></div><div><dt>Contract through</dt><dd>{seasonLabel(current.seasonNumber + current.seasons - 1)}</dd></div></dl><ReleaseClauseValue fee={current.releaseFee} />{completedTransfer && <section className="contract-transfer-completed"><strong>Transfer fee to {seller?.name}</strong><TransferPaymentRecord transfer={completedTransfer} date={season.date} /></section>}</> : <>
        <dl className="contract-offer-facts"><div><dt>Contract ends</dt><dd>{endsSeason <= MAX_SEASON_NUMBER ? `End of ${seasonLabel(endsSeason)}` : 'Calendar limit'}</dd></div><div><dt>Annual salary demand</dt><dd>{money(demand)}</dd></div><div><dt>Player reply &amp; earliest arrival</dt><dd>{canRegister ? <><time dateTime={quote.responseOn}>{scoutingDate(quote.responseOn)}</time> &middot; Matchday {quote.responseRound}</> : 'No registration date'}</dd></div></dl>
        {paid && <section className="in-season-fee-fields" aria-labelledby="in-season-fee-title"><div className="in-season-fee-heading"><h3 id="in-season-fee-title">Transfer fee</h3><span>Club asks <strong data-in-season-asking-fee={transferQuote!.requiredFee}>{money(transferQuote!.requiredFee)}</strong></span></div><TransferApproach season={season} playerId={player.id} id="in-season-transfer-mode" mode={transferMode} onChange={setTransferMode} disabled={disabled} />{usingClause ? <div className="release-clause-fixed"><span>Release clause<small>Paid in full on signing</small></span><strong data-clause-trigger-fee={transferFee}>{money(transferFee)}</strong></div> : <><div className="contract-offer-field"><label htmlFor="in-season-transfer-fee">Your fee offer (EUR)</label><input ref={feeInput} id="in-season-transfer-fee" type="number" min={MIN_TRANSFER_FEE / 100} max={MAX_TRANSFER_FEE / 100} step={TRANSFER_FEE_STEP / 100} value={fee} onChange={event => setFee(event.target.value)} disabled={disabled} /><input id="in-season-transfer-fee-slider" aria-label="Transfer fee slider" type="range" min={MIN_TRANSFER_FEE / 100} max={MAX_TRANSFER_FEE / 100} step={TRANSFER_FEE_STEP / 100} value={Math.max(MIN_TRANSFER_FEE / 100, Math.min(MAX_TRANSFER_FEE / 100, Number(fee) || 0))} aria-valuetext={money(transferFee)} onChange={event => setFee(event.target.value)} disabled={disabled} /></div><fieldset className="transfer-payment-plan" disabled={disabled}><legend>When to pay</legend><div className="transfer-payment-choices">{TRANSFER_PAYMENT_PLANS.map(plan => <label key={plan}><input type="radio" name="in-season-payment-plan" value={plan} checked={paymentPlan === plan} onChange={() => setPaymentPlan(plan)} />{plan === 'upfront' ? 'All on signing' : plan === 'two-payments' ? 'Two payments' : 'Three payments'}</label>)}</div></fieldset></>}<details className="in-season-payment-disclosure"><summary>Payment dates &amp; amounts</summary><TransferPaymentTerms fee={transferFee} plan={effectivePlan} startsSeason={season.seasonNumber} startsRound={quote.responseRound} installments={transferQuote!.installments} earliestSigning={canRegister ? quote.responseOn : undefined} /></details></section>}
        <div className={paid ? 'in-season-contract-fields' : ''}><div className="contract-offer-field"><label htmlFor="in-season-wage">Annual salary offer (EUR)</label><input ref={wageInput} id="in-season-wage" type="number" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={wage} onChange={event => setWage(event.target.value)} disabled={disabled} /><input id="in-season-wage-slider" aria-label="Annual salary offer slider" type="range" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={Math.max(MIN_CONTRACT_WAGE / 100, Math.min(MAX_CONTRACT_WAGE / 100, Number(wage) || 0))} aria-valuetext={money(annual)} onChange={event => setWage(event.target.value)} disabled={disabled} /></div>{paid && <div className="contract-offer-field"><label htmlFor="in-season-years">Contract length</label><select id="in-season-years" value={years} onChange={event => setYears(Number(event.target.value))} disabled={disabled}><option value={1}>Rest of this season</option><option value={2}>This season + 1 year</option><option value={3}>This season + 2 years</option></select><input id="in-season-years-slider" aria-label="Contract length slider" type="range" min={1} max={MAX_CONTRACT_SEASONS} step={1} value={years} aria-valuetext={years === 1 ? 'Rest of this season' : `Rest of this season plus ${years - 1} more ${years === 2 ? 'year' : 'years'}`} onChange={event => setYears(Number(event.target.value))} disabled={disabled} /></div>}</div>
        <ReleaseClauseFields id="in-season-release" value={releaseFee} onChange={setReleaseFee} disabled={disabled} years={years} />
        <dl className="contract-offer-facts contract-offer-total">{paid && <div><dt>Fee due on signing</dt><dd data-in-season-signing-fee={firstPayment}>{money(firstPayment)}</dd></div>}<div><dt>Salary for remaining matchdays</dt><dd data-in-season-cost={quote.remainingWages}>{money(quote.remainingWages)}</dd></div>{paid && <div><dt>Total held now (full fee + salary)</dt><dd data-in-season-total-held={Math.max(0, transferFee) + quote.remainingWages}>{money(Math.max(0, transferFee) + quote.remainingWages)}</dd></div>}<div><dt>Remaining budget after offer</dt><dd data-in-season-cash-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div><div><dt>This season's salary budget left / year</dt><dd data-in-season-annual-after={quote.annualBudgetRemaining}>{money(quote.annualBudgetRemaining)}</dd></div><div><dt>Squad places, including pending offers</dt><dd>{quote.rosterSize} / {clubRosterLimit(season)}</dd></div></dl>
        {transferQuote && transferQuote.futureBudgets.length > 0 && <details className="in-season-payment-disclosure"><summary>Future-season salary budgets</summary><dl className="contract-offer-facts">{transferQuote.futureBudgets.map(budget => <div key={budget.seasonNumber}><dt>{seasonLabel(budget.seasonNumber)} remaining / year</dt><dd data-in-season-future-budget={budget.seasonNumber} data-remaining={budget.remainingBudget}>{money(budget.remainingBudget)}<small>{budget.rosterSize} squad places committed</small></dd></div>)}</dl></details>}
        {reason && <p id="in-season-offer-reason" className="contract-offer-reason">{reason}</p>}
        <p>{paid ? usingClause ? 'The player decides. If accepted, the full release fee is paid and registration changes next matchday. The fee and remaining salary stay reserved until the reply.' : 'Club approval comes first. If the player accepts, registration and the first payment happen next matchday. The full unpaid fee stays reserved.' : 'No transfer fee. Salary is paid through the remaining matchdays. Acceptance depends on the player and available budget when the reply arrives.'}</p>
      </>}
      <details className="contract-offer-assessment"><summary>Scouting report</summary><ScoutingKnowledge knowledge={getPlayerKnowledge(season, player.id)} position={player.position} compact /><button className="text-button" onClick={() => { onClose(); onOpenScouting(player.id) }} disabled={disabled}>Open scouting<Icon name="chevron" size={13} /></button></details>
      {offers.length > 0 && <details className="contract-negotiation-history"><summary>Offer history &middot; {offers.length}</summary><ol tabIndex={0} aria-label={`Current-season offer history for ${player.name}`}>{[...offers].reverse().map(offer => <li key={offer.id}><div><strong>{inSeasonOfferStatus(offer)}</strong><time dateTime={offer.offeredOn}>{scoutingDate(offer.offeredOn)}</time></div><p>{money(offer.seasonWage)} / year &middot; {money(offer.remainingWages)} this season &middot; through {seasonLabel(offer.seasonNumber + offer.seasons - 1)}{offer.transfer && <> &middot; {money(offer.transfer.fee)} fee</>}</p><ReleaseClauseValue fee={offer.releaseFee} />{inSeasonOfferReason(offer) && <p>{inSeasonOfferReason(offer)}</p>}</li>)}</ol></details>}
    </div>
    <footer><button ref={close} id="close-in-season-offer" className="button" onClick={onClose} disabled={disabled}>Close</button>{pending && <button id="withdraw-in-season-offer" className="button" onClick={() => onWithdraw(pending.id)} disabled={disabled}>Withdraw</button>}{(pending || signed) && <button className="button" onClick={() => { onClose(); onOpenMatch() }} disabled={disabled}>Match center</button>}{!signed && <button id="submit-in-season-offer" className="button primary" onClick={sendOffer} disabled={disabled || !!reason} aria-describedby={reason ? 'in-season-offer-reason' : undefined}>{pending ? 'Replace offer' : 'Send offer'}<Icon name="chevron" size={14} /></button>}</footer>
  </dialog>
}
