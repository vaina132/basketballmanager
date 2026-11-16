import { useEffect, useRef } from 'react'
import type { SeasonState } from '../domain/season'
import type { ClubVacancy, SeasonEndOutlook } from '../world/career-policy'
import { BOARD_VERDICT_EFFECTS } from '../world/board-consequences'
import { CAREER_RULES, CAREER_RULES_TEXT } from '../world/career-rules'
import { seasonLabel } from '../world/season'
import { Icon } from './Icon'
import './season-end-choice.css'

interface SeasonEndChoiceProps {
  season: SeasonState
  outlook: SeasonEndOutlook
  busy?: boolean
  /** A club id to take that job, or null to stay. */
  onChoose: (clubId: string | null) => void
  onClose: () => void
}

const ordinal = (position: number) => `${position}${position % 10 === 1 && position !== 11 ? 'st' : position % 10 === 2 && position !== 12 ? 'nd' : position % 10 === 3 && position !== 13 ? 'rd' : 'th'}`

export function offerReason(offer: ClubVacancy, reputation: number, timing?: SeasonEndOutlook['timing']): string {
  const why = offer.reason === 'change' ? 'Its board, the least confident in the league, is making a change.'
    : timing === 'mid-season' ? 'Its board has just dismissed its coach.'
      : timing === 'resignation' ? 'Its board is Under pressure and wants a new coach.'
        : 'Its own season ended Under pressure, so it is replacing its coach.'
  const anyway = timing === 'resignation' ? '; it offers you the job anyway' : '; it offers you the job anyway after your dismissal'
  return `${why} It looks for a reputation of ${offer.requirement}${offer.requirement > reputation ? anyway : ''}.`
}

/**
 * The manager's choice of club: before the offseason (shown before the final matchday is committed), after a
 * mid-season dismissal (shown before the matchday is committed) or when resigning. Nothing changes until a choice.
 */
export function SeasonEndChoice({ season, outlook, busy = false, onChoose, onClose }: SeasonEndChoiceProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const first = useRef<HTMLButtonElement>(null)
  const name = (id: string) => season.clubs.find(club => club.id === id)?.name ?? id
  const current = name(outlook.clubId), label = BOARD_VERDICT_EFFECTS[outlook.verdict.verdict].label
  const timing = outlook.timing

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    first.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  const title = timing === 'resignation' ? `Resign from ${current}` : outlook.dismissed ? `Dismissed by ${current}` : 'Job offers'
  const when = timing === 'resignation' ? `${seasonLabel(outlook.seasonNumber)} · resignation` : timing === 'mid-season' ? `${seasonLabel(outlook.seasonNumber)} · review after matchday ${season.round}` : `${seasonLabel(outlook.seasonNumber)} · final review`
  const offered = outlook.offers.length === 1 ? 'One club wants' : `${outlook.offers.length} clubs want`
  const lead = timing === 'resignation'
    ? `Resigning costs ${CAREER_RULES.resignationReputationCost} reputation points for three seasons, so the clubs below judge you at ${outlook.reputation.value}. ${offered} you at once. Choose a club to resign and take over there, or keep your job at ${current}.`
    : timing === 'mid-season'
      ? `The board's confidence is ${outlook.verdict.confidence}/100 after this review, below ${CAREER_RULES.midSeasonDismissalBelow}, and it has ended your job. Choose your next club: you take over before the next games, and ${current} continues under an interim coach.`
      : outlook.dismissed
        ? `The board's season verdict is ${label} (confidence ${outlook.verdict.confidence}/100), and it has ended your job. Choose your next club; ${current} continues under automatic control.`
        : `${current}'s board gives the verdict ${label} (confidence ${outlook.verdict.confidence}/100).${outlook.warning ? ' Your first season was protected, so this is a final warning instead of a dismissal: next season counts.' : ''} ${outlook.offers.length === 1 ? 'Another club wants' : `${outlook.offers.length} clubs want`} you as their next coach. Take a job, or stay at ${current}.`
  const note = timing === 'resignation'
    ? `${CAREER_RULES_TEXT.freshStart} Your first season there is protected. Contracts, staff and results stay where they are.`
    : timing === 'mid-season'
      ? `${CAREER_RULES_TEXT.freshStart} Your first season there is protected. The new club's games from the next matchday are yours; contracts, staff and results stay where they are.`
      : 'Your choice takes effect when the final matchday is recorded: the new club runs this offseason, including recruitment, and the next seasons. Contracts, staff and results stay where they are.'
  const place = (offer: ClubVacancy) => timing && season.status !== 'complete' ? `${ordinal(offer.position)} in the table` : `Finished ${ordinal(offer.position)}`

  return <dialog ref={dialog} id="season-end-choice" className="season-end-choice" aria-labelledby="season-end-choice-title" aria-describedby="season-end-choice-lead" data-dismissed={outlook.dismissed} data-timing={timing ?? 'season-end'} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="season-end-choice-heading">
      <h2 id="season-end-choice-title"><Icon name="shield" size={17} />{title}</h2>
      <span>{when}</span>
    </header>
    <div className="season-end-choice-body">
      <p id="season-end-choice-lead" className="season-end-choice-lead">{lead}</p>
      <dl className="season-end-choice-facts">
        <div><dt>{timing === 'resignation' ? 'Reputation after resigning' : 'Your reputation'}</dt><dd data-reputation={outlook.reputation.value}>{outlook.reputation.value}<small>/100</small></dd></div>
        <div><dt>Based on</dt><dd>{outlook.reputation.seasons.map(item => `${seasonLabel(item.seasonNumber)}: ${item.confidence}`).join(' · ') || 'No final review yet'}{outlook.reputation.resignations ? ` · −${outlook.reputation.resignations * CAREER_RULES.resignationReputationCost} for ${outlook.reputation.resignations === 1 ? 'a resignation' : `${outlook.reputation.resignations} resignations`}` : ''}</dd></div>
      </dl>
      <ul className="season-end-offers" aria-label="Job offers">{outlook.offers.map((offer, index) => <li key={offer.clubId} data-offer-club={offer.clubId}>
        <div><strong>{name(offer.clubId)}</strong><span>{place(offer)} · board confidence {offer.confidence}</span><p>{offerReason(offer, outlook.reputation.value, timing)}</p></div>
        <button ref={index === 0 ? first : undefined} className="button" data-join-club={offer.clubId} onClick={() => onChoose(offer.clubId)} disabled={busy}>{timing === 'resignation' ? `Resign and join ${name(offer.clubId)}` : `Join ${name(offer.clubId)}`}</button>
      </li>)}</ul>
      <p className="season-end-choice-note">{note}</p>
    </div>
    <footer className="season-end-choice-actions">
      {timing === 'resignation'
        ? <button className="button" id="season-end-stay" onClick={onClose} disabled={busy}>Keep my job at {current}</button>
        : <>
          <button className="text-button" id="season-end-later" onClick={onClose} disabled={busy}>Decide later</button>
          {!outlook.dismissed && <button className="button" id="season-end-stay" onClick={() => onChoose(null)} disabled={busy}>Stay at {current}</button>}
        </>}
    </footer>
  </dialog>
}
