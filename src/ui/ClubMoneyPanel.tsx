import type { SeasonState } from '../domain/season'
import type { EconomyBand, EconomyChangeReason } from '../domain/world'
import { economyChange, REAL_ECONOMY_RULES } from '../world/economy'
import { worldOf } from '../world/career-world'
import { seasonLabel } from '../world/season'
import { formatEuros } from './money-format'
import { Icon } from './Icon'

export const ECONOMY_BAND_LABELS: Readonly<Record<EconomyBand, string>> = { 'euroleague-top': 'EuroLeague top group', euroleague: 'EuroLeague', 'top-upper': 'Top division, upper half', 'top-lower': 'Top division, lower half', second: 'Second division', third: 'Third division' }

/** One reason in plain words; European competitions use the world's own names. */
function reasonText(season: SeasonState, reason: EconomyChangeReason, band: EconomyBand): string {
  if (reason === 'promoted') return 'Promoted'
  if (reason === 'relegated') return 'Relegated'
  if (reason === 'band') return `Squad strength moved the club to ${ECONOMY_BAND_LABELS[band].toLowerCase()}`
  const [move, kind] = reason.split('-') as ['joined' | 'left', 'euroleague' | 'eurocup' | 'bcl']
  const name = worldOf(season).europeanCompetitions?.find(competition => competition.kind === kind)?.name ?? { euroleague: 'EuroLeague', eurocup: 'EuroCup', bcl: 'Basketball Champions League' }[kind]
  return `${move === 'joined' ? 'Entered' : 'Left'} the ${name}`
}

/**
 * Format 72: the club's money level and budget this season, and the change from last season with its reason. Shown
 * only in careers whose club money follows promotion and relegation (new careers of real-data worlds).
 */
export function ClubMoneyPanel({ season }: { season: SeasonState }) {
  const change = economyChange(season, season.managedClubId)
  if (!change) return null
  const { band, budget, target, previous, reasons } = change
  const difference = previous ? budget - previous.budget : 0
  const percent = previous && previous.budget ? Math.round(difference / previous.budget * 100) : 0
  const why = reasons.length ? reasons.map(reason => reasonText(season, reason, band)).join(' · ') : difference ? 'Moving towards its level' : 'No change'
  return <section className="club-money panel" aria-labelledby="club-money-title" data-club-money-band={band} data-club-money-budget={budget}>
    <header className="club-heading"><h2 id="club-money-title"><Icon name="wallet" size={18} />Club budget</h2><span>{seasonLabel(season.seasonNumber)}</span></header>
    <dl>
      <div><dt>Money level</dt><dd>{ECONOMY_BAND_LABELS[band]}</dd></div>
      <div><dt>Budget this season</dt><dd>{formatEuros(budget)}</dd></div>
      <div><dt>{previous ? `Change from ${seasonLabel(season.seasonNumber - 1)}` : 'Change'}</dt><dd data-club-money-change={difference}>{previous ? <>{difference > 0 ? '+' : difference < 0 ? '−' : ''}{formatEuros(Math.abs(difference))}{percent ? ` (${percent > 0 ? '+' : ''}${percent}%)` : ''}<small>{why}</small></> : <>Opening figures<small>Estimated from published club budgets</small></>}</dd></div>
    </dl>
    <details className="game-disclosure"><summary><Icon name="clock" size={15} />How the budget changes</summary><div className="club-note"><p>Each new season the club’s division, European competition and squad strength set the budget it is heading for{target !== budget ? `: ${formatEuros(target)} this season` : ''}. Sponsorship, season funding, ticket prices, staff costs and the player wages budget move {Math.round(REAL_ECONOMY_RULES.seasons.share * 100)}% of the way there each season, so promotion and relegation take effect over two or three seasons.</p><p>Signed contracts keep their agreed wages. New figures apply when the next season starts.</p></div></details>
  </section>
}
