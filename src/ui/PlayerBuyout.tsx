import { useEffect, useRef } from 'react'
import type { SeasonState } from '../domain/season'
import type { Player } from '../domain/types'
import { getDevelopmentPlayer } from '../data/development-players'
import { quoteContractBuyout } from '../world/buyouts'
import { MIN_ROSTER_SIZE } from '../world/employment-policy'
import { getSpendableCash } from '../world/payroll'
import { dateForRound, seasonLabel } from '../world/season'
import { getTransferInstallmentRemaining, getTransferInstallments } from '../world/transfer-payments'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { transferMoney as money } from './TransferPaymentTerms'
import './buyout.css'

interface PlayerBuyoutProps {
  season: SeasonState
  player: Player
  disabled: boolean
  onClose: () => void
  onBuyout: (playerId: string) => void
  onFindReplacement: () => void
}

export function PlayerBuyout({ season, player, disabled, onClose, onBuyout, onFindReplacement }: PlayerBuyoutProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const club = season.clubs.find(item => item.id === season.managedClubId)!
  const completed = season.employment.buyouts.find(item => item.playerId === player.id && item.clubId === club.id && item.seasonNumber === season.seasonNumber)
  const quote = quoteContractBuyout(season, player.id)
  const releaseIds = completed?.releasedContractIds ?? quote.releasedContractIds
  const terms = season.employment.contracts.filter(contract => releaseIds.includes(contract.id))
  const startsSeason = completed?.startsSeason ?? quote.startsSeason
  const amount = completed?.amount ?? quote.amount
  const opening = dateForRound(1, startsSeason)
  const salaryFreed = completed ? terms.filter(contract => contract.startsSeason <= startsSeason && contract.endsSeason >= startsSeason).reduce((sum, contract) => sum + contract.seasonWage, 0) : quote.seasonWageFreed
  const remainingBudget = completed ? getSpendableCash(season, club.id) : quote.remainingBudgetAfter
  const transferDebt = season.employment.transfers.filter(transfer => transfer.playerId === player.id && transfer.toClubId === club.id).reduce((sum, transfer) => sum + getTransferInstallments(transfer).reduce((balance, _installment, index) => balance + getTransferInstallmentRemaining(transfer, index), 0), 0)

  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    close.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true })
      else document.getElementById('transfers-heading')?.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => { if (completed && !disabled) close.current?.focus({ preventScroll: true }) }, [completed?.id, disabled])

  return <dialog ref={dialog} id="player-buyout" className="contract-offer player-buyout" aria-labelledby="player-buyout-title" onCancel={event => { event.preventDefault(); if (!disabled) onClose() }}>
    <header className="transfers-heading"><h2 id="player-buyout-title">{completed ? 'Contract bought out' : 'Buy out contract'}</h2><span>{seasonLabel(startsSeason)} onwards</span></header>
    <div className="contract-offer-body">
      <div className="buyout-player"><span aria-hidden="true"><Avatar player={player} color={club.color} size={52} /></span><div><strong>{player.name}</strong><span>{player.position} · {player.heightCm} cm · {club.name}</span></div>{completed && <Icon name="check" size={22} />}</div>
      <div className="buyout-compensation"><span><Icon name="wallet" size={19} />{completed ? 'Compensation paid' : 'Compensation due now'}</span><strong data-buyout-amount={amount}>{money(amount)}</strong>{completed && <time dateTime={completed.completedOn}>{scoutingDate(completed.completedOn)}</time>}</div>
      <dl className="contract-offer-facts buyout-facts"><div><dt>{completed ? 'Remaining budget' : 'Remaining budget after payment'}</dt><dd data-buyout-remaining={remainingBudget}>{money(remainingBudget)}</dd></div><div><dt>Salary budget freed · {seasonLabel(startsSeason)}</dt><dd data-buyout-salary-freed={salaryFreed}>{money(salaryFreed)} / year</dd></div>{!completed && <div><dt>Next season's squad after release</dt><dd data-buyout-roster-after={quote.rosterSizeAfter}>{quote.rosterSizeAfter} players</dd></div>}</dl>
      <div className="buyout-result" role={completed ? 'status' : undefined}><Icon name={completed ? 'check' : 'calendar'} size={18} /><p>{completed ? <>Released from your {seasonLabel(startsSeason)} squad. Other clubs can now offer a contract.</> : <>Release takes effect on <time dateTime={opening}>{scoutingDate(opening)}</time>. The compensation is paid immediately.</>}</p></div>
      {!completed && quote.rosterSizeAfter < MIN_ROSTER_SIZE && <p className="buyout-replacement"><Icon name="people" size={17} />{MIN_ROSTER_SIZE - quote.rosterSizeAfter} more {MIN_ROSTER_SIZE - quote.rosterSizeAfter === 1 ? 'player needed' : 'players needed'} before next season can start.</p>}
      {transferDebt > 0 && <p className="buyout-existing-fees"><Icon name="wallet" size={17} />{money(transferDebt)} in existing transfer payments remains due separately.</p>}
      {!completed && quote.reason && <p id="buyout-unavailable-reason" className="contract-offer-reason">{quote.reason}</p>}
      <details className="game-disclosure buyout-terms"><summary><Icon name="calendar" size={15} />What the payment covers</summary><div><p>The full remaining salary in these contracts. Previous match records and completed-season registrations stay intact. This club cannot re-sign the player during this offseason.</p><dl>{terms.map(contract => {
        const first = Math.max(contract.startsSeason, startsSeason)
        return <div key={contract.id}><dt>{seasonLabel(first)}{contract.endsSeason !== first && <>–{seasonLabel(contract.endsSeason)}</>}<small>{money(contract.seasonWage)} per season</small></dt><dd>{money(contract.seasonWage * (contract.endsSeason - first + 1))}</dd></div>
      })}</dl></div></details>
    </div>
    <footer><button ref={close} id="cancel-player-buyout" className="button" onClick={onClose} disabled={disabled}>{completed ? 'Done' : 'Cancel'}</button>{completed ? <button id="buyout-find-replacement" className="button primary" onClick={onFindReplacement} disabled={disabled}>Find replacement<Icon name="search" size={15} /></button> : <button id="confirm-player-buyout" className="button primary" onClick={() => onBuyout(player.id)} disabled={disabled || !quote.canBuyout} aria-describedby={quote.reason ? 'buyout-unavailable-reason' : undefined}>Pay {money(amount)} &amp; release<Icon name="arrow" size={15} /></button>}</footer>
  </dialog>
}

export function BuyoutHistory({ season }: { season: SeasonState }) {
  const records = season.employment.buyouts.filter(item => item.clubId === season.managedClubId)
  if (!records.length) return null
  return <details className="game-disclosure panel buyout-history"><summary><Icon name="people" size={17} />Contract buyouts · {records.length}</summary><div className="transfers-table-scroll" role="region" aria-label="Contract buyout history" tabIndex={0}><table className="transfers-table"><thead><tr><th scope="col">Player</th><th scope="col">Compensation paid</th><th scope="col">Paid on</th><th scope="col">Released from</th></tr></thead><tbody>{[...records].reverse().map(record => <tr key={record.id} data-buyout-history={record.id}><th scope="row">{getDevelopmentPlayer(record.playerId).name}</th><td>{money(record.amount)}</td><td><time dateTime={record.completedOn}>{scoutingDate(record.completedOn)}</time></td><td>{seasonLabel(record.startsSeason)}</td></tr>)}</tbody></table></div></details>
}
