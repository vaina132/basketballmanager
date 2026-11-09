import { useEffect, useRef, useState } from 'react'
import type { NegotiationRecord, NegotiationTerms } from '../domain/negotiations'
import type { SeasonState } from '../domain/season'
import type { Player } from '../domain/types'
import { getSeasonWage } from '../data/development-wages'
import { contractForSeason, MAX_CONTRACT_SEASONS, MAX_CONTRACT_WAGE, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, quotePlayerContract, WAGE_STEP } from '../world/employment-policy'
import { getLatestNegotiation } from '../world/negotiations'
import { getMarketOffers, isLiveMarketOffer, quoteMarketDates } from '../world/market-policy'
import { getNegotiationDemands, negotiationReasonText, requiredNegotiationWage } from '../world/negotiations-policy'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { marketOfferStatus } from './OffseasonMarketPanel'

interface PlayerContractOfferProps {
  season: SeasonState
  player: Player
  disabled: boolean
  historyOnly: boolean
  onContinue: () => void
  onClose: () => void
  onOffer: (playerId: string, seasonWage: number, seasons: number) => void
  onWithdrawOffer: (offerId: string) => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
}

const formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => formatter.format(cents / 100)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
export const negotiationOutcome = (record: NegotiationRecord) => record.outcome === 'accepted' ? 'Accepted' : record.outcome === 'countered' ? 'Counteroffer' : 'Rejected'
const termsText = (wage: number, years: number) => `${money(wage)} per season · ${years} ${years === 1 ? 'season' : 'seasons'}`

function NegotiationHistory({ records, expanded = false }: { records: NegotiationRecord[]; expanded?: boolean }) {
  if (!records.length) return null
  return <details className="contract-negotiation-history" open={expanded || undefined}>
    <summary>Conversation history · {records.length} {records.length === 1 ? 'offer' : 'offers'}</summary>
    <ol tabIndex={0} aria-label="Recorded contract offers and responses">{[...records].reverse().map(record => <li key={record.id} data-negotiation-record={record.id} data-negotiation-outcome={record.outcome}>
      <div><strong>{negotiationOutcome(record)}</strong><time dateTime={record.date}>{scoutingDate(record.date)}</time></div>
      <p>Offered {termsText(record.offeredWage, record.offeredSeasons)}, starting {seasonLabel(record.startsSeason)}.</p>
      <p>{negotiationReasonText(record)}</p>
      {record.counterOffer && <p>Counter: {termsText(record.counterOffer.seasonWage, record.counterOffer.seasons)}.</p>}
      {record.alternativeOffer && <p>Shorter option: {termsText(record.alternativeOffer.seasonWage, record.alternativeOffer.seasons)}.</p>}
      {record.contractId && <small>Binding agreement through {seasonLabel(record.startsSeason + record.offeredSeasons - 1)}.</small>}
    </li>)}</ol>
  </details>
}

export function PlayerContractOffer({ season, player, disabled, historyOnly, onContinue, onClose, onOffer, onWithdrawOffer, onOpenScouting, onShortlist }: PlayerContractOfferProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const response = useRef<HTMLElement>(null)
  const marketStatus = useRef<HTMLElement>(null)
  const wageInput = useRef<HTMLInputElement>(null)
  const negotiations = season.negotiations.enabledSince !== null
  const timedMarket = season.market.enabledSince !== null && season.status === 'complete'
  const marketOffer = getMarketOffers(season).filter(offer => offer.playerId === player.id).at(-1) ?? null
  const liveOffer = marketOffer && isLiveMarketOffer(marketOffer) ? marketOffer : null
  const proposalDates = timedMarket ? quoteMarketDates(season) : null
  const latest = getLatestNegotiation(season, player.id)
  const lastSeenResponse = useRef(latest?.id ?? null)
  const lastSeenMarket = useRef(marketOffer ? `${marketOffer.id}:${marketOffer.status}` : null)
  const wasHistoryOnly = useRef(historyOnly)
  const [wage, setWage] = useState(String((marketOffer?.seasonWage ?? latest?.offeredWage ?? getSeasonWage(player.id)) / 100))
  const [years, setYears] = useState(marketOffer?.seasons ?? latest?.offeredSeasons ?? 1)
  const records = season.negotiations.records.filter(record => record.playerId === player.id && record.clubId === season.managedClubId)
  const seasonWage = wage.trim() ? Math.round(Number(wage) * 100) : 0
  const quote = quotePlayerContract(season, player.id, seasonWage, years)
  const entryQuote = quotePlayerContract(season, player.id, negotiations ? MIN_CONTRACT_WAGE : getSeasonWage(player.id), 1)
  const signed = contractForSeason(season.employment, player.id, season.seasonNumber + 1)
  const accepted = signed?.clubId === season.managedClubId
  const current = contractForSeason(season.employment, player.id, season.seasonNumber)
  const renewal = current?.clubId === season.managedClubId
  const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
  const shortlisted = season.scouting.clubs[season.managedClubId]!.shortlist.includes(player.id)
  const unchangedOffer = timedMarket ? !!liveOffer && liveOffer.seasonWage === seasonWage && liveOffer.seasons === years : !!latest && latest.seasonNumber === season.seasonNumber && latest.round === season.round && latest.status === season.status && latest.offeredWage === seasonWage && latest.offeredSeasons === years
  const submitReason = quote.reason ?? (unchangedOffer ? timedMarket ? liveOffer?.status === 'pending' ? 'Waiting for the player’s reply. Change the terms to replace this offer.' : 'Change the terms or use the counteroffer before submitting again.' : 'This offer already received a response. Change the wage or contract length before submitting again.' : null)
  const showLatestResponse = !!latest && (!timedMarket || marketOffer?.negotiationId === latest.id && ['countered', 'rejected'].includes(marketOffer.status))
  const openingDemand = negotiations ? requiredNegotiationWage(player.id, years) : quote.askingWage
  const knowledge = getPlayerKnowledge(season, player.id)
  const assessment = <div className="contract-offer-knowledge"><ScoutingKnowledge knowledge={knowledge} compact /><div><button type="button" className="text-button" onClick={() => { onClose(); onOpenScouting(player.id) }} disabled={disabled}>Scouting report<Icon name="chevron" size={13} /></button><button type="button" className="text-button" aria-pressed={shortlisted} onClick={() => onShortlist(player.id, !shortlisted)} disabled={disabled || !season.scouting.enabledSince}>{shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}</button></div></div>

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
    if (accepted) close.current?.focus({ preventScroll: true })
    else if (showLatestResponse && latest && latest.id !== lastSeenResponse.current && !historyOnly) {
      response.current?.focus({ preventScroll: true })
      response.current?.scrollIntoView({ block: 'nearest' })
    } else if (marketOffer && `${marketOffer.id}:${marketOffer.status}` !== lastSeenMarket.current && !historyOnly) {
      marketStatus.current?.focus({ preventScroll: true })
      marketStatus.current?.scrollIntoView({ block: 'nearest' })
    }
    lastSeenResponse.current = latest?.id ?? null
    lastSeenMarket.current = marketOffer ? `${marketOffer.id}:${marketOffer.status}` : null
  }, [accepted, disabled, latest, historyOnly, marketOffer, showLatestResponse])

  useEffect(() => {
    if (wasHistoryOnly.current && !historyOnly && !disabled) wageInput.current?.focus({ preventScroll: true })
    wasHistoryOnly.current = historyOnly
  }, [historyOnly, disabled])

  function useTerms(terms: NegotiationTerms) {
    setWage(String(terms.seasonWage / 100)); setYears(terms.seasons)
    wageInput.current?.focus({ preventScroll: true })
  }

  return <dialog ref={dialog} id="player-contract-offer" className={`contract-offer${negotiations ? ' contract-offer-negotiations' : ''}`} aria-labelledby="contract-offer-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className="transfers-heading"><div><h2 id="contract-offer-title">{historyOnly ? 'Contract conversations' : accepted ? 'Contract agreed' : renewal ? 'Offer renewal' : 'Offer contract'} · {player.name}</h2><span>{player.position} · {player.heightCm} cm · {owner?.name ?? 'Free agent'}</span></div></header>
    {historyOnly ? <>
      <div className="contract-offer-body"><NegotiationHistory records={records} expanded />{entryQuote.reason && <p id="contract-history-availability" className="contract-offer-reason">Current availability: {entryQuote.reason}</p>}<p>{timedMarket ? 'Offseason reservations and deadlines are shown in the offer queue.' : 'Recorded replies are kept across seasons. Counteroffers reserve neither a squad place nor the player.'}</p></div>
      <footer><button ref={close} className="button" id="close-player-contract" onClick={onClose} disabled={disabled}>Close</button>{entryQuote.canOffer && <button id="continue-contract-talks" className="button primary" onClick={onContinue} disabled={disabled}>Open current contract talks<Icon name="chevron" size={14} /></button>}</footer>
    </> : accepted && signed ? <>
      <div className="contract-offer-body"><div role="status"><p className="contract-accepted">{player.name} has signed for {money(signed.seasonWage)} per season, from {seasonLabel(signed.startsSeason)} through {seasonLabel(signed.endsSeason)}.</p><p>The contract takes effect on opening day. The agreed wages are included in the next season allocation.</p></div><NegotiationHistory records={records} /></div>
      <footer><button ref={close} className="button primary" id="close-player-contract" onClick={onClose} disabled={disabled}>Done</button></footer>
    </> : <form onSubmit={event => { event.preventDefault(); if (!disabled && !submitReason) onOffer(player.id, seasonWage, years) }}>
      <div className="contract-offer-body">
        {timedMarket && marketOffer && marketOffer.status !== 'countered' && <section ref={marketStatus} className="contract-market-status" tabIndex={-1} role="status" aria-labelledby="contract-market-status-title" data-contract-market-offer={marketOffer.id} data-contract-market-status={marketOffer.status}>
          <div><h3 id="contract-market-status-title"><Icon name={marketOffer.status === 'pending' ? 'clock' : marketOffer.status === 'accepted' ? 'check' : 'close'} size={17} />{marketOfferStatus(marketOffer)}</h3>{liveOffer && <button type="button" id="withdraw-player-offer" className="text-button" onClick={() => onWithdrawOffer(liveOffer.id)} disabled={disabled}>Withdraw offer</button>}</div>
          {liveOffer ? <><dl><div><dt>Reply date</dt><dd><time dateTime={liveOffer.responseOn}>{scoutingDate(liveOffer.responseOn)}</time></dd></div><div><dt>Expires</dt><dd><time dateTime={liveOffer.expiresOn}>{scoutingDate(liveOffer.expiresOn)}</time></dd></div></dl><p>{money(liveOffer.seasonWage)} / year and one squad place held. {liveOffer.status === 'pending' ? 'Continue the offseason for the reply.' : 'Use the counteroffer or adjust the terms below.'}</p></> : <p>This offer no longer holds wages or a squad place.</p>}
        </section>}
        {negotiations && showLatestResponse && latest && <section ref={response} id="contract-player-response" className="contract-player-response" tabIndex={-1} aria-labelledby="contract-response-title" data-player-response={latest.outcome} data-contract-market-offer={timedMarket && liveOffer ? liveOffer.id : undefined} data-contract-market-status={timedMarket && liveOffer ? liveOffer.status : undefined}>
          <div><h3 id="contract-response-title">{negotiationOutcome(latest)}</h3><time dateTime={latest.date}>{scoutingDate(latest.date)}</time></div>
          {timedMarket && liveOffer && <div className="contract-counter-deadline"><span><Icon name="clock" size={14} />Held until <strong><time dateTime={liveOffer.expiresOn}>{scoutingDate(liveOffer.expiresOn)}</time></strong></span><button type="button" id="withdraw-player-offer" className="text-button" onClick={() => onWithdrawOffer(liveOffer.id)} disabled={disabled}>Withdraw offer</button></div>}
          <p>Your offer: {termsText(latest.offeredWage, latest.offeredSeasons)}.</p><p>{negotiationReasonText(latest)}</p>
          {latest.counterOffer && <div className="contract-response-option"><span>Player asks for <strong>{termsText(latest.counterOffer.seasonWage, latest.counterOffer.seasons)}</strong></span><button type="button" id="use-contract-counteroffer" className="button small" onClick={() => useTerms(latest.counterOffer!)} disabled={disabled}>Use counteroffer</button></div>}
          {latest.alternativeOffer && <div className="contract-response-option"><span>Shorter option <strong>{termsText(latest.alternativeOffer.seasonWage, latest.alternativeOffer.seasons)}</strong></span><button type="button" id="use-contract-alternative" className="button small" onClick={() => useTerms(latest.alternativeOffer!)} disabled={disabled}>Use shorter option</button></div>}
        </section>}

        {negotiations ? <details className="contract-offer-assessment"><summary>Player assessment · {knowledgeLabel(knowledge)}</summary>{assessment}</details> : assessment}
        <dl className="contract-offer-facts"><div><dt>{negotiations ? `Opening demand · ${years} ${years === 1 ? 'season' : 'seasons'}` : 'Requested annual wage'}</dt><dd data-contract-demand={openingDemand}>{money(openingDemand)} / season</dd></div><div><dt>Contract begins</dt><dd>{seasonLabel(quote.startsSeason)}</dd></div></dl>
        {proposalDates && <div className="contract-offer-dates"><span>{liveOffer ? 'New terms' : 'This offer'}</span><Icon name="calendar" size={16} /><span>Reply <strong><time dateTime={proposalDates.responseOn}>{scoutingDate(proposalDates.responseOn)}</time></strong></span><span>Expires <strong><time dateTime={proposalDates.expiresOn}>{scoutingDate(proposalDates.expiresOn)}</time></strong></span></div>}
        {negotiations && <div className="contract-demand-options" aria-label="Opening wage demands by contract length">{getNegotiationDemands(player.id).terms.map(terms => <div key={terms.seasons}><span>{terms.seasons} {terms.seasons === 1 ? 'season' : 'seasons'}</span><strong>{money(terms.seasonWage)} / year</strong></div>)}</div>}
        <div className="contract-offer-field"><label htmlFor="contract-offer-wage">Your annual wage offer · EUR</label><input ref={wageInput} id="contract-offer-wage" type="number" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={wage} onChange={event => setWage(event.target.value)} disabled={disabled} required aria-describedby="contract-wage-help" /><input type="range" aria-label="Adjust annual wage" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={Math.max(MIN_CONTRACT_WAGE / 100, Math.min(MAX_CONTRACT_WAGE / 100, Number(wage) || MIN_CONTRACT_WAGE / 100))} aria-valuetext={`${money(seasonWage)} per season`} onChange={event => setWage(event.target.value)} disabled={disabled} /><small id="contract-wage-help">{negotiations ? 'You can offer below the opening demand. The player may accept, counter or reject.' : 'Offers must meet the requested wage.'} Leave enough allocation for a squad of {MIN_ROSTER_SIZE}.</small></div>
        <div className="contract-offer-field"><label htmlFor="contract-offer-years">Contract length</label><select id="contract-offer-years" value={years} onChange={event => setYears(Number(event.target.value))} disabled={disabled}>{Array.from({ length: MAX_CONTRACT_SEASONS }, (_, index) => index + 1).map(length => <option key={length} value={length}>{length} {length === 1 ? 'season' : 'seasons'}</option>)}</select><input type="range" aria-label="Adjust contract length" min={1} max={MAX_CONTRACT_SEASONS} step={1} value={years} aria-valuetext={`${years} ${years === 1 ? 'season' : 'seasons'}`} onChange={event => setYears(Number(event.target.value))} disabled={disabled} /></div>
        <dl className="contract-offer-facts contract-offer-total"><div><dt>Contract through</dt><dd>{seasonLabel(quote.endsSeason)}</dd></div><div><dt>Total wages promised if accepted</dt><dd>{Number.isFinite(seasonWage) ? money(seasonWage * years) : 'Enter a wage'}</dd></div></dl>
{submitReason && <p id="contract-offer-reason" className="contract-offer-reason" role="status">{submitReason}</p>}
        <NegotiationHistory records={records} />
      </div><footer><p id="contract-binding-notice">{timedMarket && proposalDates ? <>The player decides on <strong>{scoutingDate(proposalDates.responseOn)}</strong>. Acceptance signs automatically; withdraw before then to cancel. {liveOffer ? 'Submitting revised terms replaces your current offer.' : 'Sending holds the annual wages and a squad place.'}</> : timedMarket ? 'Recruitment has closed. Existing records remain available.' : 'Submitting an offer signs a binding contract immediately if the player accepts. Wages are paid in season installments, with no signing payment.'}</p><button ref={close} type="button" className="button" onClick={onClose} disabled={disabled}>Close</button><button type="submit" id="confirm-player-contract" className="button primary" disabled={disabled || !!submitReason} aria-describedby={`contract-binding-notice${submitReason ? ' contract-offer-reason' : ''}`}>{timedMarket ? liveOffer ? 'Replace offer' : 'Send offer' : negotiations ? 'Submit offer' : 'Confirm offer'} · {Number.isFinite(seasonWage) ? money(seasonWage) : '—'} / season</button></footer>
    </form>}
  </dialog>
}
