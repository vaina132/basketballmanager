import { minRosterSize } from '../world/club-roster-policy'
import { getPlayerRetirement } from '../world/lifecycle-policy'
import { PlayerCareerStatus } from './PlayerLifecycle'
import { getCareerWage } from '../world/player-catalog'
import { useEffect, useRef, useState } from 'react'
import type { ContractOfferOptions, EmploymentBuyout } from '../domain/employment'
import type { NegotiationRecord, NegotiationTerms } from '../domain/negotiations'
import type { SeasonState } from '../domain/season'
import type { Player } from '../domain/types'
import type { TransferPaymentPlan } from '../domain/transfer-payments'
import { contractForSeason, MAX_CONTRACT_SEASONS, maxContractWage, MIN_CONTRACT_WAGE, quotePlayerContract, WAGE_STEP } from '../world/employment-policy'
import { getLatestNegotiation } from '../world/negotiations'
import { maxTransferFee, MIN_TRANSFER_FEE, TRANSFER_FEE_STEP, quoteTransferOffer, requiredTransferFee } from '../world/transfers-policy'
import { getMarketOffers, getRivalMarketOffers, isCompetitiveMarket, isLiveMarketOffer, quoteMarketDates } from '../world/market-policy'
import { getNegotiationDemands, negotiationReasonText, requiredNegotiationWage } from '../world/negotiations-policy'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { chosenMarketOffer, marketOfferStatus } from './OffseasonMarketPanel'
import { getTransferPaymentSchedule, paymentPlanLabel, TRANSFER_PAYMENT_PLANS } from '../world/transfer-payments'
import { TransferPaymentTerms, transferMoney } from './TransferPaymentTerms'
import { TransferPaymentRecord } from './TransferPaymentsPanel'
import { getApplicableReleaseClause, releaseFeeReason } from '../world/release-clauses'
import { ReleaseClauseFields, ReleaseClauseValue, TransferApproach, transferEntryQuote } from './ReleaseClause'
import { formatMoney } from './money-format'
import { ContractRoleChoice, initialContractRole } from './ContractRoleChoice'
import { roleWage } from '../world/contract-roles'
import { SQUAD_ROLE_RULES } from '../world/relationship-rules'
import type { SquadRole } from '../domain/relationships'

interface PlayerContractOfferProps {
  season: SeasonState
  player: Player
  disabled: boolean
  historyOnly: boolean
  onContinue: () => void
  onClose: () => void
  onOffer: (playerId: string, seasonWage: number, seasons: number, transferFee?: number, paymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => void
  onWithdrawOffer: (offerId: string) => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
}

const formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => formatMoney(cents)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
export const negotiationOutcome = (record: NegotiationRecord) => record.outcome === 'accepted' ? 'Accepted' : record.outcome === 'countered' ? 'Counteroffer' : 'Rejected'
const termsText = (wage: number, years: number) => `${money(wage)} per season · ${years} ${years === 1 ? 'season' : 'seasons'}`
const roleText = (role: SquadRole | undefined) => role ? ` · ${SQUAD_ROLE_RULES.definitions[role].label} role` : ''

function NegotiationHistory({ records, buyouts, expanded = false }: { records: NegotiationRecord[]; buyouts: readonly EmploymentBuyout[]; expanded?: boolean }) {
  const releasedOn = new Map(buyouts.flatMap(item => item.releasedContractIds.map(id => [id, item.completedOn] as const)))
  if (!records.length) return null
  return <details className="contract-negotiation-history" open={expanded || undefined}>
    <summary>Conversation history · {records.length} {records.length === 1 ? 'offer' : 'offers'}</summary>
    <ol tabIndex={0} aria-label="Recorded contract offers and responses">{[...records].reverse().map(record => <li key={record.id} data-negotiation-record={record.id} data-negotiation-outcome={record.outcome}>
      <div><strong>{negotiationOutcome(record)}</strong><time dateTime={record.date}>{scoutingDate(record.date)}</time></div>
      <p>Offered {termsText(record.offeredWage, record.offeredSeasons)}{roleText(record.role)}, starting {seasonLabel(record.startsSeason)}.</p><ReleaseClauseValue fee={record.releaseFee} />
      <p>{negotiationReasonText(record)}</p>
      {record.counterOffer && <p>Counter: {termsText(record.counterOffer.seasonWage, record.counterOffer.seasons)}.</p>}
      {record.alternativeOffer && <p>Shorter option: {termsText(record.alternativeOffer.seasonWage, record.alternativeOffer.seasons)}.</p>}
      {record.contractId && <small>{releasedOn.has(record.contractId) ? <>Bought out on <time dateTime={releasedOn.get(record.contractId)!}>{scoutingDate(releasedOn.get(record.contractId)!)}</time>.</> : <>Binding agreement through {seasonLabel(record.startsSeason + record.offeredSeasons - 1)}.</>}</small>}
    </li>)}</ol>
  </details>
}

export function PlayerContractOffer({ season, player, disabled, historyOnly, onContinue, onClose, onOffer, onWithdrawOffer, onOpenScouting, onShortlist }: PlayerContractOfferProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const response = useRef<HTMLElement>(null)
  const marketStatus = useRef<HTMLElement>(null)
  const wageInput = useRef<HTMLInputElement>(null)
  const feeInput = useRef<HTMLInputElement>(null)
  const negotiations = season.negotiations.enabledSince !== null
  const timedMarket = season.market.enabledSince !== null && season.status === 'complete'
  const marketOffer = getMarketOffers(season).filter(offer => offer.playerId === player.id).at(-1) ?? null
  const liveOffer = marketOffer && isLiveMarketOffer(marketOffer) ? marketOffer : null
  const competitive = timedMarket && isCompetitiveMarket(season)
  const rivalOffers = competitive ? getRivalMarketOffers(season, player.id) : []
  const chosenOffer = chosenMarketOffer(season, marketOffer)
  const chosenClub = season.clubs.find(club => club.id === chosenOffer?.clubId)
  const signed = contractForSeason(season.employment, player.id, season.seasonNumber + 1)
  const chosenContractId = chosenOffer ? season.negotiations.records.find(record => record.id === chosenOffer.negotiationId)?.contractId : null
  const lost = marketOffer?.status === 'lost' && !!chosenOffer && !!signed && chosenContractId === signed.id
  const currentTransfer = marketOffer?.transfer?.contractId === signed?.id ? marketOffer?.transfer ?? null : null
  const accepted = signed?.clubId === season.managedClubId
  const boughtOut = season.employment.buyouts.find(item => item.playerId === player.id && item.clubId === season.managedClubId && item.seasonNumber === season.seasonNumber)
  const transferTarget = timedMarket && !accepted && !!signed && signed.clubId !== season.managedClubId
  const transferSeller = season.clubs.find(club => club.id === (currentTransfer?.sellerClubId ?? signed?.clubId))
  const askingFee = currentTransfer?.requiredFee ?? (transferTarget ? requiredTransferFee(season, player.id) : 0)
  const clause = getApplicableReleaseClause(season, player.id)
  const latest = getLatestNegotiation(season, player.id)
  const lastSeenResponse = useRef(latest?.id ?? null)
  const lastSeenMarket = useRef(marketOffer ? `${marketOffer.id}:${marketOffer.status}:${marketOffer.transfer?.clubStatus ?? ""}` : null)
  const wasHistoryOnly = useRef(historyOnly)
  // relationships-3: the squad role offered, starting from the one already offered or his natural role here.
  const [role, setRole] = useState<SquadRole | undefined>(() => initialContractRole(season, player.id, marketOffer?.role ?? (latest?.seasonNumber === season.seasonNumber ? latest.role : undefined)))
  const [wage, setWage] = useState(String((marketOffer?.seasonWage ?? latest?.offeredWage ?? roleWage(getCareerWage(season, player.id), role, season)) / 100))
  const [years, setYears] = useState(marketOffer?.seasons ?? latest?.offeredSeasons ?? 1)
  const [fee, setFee] = useState(String((currentTransfer?.fee ?? askingFee) / 100))
  const [paymentPlan, setPaymentPlan] = useState<TransferPaymentPlan>(currentTransfer?.paymentPlan ?? 'upfront')
  const [releaseFee, setReleaseFee] = useState<number | undefined>(marketOffer ? marketOffer.releaseFee : latest?.seasonNumber === season.seasonNumber ? latest.releaseFee : undefined)
  const [transferMode, setTransferMode] = useState<NonNullable<ContractOfferOptions['transferMode']>>(currentTransfer?.mode ?? 'negotiated')
  const demandReleaseFee = releaseFeeReason(releaseFee, season) ? undefined : releaseFee
  const usingClause = transferTarget && transferMode === 'release-clause'
  const effectivePlan = usingClause ? 'upfront' : paymentPlan
  const options: ContractOfferOptions = { ...(releaseFee !== undefined ? { releaseFee } : {}), ...(usingClause ? { transferMode } : {}), ...(role !== undefined ? { role } : {}) }
  const proposalDates = timedMarket ? quoteMarketDates(season, transferTarget && !usingClause) : null
  const transferFee = usingClause ? clause.fee ?? currentTransfer?.fee ?? 0 : fee.trim() ? Math.round(Number(fee) * 100) : 0
  const paymentSchedule = transferTarget && Number.isSafeInteger(transferFee) && transferFee >= 4 ? getTransferPaymentSchedule(transferFee, effectivePlan, proposalDates?.responseOn ?? season.date, season.seasonNumber + 1) : []
  const firstPayment = paymentSchedule[0]?.amount ?? 0
  const completedTransfer = season.employment.transfers.find(transfer => transfer.contractId === signed?.id)
  const records = season.negotiations.records.filter(record => record.playerId === player.id && record.clubId === season.managedClubId)
  const seasonWage = wage.trim() ? Math.round(Number(wage) * 100) : 0
  const quote = transferTarget ? quoteTransferOffer(season, player.id, seasonWage, years, transferFee, season.managedClubId, effectivePlan, options) : quotePlayerContract(season, player.id, seasonWage, years, season.managedClubId, undefined, undefined, 'upfront', options)
  const entryQuote = transferTarget ? transferEntryQuote(season, player.id, MIN_CONTRACT_WAGE) : quotePlayerContract(season, player.id, negotiations ? MIN_CONTRACT_WAGE : getCareerWage(season, player.id), 1)
  const current = contractForSeason(season.employment, player.id, season.seasonNumber)
  const renewal = current?.clubId === season.managedClubId
  const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
  const shortlisted = season.scouting.clubs[season.managedClubId]!.shortlist.includes(player.id)
  const unchangedOffer = timedMarket ? !!liveOffer && liveOffer.seasonWage === seasonWage && liveOffer.seasons === years && liveOffer.releaseFee === releaseFee && liveOffer.role === role && (!transferTarget || liveOffer.transfer?.fee === transferFee && (liveOffer.transfer.paymentPlan ?? 'upfront') === effectivePlan && (liveOffer.transfer.mode ?? 'negotiated') === transferMode) : !!latest && latest.seasonNumber === season.seasonNumber && latest.round === season.round && latest.status === season.status && latest.offeredWage === seasonWage && latest.offeredSeasons === years && latest.releaseFee === releaseFee && latest.role === role
  const submitReason = quote.reason ?? (unchangedOffer ? timedMarket ? liveOffer?.status === 'pending' || liveOffer?.status === 'club-review' ? transferTarget ? 'Waiting for a reply. Change the fee, payment plan or contract terms to replace this offer.' : 'Waiting for the player reply. Change the terms to replace this offer.' : 'Change the terms or use the counteroffer before submitting again.' : 'This offer already received a response. Change the wage or contract length before submitting again.' : null)
  const showLatestResponse = !!latest && (!timedMarket || marketOffer?.negotiationId === latest.id && ['countered', 'rejected'].includes(marketOffer.status))
  const openingDemand = negotiations ? requiredNegotiationWage(player.id, years, demandReleaseFee, season, role) : quote.askingWage
  const knowledge = getPlayerKnowledge(season, player.id)
  const assessment = <div className="contract-offer-knowledge"><ScoutingKnowledge knowledge={knowledge} position={player.position} compact /><div><button type="button" className="text-button" onClick={() => { onClose(); onOpenScouting(player.id) }} disabled={disabled}>Scouting report<Icon name="chevron" size={13} /></button><button type="button" className="text-button" aria-pressed={shortlisted} onClick={() => onShortlist(player.id, !shortlisted)} disabled={disabled || !season.scouting.enabledSince || getPlayerRetirement(season, player.id).status === 'retired' && !shortlisted}>{shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}</button></div></div>

  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    close.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true })
      else document.getElementById('transfers-heading')?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (disabled) return
    if (accepted || lost) close.current?.focus({ preventScroll: true })
    else if (showLatestResponse && latest && latest.id !== lastSeenResponse.current && !historyOnly) {
      response.current?.focus({ preventScroll: true })
      response.current?.scrollIntoView({ block: 'nearest' })
    } else if (marketOffer && `${marketOffer.id}:${marketOffer.status}:${marketOffer.transfer?.clubStatus ?? ""}` !== lastSeenMarket.current && !historyOnly) {
      marketStatus.current?.focus({ preventScroll: true })
      marketStatus.current?.scrollIntoView({ block: 'nearest' })
    }
    lastSeenResponse.current = latest?.id ?? null
    lastSeenMarket.current = marketOffer ? `${marketOffer.id}:${marketOffer.status}:${marketOffer.transfer?.clubStatus ?? ""}` : null
  }, [accepted, disabled, latest, historyOnly, lost, marketOffer, showLatestResponse])

  useEffect(() => {
    if (wasHistoryOnly.current && !historyOnly && !disabled) wageInput.current?.focus({ preventScroll: true })
    wasHistoryOnly.current = historyOnly
  }, [historyOnly, disabled])

  function useTerms(terms: NegotiationTerms, termsRole?: SquadRole) {
    setWage(String(terms.seasonWage / 100)); setYears(terms.seasons); setReleaseFee(terms.releaseFee)
    if (termsRole) setRole(termsRole)
    wageInput.current?.focus({ preventScroll: true })
  }

  return <dialog ref={dialog} id="player-contract-offer" className={`contract-offer${negotiations ? ' contract-offer-negotiations' : ''}`} aria-labelledby="contract-offer-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className="transfers-heading"><div><h2 id="contract-offer-title">{historyOnly ? 'Contract conversations' : boughtOut ? 'Contract bought out' : accepted ? 'Contract agreed' : lost ? 'Chose another club' : transferTarget ? 'Offer transfer' : renewal ? 'Offer renewal' : 'Offer contract'} · {player.name}</h2><span>{player.position} · {player.heightCm} cm · {getPlayerRetirement(season, player.id).status === 'retired' ? 'Retired player' : owner?.name ?? 'Free agent'}</span></div></header>
    <PlayerCareerStatus season={season} playerId={player.id} />
    {historyOnly ? <>
      <div className="contract-offer-body">{lost && <p className="contract-offer-reason">Talks closed: {player.name} chose {chosenClub?.name ?? 'another club'}. Your wages budget and squad place have been released.</p>}<NegotiationHistory records={records} buyouts={season.employment.buyouts} expanded />{entryQuote.reason && <p id="contract-history-availability" className="contract-offer-reason">Current availability: {entryQuote.reason}</p>}<p>{timedMarket ? 'Offseason reservations and deadlines are shown in the offer queue.' : 'Recorded replies are kept across seasons. Counteroffers reserve neither a squad place nor the player.'}</p></div>
      <footer><button ref={close} className="button" id="close-player-contract" onClick={onClose} disabled={disabled}>Close</button>{entryQuote.canOffer && <button id="continue-contract-talks" className="button primary" onClick={onContinue} disabled={disabled}>Open current contract talks<Icon name="chevron" size={14} /></button>}</footer>
    </> : boughtOut ? <>
      <div className="contract-offer-body"><div role="status"><p className="contract-accepted">{player.name} was released from your {seasonLabel(boughtOut.startsSeason)} squad. Compensation of {money(boughtOut.amount)} was paid on <time dateTime={boughtOut.completedOn}>{scoutingDate(boughtOut.completedOn)}</time>.</p><p>Other clubs can offer a contract. You cannot re-sign this player during this offseason.</p></div><NegotiationHistory records={records} buyouts={season.employment.buyouts} /></div>
      <footer><button ref={close} className="button primary" id="close-player-contract" onClick={onClose} disabled={disabled}>Done</button></footer>
    </> : accepted && signed ? <>
      <div className="contract-offer-body"><div role="status"><p className="contract-accepted">{player.name} has signed for {money(signed.seasonWage)} per season, from {seasonLabel(signed.startsSeason)} through {seasonLabel(signed.endsSeason)}{signed.role ? `, as ${signed.role === 'development' ? 'a Reserve' : signed.role === 'rotation' ? 'a Rotation player' : `a ${SQUAD_ROLE_RULES.definitions[signed.role].label}`}` : ''}.</p><p>The contract takes effect on opening day. The agreed salaries are included in the player wages budget.</p>{completedTransfer && <section className="contract-transfer-completed"><strong>Transfer fee to {season.clubs.find(club => club.id === completedTransfer.fromClubId)?.name}</strong><TransferPaymentRecord transfer={completedTransfer} date={season.date} /></section>}</div><ReleaseClauseValue fee={signed.releaseFee} /><NegotiationHistory records={records} buyouts={season.employment.buyouts} /></div>
      <footer><button ref={close} className="button primary" id="close-player-contract" onClick={onClose} disabled={disabled}>Done</button></footer>
    </> : lost && chosenOffer && marketOffer ? <>
      <div className="contract-offer-body"><section className="contract-market-status" role="status" data-contract-market-offer={marketOffer.id} data-contract-market-status="lost"><h3><Icon name="swap" size={17} />Chose {chosenClub?.name ?? 'another club'}</h3><p>{player.name} agreed to {termsText(chosenOffer.seasonWage, chosenOffer.seasons)}, starting {seasonLabel(chosenOffer.seasonNumber + 1)}.</p><p>Your {money(marketOffer.seasonWage)} annual salary reservation and squad place have been released.{marketOffer.transfer && <> The {money(marketOffer.transfer.fee)} transfer fee hold has also been released.</>}</p></section><dl className="contract-offer-facts"><div><dt>Your offer</dt><dd>{termsText(marketOffer.seasonWage, marketOffer.seasons)}</dd></div><div><dt>Decision date</dt><dd><time dateTime={marketOffer.closedOn!}>{scoutingDate(marketOffer.closedOn!)}</time></dd></div></dl><NegotiationHistory records={records} buyouts={season.employment.buyouts} /></div>
      <footer><button ref={close} className="button primary" id="close-player-contract" onClick={onClose} disabled={disabled}>Done</button></footer>
    </> : <form onSubmit={event => { event.preventDefault(); if (!disabled && !submitReason) onOffer(player.id, seasonWage, years, transferTarget ? transferFee : undefined, transferTarget ? effectivePlan : undefined, options) }}>
      <div className="contract-offer-body">
        {timedMarket && marketOffer && (marketOffer.status !== 'countered' || marketOffer.transfer?.clubStatus === 'countered') && <section ref={marketStatus} className="contract-market-status" tabIndex={-1} role="status" aria-labelledby="contract-market-status-title" data-contract-market-offer={marketOffer.id} data-contract-market-status={marketOffer.status}>
          <div><h3 id="contract-market-status-title"><Icon name={marketOffer.status === 'pending' ? 'clock' : marketOffer.status === 'accepted' ? 'check' : 'close'} size={17} />{!liveOffer && !lost ? 'Previous offer: ' : ''}{marketOfferStatus(marketOffer)}</h3>{liveOffer && <button type="button" id="withdraw-player-offer" className="text-button" onClick={() => onWithdrawOffer(liveOffer.id)} disabled={disabled}>Withdraw offer</button>}</div>
          {liveOffer ? <><dl><div><dt>{liveOffer.transfer && liveOffer.transfer.clubStatus !== 'accepted' ? 'Club reply' : 'Player reply'}</dt><dd><time dateTime={liveOffer.responseOn}>{scoutingDate(liveOffer.responseOn)}</time></dd></div><div><dt>Expires</dt><dd><time dateTime={liveOffer.expiresOn}>{scoutingDate(liveOffer.expiresOn)}</time></dd></div></dl><p>{money(liveOffer.seasonWage)} / year and one squad place held.{liveOffer.transfer && <> Transfer fee held: {money(liveOffer.transfer.fee)} · {paymentPlanLabel(liveOffer.transfer.paymentPlan ?? 'upfront')}.</>} {liveOffer.status === 'pending' ? 'Continue the offseason for the reply.' : 'Use the counteroffer or adjust the terms below.'}</p></> : <p>This offer no longer holds wages budget, a squad place{marketOffer.transfer ? ' or a transfer fee' : ''}.</p>}
        </section>}
        {transferTarget && <section className="contract-transfer-route" aria-label="Transfer agreement stages">
          <div className={currentTransfer?.clubStatus === 'accepted' ? 'complete' : 'current'}><Icon name={currentTransfer?.clubStatus === 'accepted' ? 'check' : 'building'} size={17} /><span><strong>{usingClause ? 'Release clause' : 'Club agreement'}</strong><small>{currentTransfer?.clubStatus === 'accepted' ? `${currentTransfer.mode === 'release-clause' ? 'Clause triggered' : 'Fee agreed'} · ${money(currentTransfer.fee)}` : usingClause ? 'No club approval needed' : transferSeller?.name}</small></span></div>
          <Icon name="chevron" size={15} /><div className={currentTransfer?.clubStatus === 'accepted' ? 'current' : ''}><Icon name="people" size={17} /><span><strong>Player contract</strong><small>{currentTransfer?.clubStatus === 'accepted' ? `Reply ${scoutingDate(marketOffer!.responseOn)}` : usingClause ? 'Player still decides' : 'After club approval'}</small></span></div>
          {currentTransfer?.clubReason && <p className="contract-club-reason" data-club-reason={currentTransfer.clubStatus}>{currentTransfer.clubReason}</p>}
        </section>}
        {liveOffer?.transfer?.clubStatus === 'countered' && liveOffer.transfer.counterFee !== null && <div className="contract-response-option contract-club-counter" data-club-counter={liveOffer.transfer.counterFee}><span>{transferSeller?.name} asks for <strong>{money(liveOffer.transfer.counterFee)} transfer fee</strong></span><button type="button" id="use-club-counteroffer" className="button small" disabled={disabled} onClick={() => { setFee(String(liveOffer.transfer!.counterFee! / 100)); feeInput.current?.focus({ preventScroll: true }) }}>Use club asking fee</button></div>}
        {negotiations && showLatestResponse && latest && <section ref={response} id="contract-player-response" className="contract-player-response" tabIndex={-1} aria-labelledby="contract-response-title" data-player-response={latest.outcome} data-contract-market-offer={timedMarket && liveOffer ? liveOffer.id : undefined} data-contract-market-status={timedMarket && liveOffer ? liveOffer.status : undefined}>
          <div><h3 id="contract-response-title">{negotiationOutcome(latest)}</h3><time dateTime={latest.date}>{scoutingDate(latest.date)}</time></div>
          {timedMarket && liveOffer && <div className="contract-counter-deadline"><span><Icon name="clock" size={14} />Held until <strong><time dateTime={liveOffer.expiresOn}>{scoutingDate(liveOffer.expiresOn)}</time></strong></span><button type="button" id="withdraw-player-offer" className="text-button" onClick={() => onWithdrawOffer(liveOffer.id)} disabled={disabled}>Withdraw offer</button></div>}
          <p>Your offer: {termsText(latest.offeredWage, latest.offeredSeasons)}{roleText(latest.role)}.</p><p>{negotiationReasonText(latest)}</p>
          {latest.counterOffer && <div className="contract-response-option"><span>Player asks for <strong>{termsText(latest.counterOffer.seasonWage, latest.counterOffer.seasons)}</strong></span><button type="button" id="use-contract-counteroffer" className="button small" onClick={() => useTerms(latest.counterOffer!, latest.role)} disabled={disabled}>Use counteroffer</button></div>}
          {latest.alternativeOffer && <div className="contract-response-option"><span>Shorter option <strong>{termsText(latest.alternativeOffer.seasonWage, latest.alternativeOffer.seasons)}</strong></span><button type="button" id="use-contract-alternative" className="button small" onClick={() => useTerms(latest.alternativeOffer!, latest.role)} disabled={disabled}>Use shorter option</button></div>}
        </section>}

        {competitive && <section className="contract-rivals" aria-labelledby="contract-rivals-title"><header><h3 id="contract-rivals-title"><Icon name="people" size={17} />Rival offers <span>{rivalOffers.length}</span></h3></header>{rivalOffers.length ? <ul>{rivalOffers.map(offer => <li key={offer.id} data-rival-offer={offer.id}><div><strong>{season.clubs.find(club => club.id === offer.clubId)!.name}</strong><span>{offer.status === 'pending' ? 'Reply' : 'Counteroffer held until'} <time dateTime={offer.status === 'pending' ? offer.responseOn : offer.expiresOn}>{scoutingDate(offer.status === 'pending' ? offer.responseOn : offer.expiresOn)}</time></span></div><div><strong>{money(offer.seasonWage)} <small>/ year</small></strong>{offer.transfer && <span>{money(offer.transfer.fee)} fee · {paymentPlanLabel(offer.transfer.paymentPlan ?? 'upfront')} · {offer.transfer.mode === 'release-clause' ? 'Release clause triggered' : offer.transfer.clubStatus === 'accepted' ? 'Club agreed' : 'Club decision pending'}</span>}<span>{offer.seasons} {offer.seasons === 1 ? 'season' : 'seasons'}</span></div></li>)}</ul> : <p>No other clubs have an open offer.</p>}<details><summary>How the player chooses</summary><p>On the reply date, offers meeting the player’s salary demand compete on annual salary, then contract length. Equal terms favor staying with the current club. A fixed draw settles any remaining tie. Signing closes every other offer for this player.</p></details></section>}
        {transferTarget && <section className="contract-transfer-fee" aria-labelledby="transfer-fee-title"><div className="contract-transfer-ask"><h3 id="transfer-fee-title"><Icon name="wallet" size={17} />Transfer fee</h3><span>Club asking fee <strong data-transfer-asking-fee={askingFee}>{money(askingFee)}</strong></span></div><TransferApproach season={season} playerId={player.id} id="contract-transfer-mode" mode={transferMode} onChange={setTransferMode} disabled={disabled} />{usingClause ? <div className="release-clause-fixed"><span>Release clause<small>Paid in full on signing</small></span><strong data-clause-trigger-fee={transferFee}>{money(transferFee)}</strong></div> : <><div className="contract-offer-field"><label htmlFor="contract-transfer-fee">Your fee offer · EUR</label><input ref={feeInput} id="contract-transfer-fee" type="number" min={MIN_TRANSFER_FEE / 100} max={maxTransferFee(season) / 100} step={TRANSFER_FEE_STEP / 100} value={fee} onChange={event => setFee(event.target.value)} disabled={disabled} required aria-describedby="transfer-fee-help" /><input type="range" aria-label="Adjust transfer fee" min={MIN_TRANSFER_FEE / 100} max={maxTransferFee(season) / 100} step={TRANSFER_FEE_STEP / 100} value={Math.max(MIN_TRANSFER_FEE / 100, Math.min(maxTransferFee(season) / 100, Number(fee) || MIN_TRANSFER_FEE / 100))} aria-valuetext={money(transferFee)} onChange={event => setFee(event.target.value)} disabled={disabled} /><small id="transfer-fee-help">The full fee stays reserved in Spending left. Nothing is charged until the player signs.</small></div><fieldset className="transfer-payment-plan" disabled={disabled}><legend>When to pay</legend><div className="transfer-payment-choices">{TRANSFER_PAYMENT_PLANS.map(plan => <label key={plan}><input type="radio" name="transfer-payment-plan" value={plan} checked={paymentPlan === plan} onChange={() => setPaymentPlan(plan)} />{paymentPlanLabel(plan)}</label>)}</div></fieldset></>}<TransferPaymentTerms fee={transferFee} plan={effectivePlan} startsSeason={season.seasonNumber + 1} earliestSigning={proposalDates?.responseOn} /></section>}
        {negotiations ? <details className="contract-offer-assessment"><summary>Player assessment · {knowledgeLabel(knowledge)}</summary>{assessment}</details> : assessment}
        <ContractRoleChoice season={season} playerId={player.id} id="contract-offer-role" value={role} onChange={setRole} disabled={disabled} />
        <dl className="contract-offer-facts"><div><dt>{negotiations ? `Opening demand · ${years} ${years === 1 ? 'season' : 'seasons'}` : 'Requested annual wage'}</dt><dd data-contract-demand={openingDemand}>{money(openingDemand)} / season</dd></div><div><dt>Contract begins</dt><dd>{seasonLabel(quote.startsSeason)}</dd></div></dl>
        {proposalDates && <div className="contract-offer-dates"><span>{liveOffer ? 'New terms' : 'This offer'}</span><Icon name="calendar" size={16} /><span>{transferTarget ? 'Earliest player reply' : 'Reply'} <strong><time dateTime={proposalDates.responseOn}>{scoutingDate(proposalDates.responseOn)}</time></strong></span><span>Expires <strong><time dateTime={proposalDates.expiresOn}>{scoutingDate(proposalDates.expiresOn)}</time></strong></span></div>}
        {negotiations && <div className="contract-demand-options" aria-label="Opening wage demands by contract length">{getNegotiationDemands(player.id, demandReleaseFee, season, role).terms.map(terms => <div key={terms.seasons}><span>{terms.seasons} {terms.seasons === 1 ? 'season' : 'seasons'}</span><strong>{money(terms.seasonWage)} / year</strong></div>)}</div>}
        <div className="contract-offer-field"><label htmlFor="contract-offer-wage">Your annual wage offer · EUR</label><input ref={wageInput} id="contract-offer-wage" type="number" min={MIN_CONTRACT_WAGE / 100} max={maxContractWage(season) / 100} step={WAGE_STEP / 100} value={wage} onChange={event => setWage(event.target.value)} disabled={disabled} required aria-describedby="contract-wage-help" /><input type="range" aria-label="Adjust annual wage" min={MIN_CONTRACT_WAGE / 100} max={maxContractWage(season) / 100} step={WAGE_STEP / 100} value={Math.max(MIN_CONTRACT_WAGE / 100, Math.min(maxContractWage(season) / 100, Number(wage) || MIN_CONTRACT_WAGE / 100))} aria-valuetext={`${money(seasonWage)} per season`} onChange={event => setWage(event.target.value)} disabled={disabled} /><small id="contract-wage-help">{negotiations ? 'You can offer below the opening demand. The player may accept, counter or reject.' : 'Offers must meet the requested wage.'} Leave enough allocation for a squad of {minRosterSize(season, season.managedClubId)}.</small></div>
        <div className="contract-offer-field"><label htmlFor="contract-offer-years">Contract length</label><select id="contract-offer-years" value={years} onChange={event => setYears(Number(event.target.value))} disabled={disabled}>{Array.from({ length: MAX_CONTRACT_SEASONS }, (_, index) => index + 1).map(length => <option key={length} value={length}>{length} {length === 1 ? 'season' : 'seasons'}</option>)}</select><input type="range" aria-label="Adjust contract length" min={1} max={MAX_CONTRACT_SEASONS} step={1} value={years} aria-valuetext={`${years} ${years === 1 ? 'season' : 'seasons'}`} onChange={event => setYears(Number(event.target.value))} disabled={disabled} /></div>
        {negotiations && <ReleaseClauseFields id="contract-release" value={releaseFee} onChange={setReleaseFee} disabled={disabled} years={years} context={season} />}
        <dl className="contract-offer-facts contract-offer-total"><div><dt>Contract through</dt><dd>{seasonLabel(quote.endsSeason)}</dd></div><div><dt>Total wages promised if accepted</dt><dd>{Number.isFinite(seasonWage) ? money(seasonWage * years) : 'Enter a wage'}</dd></div></dl>
{submitReason && <p id="contract-offer-reason" className="contract-offer-reason" role="status">{submitReason}</p>}
        <NegotiationHistory records={records} buyouts={season.employment.buyouts} />
      </div><footer><p id="contract-binding-notice">{transferTarget ? <>{usingClause ? 'If the player accepts,' : 'If both club and player accept,'} <strong>{transferMoney(firstPayment)} is paid on signing</strong>{paymentSchedule.length > 1 && <> and <strong>{transferMoney(transferFee - firstPayment)} later</strong></>}. Withdraw before the player’s reply to cancel. {liveOffer ? usingClause ? 'Revised terms replace this offer; the player still decides.' : 'Revised terms replace this offer and request club approval again.' : 'Sending reserves the fee, wages budget and a squad place.'}</> : timedMarket && proposalDates ? <>The player decides on <strong>{scoutingDate(proposalDates.responseOn)}</strong>. Acceptance signs automatically; withdraw before then to cancel. {liveOffer ? 'Submitting revised terms replaces your current offer.' : 'Sending holds the annual wages and a squad place.'}</> : timedMarket ? 'Recruitment has closed. Existing records remain available.' : 'Submitting an offer signs a binding contract immediately if the player accepts. Wages are paid in season installments, with no signing payment.'}</p><button ref={close} type="button" className="button" onClick={onClose} disabled={disabled}>Close</button><button type="submit" id="confirm-player-contract" className="button primary" disabled={disabled || !!submitReason} aria-describedby={`contract-binding-notice${submitReason ? ' contract-offer-reason' : ''}`}>{timedMarket ? liveOffer ? 'Replace offer' : 'Send offer' : negotiations ? 'Submit offer' : 'Confirm offer'} · {Number.isFinite(seasonWage) ? money(seasonWage) : '—'} / season</button></footer>
    </form>}
  </dialog>
}
