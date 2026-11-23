import { useMemo, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { TradeProposal } from '../domain/trades'
import { nbaClubIds } from '../world/career-world'
import { clubContractsForRound } from '../world/employment-policy'
import { getCareerPlayer, getCareerPlayerAge } from '../world/player-catalog'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { seasonLabel } from '../world/season'
import { managerTradeProposals, quoteTradeProposal, seasonTrades, MANAGER_TRADE_LIMIT } from '../world/trades'
import { tradeDeadline, tradeView, tradeWindowReason, TRADE_RULES } from '../world/trades-policy'
import { PlayerRating } from './PlayerRating'
import { formatMoney } from './money-format'
import { InlineLogo } from './ClubLogo'
import { Icon } from './Icon'
import './trade-builder.css'

interface TradeBuilderProps {
  season: SeasonState
  disabled: boolean
  onPropose: (toClubId: string, sends: string[], receives: string[]) => void
  onWithdraw: (proposalId: string) => void
}

const STATUS_TEXT: Record<TradeProposal['status'], string> = { pending: 'Waiting for an answer', declined: 'Declined', agreed: 'Agreed: takes effect when the new season starts', completed: 'Completed', 'called-off': 'Called off', withdrawn: 'Withdrawn' }

/**
 * NBA step 9 (format 95): Transfers > Trades. Both squads side by side (pick one to three players a side), the salary
 * matching each club must meet, the squad sizes after the trade and one Send offer action; the other club answers in
 * the Inbox at the next boundary. Every value comes from the career's contracts and the trade rules.
 */
export function TradeBuilder({ season, disabled, onPropose, onWithdraw }: TradeBuilderProps) {
  const ownId = season.managedClubId
  const clubs = useMemo(() => [...nbaClubIds(season.world!)].filter(id => id !== ownId).map(id => season.clubs.find(club => club.id === id)!).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'en')), [season, ownId])
  const [partner, setPartner] = useState(clubs[0]?.id ?? '')
  const [sends, setSends] = useState<string[]>([])
  const [receives, setReceives] = useState<string[]>([])
  const view = tradeView(season)
  const windowReason = tradeWindowReason(season)
  const quote = sends.length && receives.length ? quoteTradeProposal(season, partner, sends, receives) : null
  const proposals = managerTradeProposals(season).filter(proposal => proposal.seasonNumber === season.seasonNumber)
  const recent = seasonTrades(season)
  const name = (clubId: string) => season.clubs.find(club => club.id === clubId)?.name ?? clubId
  const playerName = (playerId: string) => getCareerPlayer(season, playerId).name
  const toggle = (list: string[], set: (next: string[]) => void, playerId: string) => set(list.includes(playerId) ? list.filter(id => id !== playerId) : list.length < MANAGER_TRADE_LIMIT ? [...list, playerId] : list)

  const squad = (clubId: string, picked: string[], set: (next: string[]) => void, own: boolean) => {
    const contracts = clubContractsForRound(season.employment, view.season, view.round, clubId)
    return <table className="trade-squad-table">
      <thead><tr><th scope="col"><span className="sr-only">Choose</span></th><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Rating</th><th scope="col">Age</th><th scope="col">Salary</th><th scope="col">Until</th></tr></thead>
      <tbody>{contracts.map(contract => {
        const player = getCareerPlayer(season, contract.playerId), checked = picked.includes(player.id)
        const until = Math.max(...season.employment.contracts.filter(item => item.playerId === player.id && item.clubId === clubId).map(item => item.endsSeason))
        return <tr key={player.id} className={checked ? 'selected' : ''} data-trade-player={player.id}>
          <td><input type="checkbox" id={`trade-${own ? 'send' : 'receive'}-${player.id}`} aria-label={`${own ? 'Send' : 'Ask for'} ${player.name}`} checked={checked} disabled={disabled || !checked && picked.length >= MANAGER_TRADE_LIMIT} onChange={() => toggle(picked, set, player.id)} /></td>
          <td><label htmlFor={`trade-${own ? 'send' : 'receive'}-${player.id}`}>{player.name}</label></td>
          <td>{player.position}</td>
          <td>{own ? <PlayerRating attributes={player.attributes} position={player.position} compact /> : <PlayerRating knowledge={getPlayerKnowledge(season, player.id)} position={player.position} compact />}</td>
          <td>{getCareerPlayerAge(season, player.id, season.date) ?? '–'}</td>
          <td>{formatMoney(contract.seasonWage)}</td>
          <td>{seasonLabel(until)}</td>
        </tr>
      })}</tbody>
    </table>
  }

  const matchRow = (check: NonNullable<typeof quote>['clubs'][number]) => {
    const limit = check.maxIncoming
    const share = limit ? Math.min(100, check.incoming / limit * 100) : 0
    return <div className="trade-match-row" key={check.clubId} data-trade-match={check.clubId}>
      <div><strong>{name(check.clubId)}</strong><span>sends {formatMoney(check.outgoing)} · takes {formatMoney(check.incoming)}</span></div>
      {limit === null
        ? <span className="trade-match-note">Under the salary cap after the trade: no salary matching needed.</span>
        : <div className={`trade-match-bar${check.incoming > limit ? ' over' : ''}`} role="img" aria-label={`Takes ${formatMoney(check.incoming)} of at most ${formatMoney(limit)}`}><span style={{ width: `${share}%` }} /></div>}
      {limit !== null && <span className="trade-match-note">At most {formatMoney(limit)} back (125% + $100,000){check.incoming > limit ? ' · too much salary' : ''}</span>}
      <span className="trade-match-note">Squad {check.rosterBefore} → {check.rosterAfter} players</span>
    </div>
  }

  return <section className="trade-builder panel" aria-labelledby="trade-builder-title" data-trade-builder>
    <header className="transfers-heading"><div><h2 id="trade-builder-title"><Icon name="swap" size={16} />Trades</h2><span>{windowReason ?? (season.status === 'complete' ? `Offseason trades for ${seasonLabel(season.seasonNumber + 1)}: the trade takes effect when the new season starts.` : `Trade deadline ${tradeDeadline(season.seasonNumber)}. An accepted trade registers at the next week.`)}</span></div></header>

    {proposals.length > 0 && <ul className="trade-proposals" aria-label="Your trade offers">{proposals.map(proposal => <li key={proposal.id} data-trade-proposal={proposal.status}>
      <span><InlineLogo kind="club" id={proposal.toClubId} name={name(proposal.toClubId)} decorative /> <strong>{name(proposal.toClubId)}</strong>: {proposal.sends.map(playerName).join(', ')} for {proposal.receives.map(playerName).join(', ')}</span>
      <span>{STATUS_TEXT[proposal.status]}{proposal.status === 'pending' ? ` (answer on ${proposal.answerOn})` : ''}{proposal.reason && proposal.status !== 'withdrawn' ? ` · ${proposal.reason}` : ''}</span>
      {(proposal.status === 'pending' || proposal.status === 'agreed') && <button className="text-button" onClick={() => onWithdraw(proposal.id)} disabled={disabled}>Withdraw</button>}
    </li>)}</ul>}

    <div className="trade-sides">
      <div className="trade-side"><h3>{name(ownId)} sends</h3>{squad(ownId, sends, setSends, true)}</div>
      <div className="trade-side">
        <h3><label htmlFor="trade-partner">Trade with</label> <select id="trade-partner" value={partner} disabled={disabled} onChange={event => { setPartner(event.target.value); setReceives([]) }}>{clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</select></h3>
        {partner && squad(partner, receives, setReceives, false)}
      </div>
    </div>

    <div className="trade-summary" aria-live="polite">
      {quote ? quote.clubs.map(matchRow) : <span className="trade-match-note">Choose one to {TRADE_RULES.maxPlayersPerSide} players on each side.</span>}
      {quote?.reason && <p className="trade-reason" role="status">{quote.reason}</p>}
      <button id="trade-send" className="button" disabled={disabled || !quote || quote.reason !== null} onClick={() => { onPropose(partner, sends, receives); setSends([]); setReceives([]) }}>Send offer</button>
    </div>

    {recent.length > 0 && <details className="trade-recent"><summary>Trades this season ({recent.length})</summary><ul>{recent.map(trade => <li key={trade.id} data-trade={trade.source}>
      {trade.completedOn}: {trade.clubIds.map(clubId => `${name(clubId)} send ${trade.moves.filter(move => move.fromClubId === clubId).map(move => playerName(move.playerId)).join(', ')}`).join(' · ')}
    </li>)}</ul></details>}
  </section>
}
