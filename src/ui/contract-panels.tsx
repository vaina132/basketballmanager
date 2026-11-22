import type { SeasonState } from '../domain/season'
import { getClubContractSummary, MAX_CONTRACT_SEASONS } from '../world/employment-policy'
import { Icon } from './Icon'
import { formatEuros } from './money-format'

/** Shared by Transfers and Squad > Contracts (owner, 16 November 2026: own contracts moved out of Transfers). */
export function ContractsEnablePanel({ season, disabled, onEnable }: { season: SeasonState; disabled: boolean; onEnable: () => void }) {
  const enableReason = !season.finance.enabledSince ? 'Enable club finances in Club before starting player contracts.' : !season.payroll.enabledSince ? 'Enable player payroll in Squad before starting player contracts.' : null
  return <section className="transfers-enable panel" aria-labelledby="contracts-enable-title"><header className="transfers-heading"><h2 id="contracts-enable-title">Player contracts</h2><span>Not enabled</span></header><div><p>Give every current player a contract through the end of this season at their existing wage. Renew expiring players, then recruit available players when the season ends. Signed deals take effect on the next opening day.</p>{enableReason && <p id="contracts-enable-reason">{enableReason}</p>}<button id="enable-contracts" className="button primary" onClick={onEnable} disabled={disabled || !!enableReason} aria-describedby={enableReason ? 'contracts-enable-reason' : undefined}>Enable player contracts<Icon name="people" size={15} /></button></div></section>
}

/** One authoritative setting: the assistant handles renewals, recruitment and sales; buyouts stay the manager's. */
export function ContractDelegation({ season, disabled, onDelegation }: { season: SeasonState; disabled: boolean; onDelegation: (delegated: boolean) => void }) {
  return <section className="transfers-policy panel" aria-labelledby="contracts-control-title"><div className="transfers-policy-body"><h2 id="contracts-control-title"><Icon name="staff" size={20} />Who handles contracts?</h2><div className="transfers-policy-control"><label htmlFor="contracts-control" className="sr-only">Contract and transfer control</label><input id="contracts-control" type="range" min={0} max={1} step={1} value={season.employment.delegated ? 1 : 0} aria-valuetext={season.employment.delegated ? 'Assistant' : 'Manual'} aria-describedby="contracts-control-help" onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /><div><span>Me</span><span>Assistant</span></div></div><span id="contracts-control-help">{season.employment.delegated ? 'Assistant handles renewals, recruitment and sales. Buyouts stay your decision.' : 'Assistant can handle renewals, recruitment and sales. Buyouts stay your decision.'}</span></div></section>
}

/** Next season's salary budget behind a disclosure: signed, held by offers, the total and what is left. */
export function ContractBudgetSummary({ season, note }: { season: SeasonState; note: string }) {
  const summary = getClubContractSummary(season, season.managedClubId, season.seasonNumber + 1)
  return <details className="game-disclosure"><summary><Icon name="calendar" size={15} />Contract rules & budget</summary><p className="transfers-note">{note} Contracts last 1–{MAX_CONTRACT_SEASONS} seasons.</p><dl className="transfers-summary"><div><dt>Signed salaries / year</dt><dd data-contract-committed={summary.seasonWages}>{formatEuros(summary.seasonWages)}</dd></div><div><dt>Pending offers / year</dt><dd data-contract-reserved={summary.reservedWages}>{formatEuros(summary.reservedWages)}</dd></div><div><dt>Total wages budget / year</dt><dd>{formatEuros(summary.budget)}</dd></div><div><dt>Available after squad reserve</dt><dd data-contract-spendable={summary.spendableBudget}>{formatEuros(summary.spendableBudget)}</dd></div></dl></details>
}
