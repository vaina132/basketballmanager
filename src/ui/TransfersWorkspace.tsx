import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Player, Position } from '../domain/types'
import { getDevelopmentPlayer } from '../data/development-players'
import { getSeasonWage } from '../data/development-wages'
import { contractForSeason, getAvailablePlayers, getClubContractSummary, MAX_CONTRACT_SEASONS, MAX_CONTRACT_WAGE, MAX_ROSTER_SIZE, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, quotePlayerContract, WAGE_STEP } from '../world/employment-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { knowledgeLabel, ScoutingKnowledge } from './ScoutingKnowledge'
import './transfers-workspace.css'

interface TransfersWorkspaceProps {
  season: SeasonState
  disabled: boolean
  onEnable: () => void
  onDelegation: (delegated: boolean) => void
  onOffer: (playerId: string, seasonWage: number, seasons: number) => void
  onStartSeason: () => void
  focusedPlayerId: string | null
  onClearFocusedPlayer: () => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
}

const formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => formatter.format(cents / 100)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']
type ContractView = 'squad' | 'next' | 'market'

export function TransfersWorkspace({ season, disabled, onEnable, onDelegation, onOffer, onStartSeason, focusedPlayerId, onClearFocusedPlayer, onOpenScouting, onShortlist }: TransfersWorkspaceProps) {
  const [view, setView] = useState<ContractView>('squad')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [offerId, setOfferId] = useState<string | null>(null)
  const focusedReport = useRef<HTMLElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const wasDisabled = useRef(disabled)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.employment.enabledSince !== null
  const nextYear = season.seasonNumber + 1
  const hasNextYear = nextYear <= MAX_SEASON_NUMBER
  const summary = getClubContractSummary(season, club.id, nextYear)
  const marketOpen = enabled && hasNextYear && season.status === 'complete' && season.employment.market?.seasonNumber === nextYear
  const selected = offerId ? getDevelopmentPlayer(offerId) : null
  const selectedView = !hasNextYear || view === 'market' && !marketOpen ? 'squad' : view
  const available = marketOpen ? getAvailablePlayers(season) : []
  const nextPlayers = summary.contracts.map(contract => getDevelopmentPlayer(contract.playerId))
  const source = selectedView === 'squad' ? club.players : selectedView === 'next' ? nextPlayers : available
  const players = source.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position))
  const expiring = enabled ? club.players.filter(player => contractForSeason(season.employment, player.id, season.seasonNumber)?.endsSeason === season.seasonNumber && !contractForSeason(season.employment, player.id, nextYear)).length : 0
  const enableReason = !season.finance.enabledSince ? 'Enable club finances in Club before starting player contracts.' : !season.payroll.enabledSince ? 'Enable player payroll in Squad before starting player contracts.' : null
  const startReason = summary.rosterSize < MIN_ROSTER_SIZE ? `Sign ${MIN_ROSTER_SIZE - summary.rosterSize} more ${MIN_ROSTER_SIZE - summary.rosterSize === 1 ? 'player' : 'players'} for next season.` : summary.rosterSize > MAX_ROSTER_SIZE ? `The squad must contain no more than ${MAX_ROSTER_SIZE} players.` : null
  const focused = focusedPlayerId ? getDevelopmentPlayer(focusedPlayerId) : null
  const focusedQuote = focused ? quotePlayerContract(season, focused.id, getSeasonWage(focused.id), 1) : null
  const shortlist = season.scouting.clubs[club.id]!.shortlist
  const scoutingEnabled = season.scouting.enabledSince !== null

  useEffect(() => {
    if (!focusedPlayerId) return
    const frame = requestAnimationFrame(() => { focusedReport.current?.focus({ preventScroll: true }); focusedReport.current?.scrollIntoView({ block: 'nearest' }) })
    return () => cancelAnimationFrame(frame)
  }, [focusedPlayerId])

  useEffect(() => {
    if (wasDisabled.current && !disabled && document.activeElement === document.body) {
      if (lastFocus.current?.isConnected && !lastFocus.current.matches(':disabled')) lastFocus.current.focus({ preventScroll: true })
      else (focusedReport.current ?? document.getElementById('transfers-heading'))?.focus({ preventScroll: true })
    }
    wasDisabled.current = disabled
  }, [disabled])

  function closeFocusedReview() {
    onClearFocusedPlayer()
    document.getElementById('transfers-heading')?.focus({ preventScroll: true })
  }

  return <div className="transfers-workspace" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target }}>
    <section className="transfers-overview panel" aria-labelledby="transfers-heading">
      <header className="transfers-heading"><div><h2 id="transfers-heading" tabIndex={-1}>{club.name} · Contracts</h2><span>{seasonLabel(season.seasonNumber)}{marketOpen ? ' · Offseason recruitment' : ' · Squad planning'}</span></div>{enabled && marketOpen && <div className="transfers-start"><button id="start-contract-season" className="button primary" onClick={onStartSeason} disabled={disabled || !!startReason} aria-describedby={startReason ? 'contract-season-reason' : undefined}>Start {seasonLabel(nextYear)}<Icon name="chevron" size={15} /></button>{startReason && <small id="contract-season-reason">{startReason}</small>}</div>}</header>
      {enabled && hasNextYear && <><dl className="transfers-summary"><div><dt>Next season squad</dt><dd data-next-contract-roster={summary.rosterSize}>{summary.rosterSize}<small> / {MIN_ROSTER_SIZE}–{MAX_ROSTER_SIZE} players</small></dd></div><div><dt>Annual wages committed</dt><dd data-contract-committed={summary.seasonWages}>{money(summary.seasonWages)}</dd></div><div><dt>Annual board allocation</dt><dd>{money(summary.budget)}</dd></div><div><dt>Available after squad reserve</dt><dd data-contract-spendable={summary.spendableBudget}>{money(summary.spendableBudget)}</dd></div></dl><div className="transfers-budget-note"><span>{money(summary.minimumReserve)} protected to reach {MIN_ROSTER_SIZE} players.</span><span>{expiring} {expiring === 1 ? 'player has' : 'players have'} no contract for next season.</span></div></>}
      {!hasNextYear && <p className="transfers-note">The calendar has reached its final supported season. Existing records remain available; further seasons and contracts cannot be created.</p>}
    </section>

    {focused && focusedQuote && <section ref={focusedReport} id="transfer-player-review" className="transfer-player-review panel" tabIndex={-1} aria-labelledby="transfer-player-review-title" data-transfer-focus={focused.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeFocusedReview() } }}><header className="transfers-heading"><div><h2 id="transfer-player-review-title">{focused.name}</h2><span>{season.clubs.find(team => team.players.some(player => player.id === focused.id))?.name ?? 'Free agent'} · {focused.position} · {focused.heightCm} cm</span></div><button className="text-button" aria-label="Close player contract review" onClick={closeFocusedReview} disabled={disabled}><Icon name="close" size={14} />Close</button></header><div className="transfer-player-review-body"><ScoutingKnowledge knowledge={getPlayerKnowledge(season, focused.id)} /><div className="transfer-player-review-actions"><p>Requested annual wage <strong>{money(getSeasonWage(focused.id))}</strong></p><button id="transfer-focused-offer" className="button primary" onClick={() => setOfferId(focused.id)} disabled={disabled || !focusedQuote.canOffer} aria-describedby={focusedQuote.reason ? 'transfer-focused-reason' : undefined}>Offer contract</button>{focusedQuote.reason && <p id="transfer-focused-reason">{focusedQuote.reason}</p>}<button className="button" aria-pressed={shortlist.includes(focused.id)} onClick={() => onShortlist(focused.id, !shortlist.includes(focused.id))} disabled={disabled || !scoutingEnabled}>{shortlist.includes(focused.id) ? 'Remove from shortlist' : 'Add to shortlist'}</button><button className="text-button" onClick={() => onOpenScouting(focused.id)} disabled={disabled}>Open scouting report<Icon name="chevron" size={14} /></button></div></div></section>}

    {!enabled ? <section className="transfers-enable panel" aria-labelledby="contracts-enable-title"><header className="transfers-heading"><h2 id="contracts-enable-title">Player contracts</h2><span>Not enabled</span></header><div><p>Give every current player a contract through the end of this season at their existing wage. Renew expiring players, then recruit available players when the season ends. Signed deals take effect on the next opening day.</p>{enableReason && <p id="contracts-enable-reason">{enableReason}</p>}<button id="enable-contracts" className="button primary" onClick={onEnable} disabled={disabled || !!enableReason} aria-describedby={enableReason ? 'contracts-enable-reason' : undefined}>Enable player contracts<Icon name="people" size={15} /></button></div></section> : <>
      {hasNextYear && <section className="transfers-policy panel" aria-labelledby="contracts-control-title"><header className="transfers-heading"><h2 id="contracts-control-title">Contract responsibility</h2><span>{season.employment.delegated ? 'Assistant' : 'Manual'}</span></header><div className="transfers-policy-body"><div className="transfers-policy-control"><label htmlFor="contracts-control">Renewals and offseason recruitment</label><input id="contracts-control" type="range" min={0} max={1} step={1} value={season.employment.delegated ? 1 : 0} aria-valuetext={season.employment.delegated ? 'Assistant' : 'Manual'} aria-describedby="contracts-control-help" onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /><div><span>Manual</span><span>Assistant</span></div></div><p id="contracts-control-help">Switching to Assistant immediately renews expiring players toward a squad of 10. It also recruits during the offseason, within the allocation. Accepted contracts remain binding when control changes.</p></div></section>}

      <section className="transfers-players panel" aria-labelledby="contracts-list-title">
        <header className="transfers-heading"><h2 id="contracts-list-title">{selectedView === 'squad' ? 'Current squad contracts' : selectedView === 'next' ? `Squad for ${seasonLabel(nextYear)}` : 'Available for next season'}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></header>
        <div className="transfers-toolbar"><div className="segmented" role="group" aria-label="Contract lists"><button aria-pressed={selectedView === 'squad'} className={selectedView === 'squad' ? 'selected' : ''} onClick={() => setView('squad')} disabled={disabled}>Current squad</button>{hasNextYear && <button aria-pressed={selectedView === 'next'} className={selectedView === 'next' ? 'selected' : ''} onClick={() => setView('next')} disabled={disabled}>Next season ({summary.rosterSize})</button>}{marketOpen && <button id="open-contract-market" aria-pressed={selectedView === 'market'} className={selectedView === 'market' ? 'selected' : ''} onClick={() => setView('market')} disabled={disabled}>Available players ({available.length})</button>}</div><div className="transfers-filters"><label htmlFor="contract-player-search">Player<input id="contract-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="contract-position">Position<select id="contract-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
        <div className="transfers-table-scroll" tabIndex={0} role="region" aria-label={selectedView === 'market' ? 'Available players' : 'Player contracts'}><table className="transfers-table"><thead><tr><th scope="col">Player</th><th scope="col">{selectedView === 'market' ? 'Current club' : 'Contract through'}</th><th scope="col">{selectedView === 'market' ? 'Requested annual wage' : 'Annual wage'}</th><th scope="col">{selectedView === 'next' ? 'Starts' : 'Next season'}</th><th scope="col">Knowledge</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
          const current = contractForSeason(season.employment, player.id, season.seasonNumber)
          const next = contractForSeason(season.employment, player.id, nextYear)
          const displayed = selectedView === 'next' ? next : current
          const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
          const record = owner?.players.find(member => member.id === player.id) ?? player
          const quote = quotePlayerContract(season, player.id, getSeasonWage(player.id), 1)
          const secured = next?.clubId === club.id
          const action = current?.clubId === club.id ? 'Renew' : 'Offer contract'
          return <tr key={player.id} data-contract-player={player.id}>
            <th scope="row"><button className="transfers-player transfers-player-report" aria-label={`Scouting report for ${player.name}`} data-transfer-scouting={player.id} onClick={() => onOpenScouting(player.id)} disabled={disabled}><span aria-hidden="true"><Avatar player={record} color={owner?.color ?? '#687385'} size={30} /></span><span><strong>{player.name}</strong><small>{player.position} · {player.heightCm} cm</small></span></button></th>
            <td>{selectedView === 'market' ? owner?.name ?? 'Free agent' : displayed ? seasonLabel(displayed.endsSeason) : 'No contract'}</td>
            <td>{money(selectedView === 'market' ? getSeasonWage(player.id) : displayed?.seasonWage ?? 0)}</td>
            <td>{!hasNextYear ? 'Calendar limit' : selectedView === 'next' && next ? seasonLabel(next.startsSeason) : secured ? <span className="transfers-secured">Signed · {money(next.seasonWage)}</span> : next ? `Joining ${season.clubs.find(team => team.id === next.clubId)!.name}` : <span className="transfers-expiring">Not renewed</span>}</td>
            <td className="transfers-knowledge"><span>{knowledgeLabel(getPlayerKnowledge(season, player.id))}</span><button className="text-button" data-transfer-shortlist={player.id} aria-pressed={shortlist.includes(player.id)} aria-label={`${shortlist.includes(player.id) ? 'Remove' : 'Add'} ${player.name} ${shortlist.includes(player.id) ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !shortlist.includes(player.id))} disabled={disabled || !scoutingEnabled}>{shortlist.includes(player.id) ? 'Shortlisted' : 'Add to shortlist'}</button></td>
            <td className="transfers-action">{!hasNextYear ? 'No further contracts' : selectedView === 'next' || secured ? <span>Signed through {seasonLabel(next!.endsSeason)}</span> : <><button id={`transfer-player-${player.id}`} className="button small" aria-label={`${action} ${player.name}`} onClick={() => setOfferId(player.id)} disabled={disabled || !quote.canOffer} aria-describedby={!quote.canOffer ? `contract-reason-${player.id}` : undefined}>{action}</button>{!quote.canOffer && <small id={`contract-reason-${player.id}`}>{quote.reason}</small>}</>}</td>
          </tr>
        })}{!players.length && <tr><td colSpan={6} className="transfers-empty">{query || position !== 'all' ? 'No players match these filters.' : selectedView === 'next' ? 'No players are signed for next season. Review your current squad to offer renewals.' : selectedView === 'market' ? 'No players are available for next season.' : 'No players in this squad.'}</td></tr>}</tbody></table></div>
        {hasNextYear && <p className="transfers-note">{marketOpen ? 'Recruitment closes when you start the next season. Unrenewed contracts then expire and signed players join their new clubs.' : 'Renewals can be agreed during the season. Available players can be recruited after the final matchday.'} Contracts cover 1–{MAX_CONTRACT_SEASONS} seasons; each covered year must fit the board allocation.</p>}
      </section>
      <p className="transfers-model-note">Fictional development wages. The board allocation limits annual promises; wages are paid through the season payroll. Contract decisions trigger an automatic save. Export keeps a separate file backup.</p>
    </>}
    {selected && enabled && <PlayerContractOffer key={selected.id} season={season} player={selected} disabled={disabled} onClose={() => setOfferId(null)} onOffer={onOffer} onOpenScouting={onOpenScouting} onShortlist={onShortlist} />}
  </div>
}

function PlayerContractOffer({ season, player, disabled, onClose, onOffer, onOpenScouting, onShortlist }: { season: SeasonState; player: Player; disabled: boolean; onClose: () => void; onOffer: TransfersWorkspaceProps['onOffer']; onOpenScouting: TransfersWorkspaceProps['onOpenScouting']; onShortlist: TransfersWorkspaceProps['onShortlist'] }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [wage, setWage] = useState(String(getSeasonWage(player.id) / 100))
  const [years, setYears] = useState(1)
  const seasonWage = wage.trim() ? Math.round(Number(wage) * 100) : 0
  const quote = quotePlayerContract(season, player.id, seasonWage, years)
  const signed = contractForSeason(season.employment, player.id, season.seasonNumber + 1)
  const accepted = signed?.clubId === season.managedClubId
  const current = contractForSeason(season.employment, player.id, season.seasonNumber)
  const renewal = current?.clubId === season.managedClubId
  const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
  const shortlisted = season.scouting.clubs[season.managedClubId]!.shortlist.includes(player.id)

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
    if (accepted && !disabled) close.current?.focus({ preventScroll: true })
  }, [accepted, disabled])

  return <dialog ref={dialog} id="player-contract-offer" className="contract-offer" aria-labelledby="contract-offer-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className="transfers-heading"><div><h2 id="contract-offer-title">{accepted ? 'Contract agreed' : renewal ? 'Offer renewal' : 'Offer contract'} · {player.name}</h2><span>{player.position} · {player.heightCm} cm · {owner?.name ?? 'Free agent'}</span></div></header>
    {accepted && signed ? <><div className="contract-offer-body" role="status"><p className="contract-accepted">{player.name} has signed for {money(signed.seasonWage)} per season, from {seasonLabel(signed.startsSeason)} through {seasonLabel(signed.endsSeason)}.</p><p>The contract takes effect on opening day. The agreed wages are included in the next season allocation.</p></div><footer><button ref={close} className="button primary" id="close-player-contract" onClick={onClose} disabled={disabled}>Done</button></footer></> : <form onSubmit={event => { event.preventDefault(); if (!disabled && quote.canOffer) onOffer(player.id, seasonWage, years) }}>
      <div className="contract-offer-body"><div className="contract-offer-knowledge"><ScoutingKnowledge knowledge={getPlayerKnowledge(season, player.id)} compact /><div><button type="button" className="text-button" onClick={() => { onClose(); onOpenScouting(player.id) }} disabled={disabled}>Scouting report<Icon name="chevron" size={13} /></button><button type="button" className="text-button" aria-pressed={shortlisted} onClick={() => onShortlist(player.id, !shortlisted)} disabled={disabled || !season.scouting.enabledSince}>{shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}</button></div></div><dl className="contract-offer-facts"><div><dt>Requested annual wage</dt><dd>{money(quote.askingWage)}</dd></div><div><dt>Contract begins</dt><dd>{seasonLabel(quote.startsSeason)}</dd></div></dl>
        <div className="contract-offer-field"><label htmlFor="contract-offer-wage">Annual wage · EUR</label><input id="contract-offer-wage" type="number" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={wage} onChange={event => setWage(event.target.value)} disabled={disabled} required aria-describedby="contract-wage-help" /><input type="range" aria-label="Adjust annual wage" min={MIN_CONTRACT_WAGE / 100} max={MAX_CONTRACT_WAGE / 100} step={WAGE_STEP / 100} value={Math.max(MIN_CONTRACT_WAGE / 100, Math.min(MAX_CONTRACT_WAGE / 100, Number(wage) || MIN_CONTRACT_WAGE / 100))} aria-valuetext={`${money(seasonWage)} per season`} onChange={event => setWage(event.target.value)} disabled={disabled} /><small id="contract-wage-help">Offers must meet the requested wage and leave enough allocation for a squad of {MIN_ROSTER_SIZE}.</small></div>
        <div className="contract-offer-field"><label htmlFor="contract-offer-years">Contract length</label><select id="contract-offer-years" value={years} onChange={event => setYears(Number(event.target.value))} disabled={disabled}>{Array.from({ length: MAX_CONTRACT_SEASONS }, (_, index) => index + 1).map(length => <option key={length} value={length}>{length} {length === 1 ? 'season' : 'seasons'}</option>)}</select></div>
        <dl className="contract-offer-facts contract-offer-total"><div><dt>Contract through</dt><dd>{seasonLabel(quote.endsSeason)}</dd></div><div><dt>Total wages promised</dt><dd>{Number.isFinite(seasonWage) ? money(seasonWage * years) : 'Enter a wage'}</dd></div></dl>
        <p>An accepted offer is binding for the full term. Wages are paid in season installments, with no signing payment.</p>{quote.reason && <p id="contract-offer-reason" className="contract-offer-reason" role="status">{quote.reason}</p>}
      </div><footer><button ref={close} type="button" className="button" onClick={onClose} disabled={disabled}>Cancel</button><button type="submit" id="confirm-player-contract" className="button primary" disabled={disabled || !quote.canOffer} aria-describedby={quote.reason ? 'contract-offer-reason' : undefined}>Confirm offer · {Number.isFinite(seasonWage) ? money(seasonWage) : '—'} / season</button></footer>
    </form>}
  </dialog>
}
