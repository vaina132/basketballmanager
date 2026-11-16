import type { SeasonState } from '../domain/season'
import { currentMediaEffects, MEDIA_RULES, mediaReputation } from '../world/media'
import { Icon } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import './media-standing.css'

const signed = (value: number) => value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
const HISTORY_ROWS = 8

/** Format 67: the manager's media standing, its current small effects and the latest reasons it moved. */
export function MediaStanding({ season }: { season: SeasonState }) {
  if (!season.media) return null
  const media = mediaReputation(season), effects = currentMediaEffects(season)
  const recent = media.history.slice(0, HISTORY_ROWS)
  return <section className="panel media-standing" aria-labelledby="media-standing-title" data-media-standing={media.value}>
    <header className="media-standing-heading"><h2 id="media-standing-title"><Icon name="mail" size={18} />Media standing</h2><span>{media.label}</span></header>
    <div className="media-standing-summary">
      <div className="media-standing-value">
        <div><strong>{media.value} / 100</strong><span>{media.label}</span></div>
        <meter min={0} max={100} low={30} high={70} optimum={100} value={media.value} aria-label={`Media standing ${media.value} out of 100`} />
        <small>How the press sees you, from your answers and results. Separate from your reputation for job offers, which follows final board ratings.</small>
      </div>
      <dl className="media-standing-effects">
        <div data-media-effect="board"><dt>Board</dt><dd>{signed(effects.board)}<small>assessment points at the next review, with recent press answers (±{MEDIA_RULES.board.cap} at most)</small></dd></div>
        <div data-media-effect="players"><dt>Players</dt><dd>×{effects.moraleFactor.toFixed(2)}<small>weight of your press answers on morale</small></dd></div>
        <div data-media-effect="sponsors"><dt>Sponsors</dt><dd>{signed(effects.sponsorBonus)}<small>flexibility when you ask a sponsor for better terms (scale 0-12)</small></dd></div>
        <div data-media-effect="supporters"><dt>Supporters</dt><dd>{signed(effects.supporterPercent)}%<small>home crowd demand from recent press answers</small></dd></div>
      </dl>
    </div>
    <h3 className="board-section-heading"><Icon name="clock" size={16} />Recent changes</h3>
    {recent.length ? <ul className="media-standing-history">{recent.map(move => <li key={`${move.kind}-${move.id}`} data-media-move={move.kind}>
      <span><strong>{move.label}</strong><small><time dateTime={move.date}>{medicalDate(move.date)}</time></small></span>
      <span className="media-standing-change">{signed(move.change)}<small>{move.value} / 100</small></span>
    </li>)}</ul> : <p className="board-empty">No changes yet. Press answers, big wins and defeats, derbies, European wins and runs of five results move your standing.</p>}
    <details className="board-rules"><summary><Icon name="target" size={15} />How media standing works</summary>
      <p>Your standing starts at {MEDIA_RULES.start}. Each press answer moves it by its style and topic (calm answers usually help, combative ones please the crowd but not the press). A win or defeat by {MEDIA_RULES.results.bigMargin} points or more, a derby result, a European win and every fifth straight win or defeat count one point. Each new season closes a quarter of the gap to {MEDIA_RULES.start}.</p>
      <p>Effects stay small: the board adds 1 assessment point at {MEDIA_RULES.start + MEDIA_RULES.board.standingStep} and 2 at {MEDIA_RULES.start + 2 * MEDIA_RULES.board.standingStep} (minus the same below {MEDIA_RULES.start}); press answers count {MEDIA_RULES.morale.minFactor}× to {MEDIA_RULES.morale.maxFactor}× on morale; sponsors are up to 2 points more or less flexible; recent answers move home crowds by up to {MEDIA_RULES.supporters.capPercent}%.</p>
    </details>
  </section>
}
